import http from 'node:http'
import fs from 'node:fs'
import { isWebPage } from '../../shared/web-routes'
import path from 'node:path'
import { randomBytes, randomUUID } from 'node:crypto'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { WebSocketServer, WebSocket } from 'ws'
import { readConfig } from './config'
import { isAllowedOrigin } from './security'
import { startEgress } from './egress'
import { Jobs, type Job } from './jobs'
import { serveStatic } from './static'
import { parseRange } from './storage'
import { Analytics } from './analytics'
import { cleanContext, isOpaqueId, type EventFields } from '../../shared/web-analytics'
import { webErrorCode, WebError } from '../../shared/web-errors'
import { createSee } from './see'

process.env.KEEP_WEB_MODE = '1'
const config = readConfig()
const root = process.env.APP_ROOT || process.cwd()
process.env.DOWNVID_DATA_DIR = config.dataDir
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version
const egress = await startEgress()
const analytics = new Analytics(config)
const jobs = new Jobs(config, egress.url, analytics)
const state = jobs.state
const see = createSee(config, root)
function session(req: http.IncomingMessage) {
  const token = /(?:^|;\s*)keep_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '')?.[1]
  return token && state.session(token) ? token : undefined
}
const server = http.createServer(async (req, res) => {
  try {
    res.setHeader('X-Content-Type-Options', 'nosniff')
    let url: URL
    try {
      const target = req.url || ''
      // 仅接受站内路径，避免双斜杠、反斜杠等被 URL 解析成外部地址。
      if (!target.startsWith('/') || target.startsWith('//') || /[\\#\u0000-\u0020\u007f]/.test(target)) throw new Error('请求路径无效')
      url = new URL(target, config.origin)
    } catch { res.writeHead(400).end(); return }
    if (await see.handle(req, res, url)) return
    if (!['GET', 'HEAD'].includes(req.method || '')) { res.writeHead(405).end(); return }
    if (url.pathname === '/healthz') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ ok: true, version })); return }
    if (url.pathname.startsWith('/api/')) {
      res.setHeader('Cache-Control', 'private, no-store')
      res.setHeader('X-Robots-Tag', 'noindex')
      const owner = session(req)
      if (!owner) { res.writeHead(401).end(); return }
      if (url.pathname.startsWith('/api/files/')) {
        const job = jobs.jobs.get(url.pathname.slice('/api/files/'.length))
        if (!job || job.owner !== owner) { res.writeHead(404).end(); return }
        const started = Date.now()
        const fields: EventFields = { entityId: job.analytics?.entityId, method: req.method as 'GET' | 'HEAD', bytes: 0, status: 500, result: 'error' }
        try {
          if (!job.file || Date.now() - job.createdAt >= config.ttl) { fields.status = 404; res.writeHead(404).end(); return }
          try {
            const range = parseRange(req.headers.range, job.file.size)
            if (range) { fields.rangeStart = range.start; fields.rangeEnd = range.end }
          } catch { fields.status = 416; res.writeHead(416, { 'Content-Range': 'bytes */' + job.file.size }).end(); return }
          const file = await jobs.storage.open(job.file, job.localPath!, req.headers.range)
          fields.status = file.contentRange ? 206 : 200
          res.writeHead(fields.status, { 'Content-Type': 'application/octet-stream', 'Content-Length': file.size, 'Accept-Ranges': 'bytes', 'Content-Disposition': "attachment; filename*=UTF-8''" + encodeURIComponent(job.file.name), ...(file.contentRange ? { 'Content-Range': file.contentRange } : {}) })
          if (req.method === 'HEAD') { file.stream.destroy(); res.end(); fields.result = 'completed'; return }
          const counter = new Transform({ transform(chunk, _encoding, callback) { fields.bytes! += chunk.length; callback(null, chunk) } })
          await pipeline(file.stream, counter, res)
          fields.result = 'completed'
        } catch {
          fields.result = res.destroyed ? 'aborted' : 'error'
          if (!res.headersSent) res.writeHead(500)
          res.end()
        } finally {
          analytics.record('file_delivery_finished', job.analytics, { ...fields, durationMs: Date.now() - started })
        }
        return
      }
      res.writeHead(404).end(); return
    }
    if (isWebPage(url.pathname) && !session(req)) {
      const token = randomBytes(32).toString('hex')
      try { state.createSession(token, Date.now() + 30 * 86400000, randomUUID()) }
      catch { res.writeHead(503).end(); return }
      res.setHeader('Set-Cookie', 'keep_session=' + token + '; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000' + (config.origin.startsWith('https:') ? '; Secure' : ''))
    }
    serveStatic(req, res, url, process.env.WEBSITE_DIST || path.join(root, 'website/dist'), process.env.DOWNVID_WEB_DIST || path.join(root, 'docker/dist-web'))
  } catch { if (!res.headersSent) res.writeHead(500); res.end() }
})

const sockets = new Map<WebSocket, string>()
const browserEvents = new Map<string, number>()
const wss = new WebSocketServer({ server, path: '/api/ws', maxPayload: 32768, verifyClient: (info, done) => {
  const owner = session(info.req)
  done(!!owner && isAllowedOrigin(info.origin, config.origin) && [...sockets.values()].filter(value => value === owner).length < 5, 403)
} })
function send(owner: string, event: string, data: unknown) {
  for (const [ws, id] of sockets) if (id === owner && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ event, data }))
}
jobs.on('progress', (owner, data) => send(owner, 'download:progress', data))
jobs.on('updated', owner => send(owner, 'history:updated', jobs.list(owner)))

wss.on('connection', (ws, req) => {
  const owner = session(req)!
  sockets.set(ws, owner)
  let requests = 0
  let telemetryRequests = 0
  let windowStart = Date.now()
  const waiting = new Map<string, Set<number>>()
  const reply = (id: number, result?: unknown, errorCode?: string, retryAfterSeconds?: number) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ id, result, ...(errorCode ? { error: true, errorCode } : {}),
      ...(Number.isSafeInteger(retryAfterSeconds) && retryAfterSeconds! > 0 ? { retryAfterSeconds: Math.min(retryAfterSeconds!, 86400) } : {}) }))
  }
  const finished = (job: Job) => {
    if (job.owner !== owner) return
    for (const id of waiting.get(job.id) || []) reply(id, job.status === 'paused' ? { paused: true } : jobs.view(job), job.status === 'error' ? job.errorCode || 'unknown' : undefined)
    waiting.delete(job.id)
  }
  jobs.on('finished', finished)
  ws.on('close', () => { sockets.delete(ws); jobs.off('finished', finished) })
  ws.on('message', async raw => {
    let id = 0
    try {
      if (Date.now() - windowStart > 60000) { requests = 0; telemetryRequests = 0; windowStart = Date.now() }
      const message = JSON.parse(String(raw))
      if (!Number.isSafeInteger(message.id) || !Array.isArray(message.args)) throw new Error('请求格式无效')
      id = message.id
      const args = message.args
      const context = cleanContext({ ...message.context, sessionId: state.session(owner)?.analyticsId })
      if (message.channel === 'analytics:event') {
        if (++telemetryRequests > 60) { reply(id, false); return }
      } else if (++requests > 120) {
        if (message.channel === 'ytdlp:parse') analytics.record('parse_rejected', context, { result: 'rejected', code: 'busy' })
        reply(id, undefined, 'busy'); return
      }
      let result: unknown
      switch (message.channel) {
        case 'analytics:event': {
          const event = args[0]
          if (!['tool_view', 'example_selected', 'file_save_clicked'].includes(event?.name) || !isOpaqueId(event?.id)) throw new WebError('invalid-url', '事件无效')
          const key = owner + ':' + event.id
          if (!browserEvents.has(key)) {
            browserEvents.set(key, Date.now())
            while (browserEvents.size > 10000) browserEvents.delete(browserEvents.keys().next().value!)
            if (event.name === 'file_save_clicked') {
              const job = jobs.jobs.get(event.jobId)
              if (job && job.owner === owner) analytics.record(event.name, job.analytics, { entityId: job.analytics?.entityId })
            } else analytics.record(event.name, context)
          }
          result = true; break
        }
        case 'ytdlp:parse': result = await jobs.parse(owner, args[0], context); break
        case 'ytdlp:download': {
          const job = jobs.submit(owner, args[0])
          if (job.status === 'error') throw new WebError(job.errorCode || 'unknown', '任务失败')
          if (job.status === 'paused') result = { paused: true }
          else if (job.status === 'completed') result = jobs.view(job)
          else { const ids = waiting.get(job.id) || new Set<number>(); ids.add(id); waiting.set(job.id, ids); return }
          break
        }
        case 'ytdlp:pauseDownload':
          try { result = await jobs.pause(owner, args[0]) } catch { throw new WebError('stop-failed', '任务尚未停止') }
          break
        case 'history:get': result = jobs.list(owner); break
        case 'history:add': result = true; break
        case 'history:delete': await jobs.remove(owner, args[0]); send(owner, 'history:updated', jobs.list(owner)); result = true; break
        case 'app:getVersion': result = version; break
        case 'app:getDefaultDownloadDir': case 'dialog:selectFolder': result = '/downloads'; break
        case 'app:getHomeDir': result = ''; break
        case 'app:fetchImage': result = null; break
        case 'app:cookieStatus': result = { availableBrowsers: [], hasSnapshot: false }; break
        case 'app:getDiskSpace': result = { free: config.maxFileBytes, total: config.maxFileBytes, unit: 'bytes' }; break
        case 'ytdlp:accelerationStatus': result = { available: false }; break
        case 'app:setUpdatePrefs': result = true; break
        case 'app:checkForUpdates': result = { hasUpdate: false, currentVersion: version, downloadUrl: '' }; break
        case 'deps:status': case 'deps:check': result = { success: true, status: { managedDir: '', checkedAt: Date.now(), results: [] } }; break
        default: throw new Error('此功能仅在桌面版可用')
      }
      reply(id, result)
    } catch (error) { reply(id, undefined, webErrorCode(error), error instanceof WebError ? error.retryAfterSeconds : undefined) }
  })
})
let cleaning: Promise<void> | undefined
const cleanup = setInterval(() => {
  if (cleaning) return
  cleaning = Promise.all([jobs.cleanup(), analytics.cleanup()]).then(() => {
    state.cleanupSessions()
  }).catch(() => { console.warn('持久化数据清理失败，将在下一轮重试') }).finally(() => { cleaning = undefined })
  for (const [id, at] of browserEvents) if (Date.now() - at > 86400000) browserEvents.delete(id)
}, 60000)
cleanup.unref()
await jobs.cleanup()
await analytics.cleanup()
server.listen(config.port, config.host, () => console.log('Keep Video 网站服务已启动'))
let stopping = false
async function shutdown() {
  if (stopping) return
  stopping = true
  clearInterval(cleanup)
  server.close()
  for (const ws of sockets.keys()) ws.close(1001)
  try {
    await see.close()
    await cleaning
    await jobs.close()
    await analytics.close()
    egress.server.close()
    process.exit(0)
  } catch {
    // 未确认进程树结束时不删工作文件，允许再次发送停止信号。
    stopping = false
    console.error('下载进程尚未停止，请重试停止服务')
  }
}
process.on('SIGTERM', () => { void shutdown() })
process.on('SIGINT', () => { void shutdown() })
export { server }
