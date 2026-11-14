// 真实服务回归：同域门户、会话隔离、私有文件、Range 和受限 RPC。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { spawn } from 'node:child_process'
import { once, EventEmitter } from 'node:events'
import { WebSocket } from 'ws'
import { loader } from './lib/load-source.mjs'
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
function eventsIn(directory) {
  const db = new DatabaseSync(path.join(directory, 'analytics.sqlite'), { readOnly: true })
  try { return db.prepare('SELECT payload FROM events ORDER BY seq').all().map(row => JSON.parse(row.payload)) }
  finally { db.close() }
}
const root = path.resolve(import.meta.dirname, '..')
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'keep-web-'))
const port = 14000 + Math.floor(Math.random() * 10000)
const origin = 'http://127.0.0.1:' + port
const website = path.join(temp, 'website'), app = path.join(temp, 'app'), data = path.join(temp, 'data'), downloads = path.join(temp, 'downloads')
for (const dir of [website, app, data, downloads]) fs.mkdirSync(dir, { recursive: true })
fs.writeFileSync(path.join(website, 'index.html'), '<h1>Keep Video portal</h1>')
fs.writeFileSync(path.join(website, '404.html'), '<h1>Not found</h1>')
for (const prefix of ['', 'zh/', 'es/', 'pt-br/', 'de/', 'fr/', 'ja/', 'ko/', 'ru/']) {
  const dir = path.join(website, prefix, 'app')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'index.html'), '<h1>Online video downloader</h1>')
}
fs.mkdirSync(path.join(app, 'assets'))
fs.writeFileSync(path.join(app, 'entry.js'), 'console.log("app")')
fs.writeFileSync(path.join(app, 'assets', 'test.js'), 'export default true')
const owner = 'a'.repeat(64), other = 'b'.repeat(64)
fs.writeFileSync(path.join(data, 'web-sessions.json'), JSON.stringify([[owner, Date.now() + 60000], [other, Date.now() + 60000]]))
const id = 'test-file'
const file = path.join(downloads, 'test.mp4'); fs.writeFileSync(file, '0123456789')
fs.writeFileSync(path.join(data, 'web-jobs.json'), JSON.stringify([{ id, owner, clientId: id, url: 'https://example.com/video', title: '测试文件', createdAt: Date.now(), status: 'completed', progress: 100, localPath: file, file: { key: id, name: 'test.mp4', size: 10, driver: 'local' } }]))
const child = spawn(process.execPath, ['--import', 'tsx', 'docker/server/index.ts'], { cwd: root, env: { ...process.env, TSX_TSCONFIG_PATH: 'docker/server/tsconfig.json', SITE_URL: origin, DOWNVID_WEB_HOST: '127.0.0.1', DOWNVID_WEB_PORT: String(port), DOWNVID_DATA_DIR: data, DOWNVID_DOWNLOADS: downloads, WEBSITE_DIST: website, DOWNVID_WEB_DIST: app, STORAGE_DRIVER: 'local', ANALYTICS_ENVIRONMENT: 'test', ANALYTICS_ENABLED: '1', WEB_PARSE_HOURLY_LIMIT: '1', SEE_PASSWORD: '' }, stdio: ['ignore', 'pipe', 'pipe'] })
let output = ''; child.stdout.on('data', d => output += d); child.stderr.on('data', d => output += d)
const sockets = []
const request = (route, token, headers = {}) => fetch(origin + route, { headers: { ...(token ? { Cookie: 'keep_session=' + token } : {}), ...headers }, redirect: 'manual', signal: AbortSignal.timeout(5000) })
// fetch 会规范化 URL；用原始请求目标复现公网请求，避免测试绕过出错入口。
function rawRequest(target, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request(origin, { path: target, method, agent: false }, res => {
      res.resume()
      res.once('end', () => resolve(res))
      res.once('error', reject)
    })
    req.setTimeout(5000, () => req.destroy(new Error('原始请求超时')))
    req.once('error', reject)
    req.end()
  })
}
try {
  let ready = false
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(origin + '/healthz', { signal: AbortSignal.timeout(1000) })).ok) { ready = true; break } } catch {}
    if (child.exitCode !== null) break
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  assert(ready, output)
  for (const route of ['/see', '/see/report.json']) {
    const privatePage = await request(route)
    assert.equal(privatePage.status, 303, '旧统计入口迁移到管理员页面')
    assert.match(privatePage.headers.get('location'), /^\/admin\/analytics/)
    assert.match(privatePage.headers.get('x-robots-tag'), /noindex/)
  }
  assert.equal((await request('/admin/analytics')).status, 401, '管理员页面必须使用账户鉴权')
  assert.match(await (await request('/')).text(), /portal/)
  assert.equal((await request('/missing')).status, 404)
  assert.equal((await request('/app')).headers.get('location'), '/app/')
  assert.equal((await request('/en/guides/')).headers.get('location'), '/guides/')
  assert.equal((await request('/zh-cn/app/?x=1')).headers.get('location'), '/zh/app/?x=1')
  assert.equal((await request('/zh-cn')).headers.get('location'), '/zh/')
  const page = await request('/app/')
  assert.match(page.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/)
  assert.equal(page.headers.get('x-robots-tag'), null)
  for (const prefix of ['zh', 'es', 'pt-br', 'de', 'fr', 'ja', 'ko', 'ru']) {
    const localized = await request('/' + prefix + '/app/')
    assert.equal(localized.status, 200)
    assert.match(localized.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/)
    assert.equal(localized.headers.get('x-robots-tag'), null)
    assert.equal((await request('/' + prefix + '/app?x=1')).headers.get('location'), '/' + prefix + '/app/?x=1')
  }
  assert.equal((await request('/unknown/app/')).status, 404)
  assert.equal((await request('/app/entry.js')).headers.get('content-type'), 'text/javascript')
  assert.equal((await request('/app/entry.js')).headers.get('cache-control'), 'no-cache')
  assert.equal((await request('/app/assets/test.js')).status, 200)
  assert.equal((await request('/api/files/' + id)).status, 401)
  assert.equal((await request('/api/files/' + id, other)).status, 404)
  const range = await request('/api/files/' + id, owner, { Range: 'bytes=2-5' })
  assert.equal(range.headers.get('x-robots-tag'), 'noindex'); assert.equal(range.status, 206); assert.equal(await range.text(), '2345')
  assert.equal((await request('/api/files/' + id, owner, { Range: 'bytes=30-' })).status, 416)
  const head = await fetch(origin + '/api/files/' + id, { method: 'HEAD', headers: { Cookie: 'keep_session=' + owner } })
  assert.equal(head.status, 200)
  assert.equal(await (await request('/api/files/' + id, owner)).text(), '0123456789')
  const ws = new WebSocket(origin.replace('http', 'ws') + '/api/ws', { headers: { Origin: origin, Cookie: 'keep_session=' + owner } }); sockets.push(ws); await once(ws, 'open')
  let next = 0
  const invoke = (channel, ...args) => new Promise((resolve, reject) => {
    const id = ++next
    const receive = raw => { const msg = JSON.parse(String(raw)); if (msg.id !== id) return; ws.off('message', receive); msg.error ? reject(new Error(msg.error)) : resolve(msg.result) }
    ws.on('message', receive); ws.send(JSON.stringify({ id, channel, args }))
  })
  assert.equal((await invoke('history:get')).length, 1)
  const view = (await invoke('history:get'))[0]
  assert.equal(Date.parse(view.expiresAt) - Date.parse(view.createdAt), 24 * 3600000)
  assert.equal(view.analytics, undefined, '内部统计标识不可暴露给浏览器')
  const browserEvent = { name: 'tool_view', id: randomUUID(), url: 'secret-video', title: 'secret-title', Cookie: owner }
  await invoke('analytics:event', browserEvent)
  await invoke('analytics:event', browserEvent)
  await assert.rejects(invoke('analytics:event', { name: 'job_finished', id: randomUUID() }), '浏览器不能伪造服务端结果')
  for (let i = 0; i < 65; i++) await invoke('analytics:event', { name: 'example_selected', id: randomUUID() })
  assert.equal((await invoke('history:get')).length, 1, '统计限流不得中断业务连接')
  await assert.rejects(invoke('app:clearLog'))
  await assert.rejects(invoke('ytdlp:parse', 'http://127.0.0.1/'))
  const reconnected = new WebSocket(origin.replace('http', 'ws') + '/api/ws', { headers: { Origin: origin, Cookie: 'keep_session=' + owner } })
  sockets.push(reconnected); await once(reconnected, 'open')
  const quotaReply = once(reconnected, 'message')
  reconnected.send(JSON.stringify({ id: 1, channel: 'ytdlp:parse', args: ['https://example.com/video'] }))
  const quotaError = JSON.parse(String((await quotaReply)[0]))
  assert.equal(quotaError.errorCode, 'parse-quota', '跨连接仍使用同一会话额度')
  assert.ok(quotaError.retryAfterSeconds > 0 && quotaError.retryAfterSeconds <= 3600)
  assert.equal(quotaError.error, true)
  await assert.rejects(invoke('ytdlp:download', { url: 'https://example.com', taskId: 'x', outputDir: '/' }))
  const denied = new WebSocket(origin.replace('http', 'ws') + '/api/ws', { headers: { Origin: 'https://invalid.example', Cookie: 'keep_session=' + owner } }); sockets.push(denied)
  const response = await new Promise(resolve => { denied.on('unexpected-response', (_, res) => { resolve(res.statusCode); denied.terminate() }); denied.on('error', () => {}) })
  assert.equal(response, 403)
  for (const target of ['//?ref=hackstack', '//', '///?ref=test', '//example.com/app/', '/\\example.com/app/', '/app\\entry.js', '/app/#fragment', 'http://example.com/app/']) {
    for (const method of ['GET', 'HEAD']) {
      let response
      try { response = await rawRequest(target, method) }
      catch (error) { throw new Error('非法请求未正常响应：' + JSON.stringify(target) + '\n' + output, { cause: error }) }
      assert.equal(response.statusCode, 400, '非法请求应返回 400：' + JSON.stringify(target))
      assert.equal(response.headers.location, undefined, '非法路径不得产生跳转')
      assert.equal(response.headers['set-cookie'], undefined, '非法路径不得创建会话')
      assert.equal((await request('/healthz')).status, 200, '非法请求后服务必须继续存活')
    }
  }
  assert.equal((await rawRequest('/?ref=hackstack')).statusCode, 200, '普通查询参数仍可访问')
  assert.equal((await request('/app/', owner)).status, 200, '正常页面仍可访问')
  assert.equal((await invoke('history:get')).length, 1, '非法请求不能断开现有业务连接')
  console.log('单站点、会话、文件交付和 RPC 回归通过')
} finally {
  for (const ws of sockets) ws.terminate()
  if (child.exitCode === null && child.signalCode === null) {
    const exited = once(child, 'exit')
    child.kill(); await exited.catch(() => {})
  }
  const events = eventsIn(path.join(data, 'analytics'))
  assert.equal(events.filter(event => event.name === 'tool_view').length, 1, '重复浏览器事件只记录一次')
  const delivery = events.filter(event => event.name === 'file_delivery_finished')
  assert.ok(delivery.some(event => event.status === 206 && event.bytes === 4 && event.rangeStart === 2 && event.rangeEnd === 5))
  assert.ok(delivery.some(event => event.status === 200 && event.method === 'HEAD' && event.bytes === 0))
  assert.ok(delivery.some(event => event.status === 416 && event.bytes === 0))
  assert.ok(delivery.some(event => event.status === 200 && event.method === 'GET' && event.bytes === 10))
  assert.equal(events.filter(event => event.name === 'parse_rejected').length, 2)
  assert.ok(events.some(event => event.code === 'parse-quota'))
  assert.ok(!JSON.stringify(events).includes(owner) && !JSON.stringify(events).includes('secret-'), '凭据和额外字段不能落入统计')
  fs.rmSync(temp, { recursive: true, force: true })
}

async function jobChecks(sources = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keep-jobs-'))
  const pending = new Map()
  const starts = []
  let failStop = true, cache
  const load = loader({
    'docker/server/electron-shim.ts': { wsEventBus: new EventEmitter() },
    'docker/server/security.ts': { publicTarget: async () => {} },
    'docker/server/storage.ts': { createStorage: () => ({}) },
    'electron/parsers/ytdlp.ts': { parseWithYtdlp: async url => {
      const info = { title: '测试', formats: [{ formatId: 'mp4', hasAudio: true }] }
      cache.cacheParsedInfo(url, url, info, JSON.stringify({ id: 'same' }), [])
      return info
    } },
    'electron/download/ytdlp.ts': {
      runYtdlpDownload: options => { starts.push(options); return new Promise(resolve => pending.set(options.taskId, resolve)) },
      pauseDownload: async id => {
        if (failStop && pending.has(id)) throw new Error('模拟停止失败')
        pending.get(id)?.({ paused: true })
      },
    },
  }, { URL, setInterval, clearInterval, process: Object.assign(Object.create(process), { once: () => {} }) }, sources)
  cache = load('electron/parsers/info-cache.ts')
  const { Jobs } = load('docker/server/jobs.ts')
  const config = { ...load('docker/server/config.ts').readConfig({ WEB_PARSE_HOURLY_LIMIT: '200' }), dataDir: dir, workDir: path.join(dir, 'work'), concurrency: 1 }
  const jobs = new Jobs(config, 'server-proxy')
  const firstUrl = 'https://example.com/one', secondUrl = 'https://example.com/two'
  try {
    const publicInfo = await jobs.parse('owner', firstUrl)
    assert.equal(publicInfo.cacheFile, undefined, '私有缓存路径不能交给浏览器')
    const raw = { taskId: 'one', url: firstUrl, formatId: 'mp4', outputDir: '/', proxy: 'client-proxy' }
    assert.throws(() => jobs.submit('other', raw), /重新解析/, '不能借用其他会话的解析结果')
    const first = jobs.submit('owner', raw)
    await jobs.parse('owner', secondUrl)
    const second = jobs.submit('owner', { ...raw, taskId: 'two', url: secondUrl })
    assert.equal(second.status, 'pending')
    assert.equal(starts.length, 1, '全局队列限制仍然生效')
    assert.equal(first.options.proxy, 'server-proxy')
    assert.equal(first.options.outputDir, path.join(config.workDir, first.id))
    const queuedFile = second.options.cacheFile
    for (let i = 0; i < cache.PARSE_CACHE_LIMIT + 1; i++) await jobs.parse('owner', 'https://example.com/' + i)
    assert.equal(jobs.parsed.size, cache.PARSE_CACHE_LIMIT, '服务解析索引有数量上限')
    assert.ok(fs.existsSync(queuedFile), '排队任务也持有缓存引用')
    await Promise.all([
      assert.rejects(jobs.pause('owner', 'one'), /模拟停止失败/),
      assert.rejects(jobs.pause('owner', 'one'), /模拟停止失败/),
    ])
    assert.equal(first.status, 'downloading')
    assert.equal(jobs.running, 1)
    await assert.rejects(jobs.remove('owner', first.id), /仍在运行/)
    assert.ok(fs.existsSync(first.options.outputDir), '停止失败不能清理仍在写入的目录')
    failStop = false
    await jobs.pause('owner', 'one')
    assert.equal(second.status, 'downloading')
    assert.equal(starts.length, 2)
    await jobs.close()
    assert.equal(second.status, 'paused')
    assert.equal(jobs.running, 0)
    assert.equal(fs.existsSync(queuedFile), false, '最后一个排队引用释放后删除淘汰文件')
    assert.throws(() => jobs.submit('owner', raw), /正在停止/)
    await assert.rejects(jobs.parse('owner', firstUrl), /正在停止/)
  } finally {
    failStop = false
    await jobs.close()
    cache.clearParseCache()
    fs.rmSync(dir, { recursive: true, force: true })
  }
}
await jobChecks()
async function shutdownChecks(sources = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keep-shutdown-'))
  let finishParse, finishSave, uploadSignal, removed = false
  const load = loader({
    'docker/server/electron-shim.ts': { wsEventBus: new EventEmitter() },
    'docker/server/security.ts': { publicTarget: async () => {} },
    'electron/parsers/ytdlp.ts': { parseWithYtdlp: () => new Promise(resolve => { finishParse = resolve }) },
    'electron/parsers/info-cache.ts': { retainInfoFile: () => () => {}, PARSE_CACHE_LIMIT: 100 },
    'electron/download/ytdlp.ts': {
      runYtdlpDownload: async (_options, outputDir) => ({ filePath: path.join(outputDir, 'test.mp4') }),
      pauseDownload: async () => false,
    },
    'docker/server/storage.ts': { createStorage: () => ({
      save: (_file, _key, signal) => { uploadSignal = signal; return new Promise(resolve => { finishSave = resolve }) },
      remove: async () => { removed = true },
    }) },
  }, { URL, setInterval, clearInterval }, sources)
  const { Jobs } = load('docker/server/jobs.ts')
  const config = { ...load('docker/server/config.ts').readConfig({}), dataDir: dir, workDir: path.join(dir, 'work') }
  const parsing = new Jobs(config, '')
  const uploading = new Jobs({ ...config, dataDir: path.join(dir, 'upload') }, '')
  const tick = () => new Promise(resolve => setImmediate(resolve))
  try {
    const parsed = parsing.parse('owner', 'https://example.com/video')
    await tick()
    let closed = false
    const closedParse = parsing.close().then(() => { closed = true })
    await tick()
    const closedTooEarly = closed
    finishParse({ formats: [] }); await parsed; await closedParse
    assert.equal(closedTooEarly, false, '关闭必须等待解析结束')
    const url = 'https://example.com/video'
    uploading.parsed.set('owner:' + url, { time: Date.now(), info: { formats: [{ formatId: 'mp4' }] } })
    const job = uploading.submit('owner', { taskId: 'upload', url, formatId: 'mp4' })
    await tick()
    const outputDir = job.options.outputDir
    closed = false
    const closedUpload = uploading.close().then(() => { closed = true })
    await tick()
    const state = { closed, aborted: uploadSignal.signal.aborted, exists: fs.existsSync(outputDir) }
    finishSave({ key: 'test', name: 'test.mp4', size: 1, driver: 'r2' }); await closedUpload
    assert.deepEqual(state, { closed: false, aborted: true, exists: true }, '上传收尾之前不能退出或删除文件')
    assert.equal(removed, true, '取消时仍完成的远端对象必须回收')
    assert.equal(fs.existsSync(outputDir), false)
    assert.equal(job.status, 'paused')
  } finally {
    finishParse?.({ formats: [] }); finishSave?.({ key: 'test' })
    await parsing.close(); await uploading.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
}
await shutdownChecks()
const jobsFile = 'docker/server/jobs.ts', jobsSource = fs.readFileSync(jobsFile, 'utf8')
for (const [before, after] of [
  ['while (this.parsed.size > PARSE_CACHE_LIMIT)', 'while (false)'],
  ['retainInfoFile(job.options.cacheFile)', '(() => {})'],
  ['job.status = previous; throw error', 'job.status = "paused"; throw error'],
]) {
  assert.ok(jobsSource.includes(before))
  await assert.rejects(jobChecks({ [jobsFile]: jobsSource.replace(before, after) }), `Web 变异必须被回归拦住：${before}`)
}
for (const before of [
  'if (this.parsing) await new Promise<void>(resolve => this.parseWaiters.add(resolve))',
  'this.controllers.get(job.id)?.abort()',
]) {
  assert.ok(jobsSource.includes(before))
  await assert.rejects(shutdownChecks({ [jobsFile]: jobsSource.replaceAll(before, 'void 0') }), `关闭变异必须被拦住：${before}`)
}
console.log('通过：Web 解析限额、队列缓存引用、暂停失败保护、解析/上传关闭收尾及 5 个变异反证')

async function analyticsChecks(sources = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keep-analytics-'))
  const load = loader({}, { URL, Intl }, sources)
  const { Analytics } = load('docker/server/analytics.ts')
  const config = { ...load('docker/server/config.ts').readConfig({}), dataDir: dir }
  const analytics = new Analytics(config)
  const instances = [analytics]
  const entityId = randomUUID(), sessionId = randomUUID()
  try {
    analytics.record('job_created', { sessionId, input: 'user_input', url: 'secret-url', owner: 'secret-token' }, { entityId, url: 'secret-url', code: 'secret-error', bytes: -1 }, entityId + ':created')
    await analytics.flush()
    const event = eventsIn(analytics.directory)[0]
    const text = JSON.stringify(event)
    assert.equal(event.entityId, entityId)
    assert.equal(event.sessionId, sessionId)
    assert.equal(event.bytes, undefined)
    assert.equal(event.code, undefined)
    assert.ok(!text.includes('secret-'))
    fs.writeFileSync(path.join(analytics.directory, '2000-01-01.jsonl'), 'old')
    await analytics.cleanup()
    assert.ok(!fs.existsSync(path.join(analytics.directory, '2000-01-01.jsonl')))
    const capped = new Analytics({ ...config, analyticsMaxDailyBytes: 1 })
    instances.push(capped)
    capped.record('tool_view')
    await capped.flush(); assert.equal(capped.health.dropped, 1)
    const disabled = new Analytics({ ...config, analyticsEnabled: false })
    instances.push(disabled)
    disabled.record('tool_view'); await disabled.flush(); assert.equal(disabled.health.written, 0)
    fs.writeFileSync(path.join(analytics.directory, '2000-01-01.jsonl'), 'old')
    await disabled.cleanup()
    assert.ok(!fs.existsSync(path.join(analytics.directory, '2000-01-01.jsonl')), '禁用采集后仍须清理已到期日志')
    const deniedDir = path.join(dir, 'not-a-directory'); fs.writeFileSync(deniedDir, 'test')
    const denied = new Analytics({ ...config, dataDir: deniedDir })
    instances.push(denied)
    denied.record('job_finished', {}, { result: 'error' })
    await denied.flush()
    assert.equal(denied.health.dropped, 1, '磁盘故障必须吞掉且计入缺失')
    assert.equal(denied.health.writeFailures, 1)
    await denied.close()
    analytics.record('job_finished', {}, { entityId, result: 'completed' }, entityId + ':finished')
    await analytics.flush()
    assert.ok(eventsIn(analytics.directory).some(event => event.name === 'job_finished'))
  } finally { for (const instance of instances) await instance.close(); fs.rmSync(dir, { recursive: true, force: true }) }
}
await analyticsChecks()

async function lifecycleChecks(sources = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keep-lifecycle-'))
  let finishDownload, failParse = false
  const active = new Map()
  const events = []
  const load = loader({
    'docker/server/electron-shim.ts': { wsEventBus: new EventEmitter() },
    'docker/server/security.ts': { publicTarget: async () => {} },
    'electron/parsers/ytdlp.ts': { parseWithYtdlp: async () => {
      if (failParse) throw new Error('Sign in; secret-cookie')
      return { title: 'secret-title', formats: [{ formatId: 'mp4' }] }
    } },
    'electron/parsers/info-cache.ts': { retainInfoFile: () => () => {}, PARSE_CACHE_LIMIT: 100 },
    'electron/download/ytdlp.ts': {
      runYtdlpDownload: (options, outputDir) => new Promise(resolve => {
        finishDownload = () => { active.delete(options.taskId); resolve({ filePath: path.join(outputDir, 'test.mp4') }) }
        active.set(options.taskId, finishDownload)
      }),
      pauseDownload: async id => { active.get(id)?.() },
    },
    'docker/server/storage.ts': { createStorage: () => ({ save: async () => ({ key: 'test', name: 'test.mp4', size: 10, driver: 'local' }), remove: async () => {} }) },
  }, { URL, setInterval, clearInterval }, sources)
  const config = { ...load('docker/server/config.ts').readConfig({ MAX_FILE_MB: '1' }), dataDir: dir, workDir: path.join(dir, 'work'), concurrency: 1 }
  const { Jobs } = load('docker/server/jobs.ts')
  const jobs = new Jobs(config, '', { record: (name, context, fields, id) => events.push({ name, context, fields, id }) })
  const url = 'https://example.com/private?token=secret'
  const raw = { url, taskId: 'first', formatId: 'mp4' }
  try {
    await jobs.parse('owner-token', url, { input: 'user_input' })
    const first = jobs.submit('owner-token', raw)
    assert.equal(jobs.submit('owner-token', raw).id, first.id)
    jobs.parsed.clear()
    assert.equal(jobs.submit('owner-token', raw).id, first.id, '缓存过期后重放仍返回原任务')
    finishDownload(); await jobs.executions.get(first.id)
    assert.equal(first.status, 'completed')
    assert.equal(events.filter(event => event.name === 'job_created').length, 1)
    assert.equal(events.filter(event => event.name === 'job_finished').length, 1, '无需网页订阅，服务端仍记录完成结果')
    assert.equal(events.find(event => event.name === 'job_finished').fields.result, 'completed')
    assert.equal(jobs.submit('owner-token', raw).id, first.id)
    await jobs.parse('owner-token', url, { input: 'user_input' })
    const running = jobs.submit('owner-token', { ...raw, taskId: 'second' })
    const queued = jobs.submit('owner-token', { ...raw, taskId: 'third' })
    await jobs.pause('owner-token', 'third')
    await jobs.pause('owner-token', 'second')
    for (const job of [running, queued]) {
      const terminals = events.filter(event => event.name === 'job_finished' && event.fields.entityId === job.analytics.entityId)
      assert.equal(terminals.length, 1); assert.equal(terminals[0].fields.result, 'cancelled')
    }
    assert.equal(jobs.submit('owner-token', { ...raw, taskId: 'third' }).id, queued.id, '取消后的重放不是新尝试')
    first.createdAt -= config.ttl + 1
    assert.equal(jobs.view(first).fileExists, false)
    assert.equal(jobs.view(first).filePath, undefined)
    failParse = true
    await assert.rejects(jobs.parse('owner-token', url))
    const failure = events.find(event => event.name === 'parse_finished' && event.fields.result === 'error')
    assert.equal(failure.fields.code, 'authentication')
    assert.ok(!JSON.stringify(events).includes('secret') && !JSON.stringify(events).includes('owner-token'))
  } finally { await jobs.close(); fs.rmSync(dir, { recursive: true, force: true }) }
}
await lifecycleChecks()
for (const [file, before, after, check] of [
  ['docker/server/analytics.ts', 'if (!this.config.analyticsEnabled || this.stopped) return', 'if (this.stopped) return', analyticsChecks],
  ['docker/server/analytics-store.ts', 'dayBytes + bytes > maxDailyBytes', 'false', analyticsChecks],
  ['docker/server/jobs.ts', 'if (existing) return existing', 'if (false) return existing!', lifecycleChecks],
  ['docker/server/jobs.ts', "this.recordFinished(job)\n        this.emit", "void 0\n        this.emit", lifecycleChecks],
]) {
  const source = fs.readFileSync(file, 'utf8'); assert.ok(source.includes(before))
  await assert.rejects(check({ [file]: source.replace(before, after) }), '统计变异必须被拦住：' + before)
}
console.log('通过：事件脱敏、持久化、轮转、禁用、磁盘故障、幂等、取消、关页收尾及 4 个统计变异反证')

function reportChecks(sources = {}) {
  const load = loader({}, { URL, Intl }, sources)
  const { buildReport } = load('docker/server/report.ts')
  const { webErrorCode } = load('shared/web-errors.ts')
  assert.equal(webErrorCode({ message: '[[deps-missing:yt-dlp]]未找到可用的 yt-dlp' }), 'runtime-unavailable')
  const options = { from: '2026-10-23T00:00:00Z', to: '2026-10-24T00:00:00Z', asOf: '2026-10-25T00:00:00Z', timezone: 'UTC', environment: 'production', includeTests: false, input: 'all' }
  const event = (name, entityId, fields = {}) => ({ v: 1, id: name + ':' + entityId, name, entityId, at: '2026-10-23T12:00:00Z', environment: 'production', input: 'user_input', platform: 'youtube', language: 'en', utm: 'direct_or_unknown', referrer: 'direct_or_unknown', ...fields })
  const rows = [
    event('job_created', 'one'), event('job_finished', 'one', { result: 'completed', at: '2026-10-24T01:00:00Z' }),
    event('job_created', 'two'), event('job_created', 'three', { test: true }),
    event('job_finished', 'three', { test: true, result: 'error' }),
    event('file_delivery_finished', 'part', { method: 'GET', status: 206, result: 'completed', bytes: 8 }),
  ]
  const report = buildReport([...rows, rows[1]], options)
  assert.equal(report.jobs.created, 2)
  assert.equal(report.jobs.completed, 1)
  assert.equal(report.jobs.completionRatePercent, 100)
  assert.equal(report.jobs.queuedOrMissing, 1)
  assert.equal(report.delivery.completedFullResponses, 0)
  assert.equal(report.delivery.completedRangeResponses, 1)
  assert.equal(report.coverage.duplicateEvents, 1)
  assert.equal(buildReport(rows, { ...options, asOf: options.to }).jobs.completed, 0)
}
reportChecks()
for (const [file, before, after] of [
  ['docker/server/report.ts', 'rate(jobs.outcomes.completed, jobs.finished.length)', 'rate(jobs.outcomes.completed, jobs.starts.size)'],
  ['docker/server/report.ts', '!options.includeTests && e.test', 'false'],
  ['docker/server/report.ts', 'event.status === 200', 'true'],
  ['docker/server/report.ts', 'Date.parse(e.at) > asOf', 'false'],
  ['shared/web-errors.ts', "return 'runtime-unavailable'", "return 'unknown'"],
]) {
  const source = fs.readFileSync(file, 'utf8'); assert.ok(source.includes(before))
  assert.throws(() => reportChecks({ [file]: source.replaceAll(before, after) }), '口径变异必须被拦住：' + before)
}
console.log('通过：批次分母、测试排除、Range、截止时间、依赖错误及 5 个口径变异反证')

function quotaChecks(sources = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keep-quota-'))
  const load = loader({}, { URL }, sources)
  const { SessionQuota, quotaRetryAt } = load('docker/server/quota.ts')
  const { StateStore } = load('docker/server/state.ts')
  const { readConfig } = load('docker/server/config.ts')
  const config = { ...readConfig({ WEB_PARSE_HOURLY_LIMIT: '1', WEB_PARSE_DAILY_LIMIT: '2', WEB_DOWNLOAD_DAILY_LIMIT: '1', ANALYTICS_ENABLED: '0' }), dataDir: dir }
  const now = Date.now(), hour = 3600000, day = 24 * hour
  const limited = code => error => error.code === code && error.retryAfterSeconds > 0
  let state
  try {
    assert.throws(() => readConfig({ SITE_URL: 'https://example.com' }), /ANALYTICS_ENVIRONMENT/)
    assert.equal(readConfig({ SITE_URL: 'https://example.com', ANALYTICS_ENVIRONMENT: 'production' }).analyticsEnvironment, 'production')
    assert.equal(quotaRetryAt([now - hour], [{ duration: hour, limit: 1 }], now), now)
    state = new StateStore(dir)
    let quota = new SessionQuota(config, state)
    quota.consume('fixture-owner-token', 'parse', now)
    assert.throws(() => quota.consume('fixture-owner-token', 'parse', now + 1), limited('parse-quota'))
    state.close(); state = new StateStore(dir)
    quota = new SessionQuota(config, state)
    assert.throws(() => quota.consume('fixture-owner-token', 'parse', now + 1), limited('parse-quota'), '重启不能重置额度')
    quota.consume('fixture-other-token', 'parse', now + 1)
    quota.consume('fixture-owner-token', 'parse', now + hour)
    assert.throws(() => quota.consume('fixture-owner-token', 'parse', now + 2 * hour), limited('parse-quota'), '小时窗口释放后，日额度仍生效')
    quota.consume('fixture-owner-token', 'parse', now + day)
    quota.consume('fixture-owner-token', 'download', now)
    assert.throws(() => quota.consume('fixture-owner-token', 'download', now + 1), limited('download-quota'))
    const file = path.join(dir, 'state.sqlite'), text = JSON.stringify(state.db.prepare('SELECT * FROM quota').all())
    assert.ok(!text.includes('fixture-owner-token') && !text.includes('fixture-other-token'), '清单只保存会话散列与计额时间')
    if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600)
    quota.cleanup(now + 2 * day)
    assert.equal(state.db.prepare('SELECT COUNT(*) AS n FROM quota').get().n, 0, '过期额度不无限保留')
    state.db.exec('PRAGMA query_only = ON')
    assert.throws(() => quota.consume('fixture-owner-token', 'parse', now + 3 * day), error => error.code === 'storage', '落盘失败必须拒绝执行')
    state.db.exec('PRAGMA query_only = OFF')
    quota.consume('fixture-owner-token', 'parse', now + 3 * day)
  } finally { state?.close(); fs.rmSync(dir, { recursive: true, force: true }) }
}

async function accessChecks(sources = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keep-access-'))
  let calls = 0, fail = true
  const events = []
  const load = loader({
    'docker/server/electron-shim.ts': { wsEventBus: new EventEmitter() },
    'docker/server/security.ts': { publicTarget: async () => {} },
    'electron/parsers/ytdlp.ts': { parseWithYtdlp: async () => {
      calls++
      if (fail) throw new Error("Sign in to confirm you're not a bot https://example.com/?token=fixture-secret")
      return { title: '测试', formats: [{ formatId: 'mp4' }] }
    } },
    'electron/parsers/info-cache.ts': { retainInfoFile: () => () => {}, PARSE_CACHE_LIMIT: 100 },
    'electron/download/ytdlp.ts': { runYtdlpDownload: async (_options, dir) => ({ filePath: path.join(dir, 'test.mp4') }), pauseDownload: async () => {} },
    'docker/server/storage.ts': { createStorage: () => ({ save: async () => ({ key: 'test', name: 'test.mp4', size: 10, driver: 'local' }), remove: async () => {} }) },
  }, { URL, setInterval, clearInterval }, sources)
  const config = { ...load('docker/server/config.ts').readConfig({ WEB_PARSE_HOURLY_LIMIT: '3', WEB_DOWNLOAD_DAILY_LIMIT: '1' }), dataDir: dir, workDir: path.join(dir, 'work') }
  const { Jobs } = load('docker/server/jobs.ts')
  const jobs = new Jobs(config, '', { record: (name, _context, fields) => events.push({ name, ...fields }) })
  const url = 'https://youtube.com/watch?v=fixture'
  try {
    await assert.rejects(jobs.parse('owner', url), error => error.code === 'verification-required' && error.retryAfterSeconds === 300)
    await assert.rejects(jobs.parse('owner', url), error => error.code === 'verification-required' && error.retryAfterSeconds > 0)
    assert.equal(calls, 1, '冷却期不再次请求来源站点')
    assert.equal(events.filter(e => e.name === 'parse_finished').length, 1)
    assert.equal(events.filter(e => e.name === 'parse_rejected').length, 1)
    assert.ok(!JSON.stringify(events).includes('fixture-secret'))
    await assert.rejects(jobs.parse('other', url))
    assert.equal(calls, 2, '来源限制缓存按会话隔离')
    fail = false
    const otherUrl = 'https://example.com/allowed'
    await jobs.parse('owner', otherUrl)
    await jobs.parse('owner', otherUrl)
    await assert.rejects(jobs.parse('owner', 'https://example.com/quota'), error => error.code === 'parse-quota')
    assert.equal(calls, 4, '超过累计额度的请求不启动下载器')
    const raw = { taskId: 'first', url: otherUrl, formatId: 'mp4' }
    const job = jobs.submit('owner', raw)
    assert.equal(jobs.submit('owner', raw).id, job.id, '幂等重放不重复扣额')
    await jobs.executions.get(job.id)
    await jobs.remove('owner', job.id)
    assert.throws(() => jobs.submit('owner', { ...raw, taskId: 'second' }), error => error.code === 'download-quota', '删除旧任务不返还滚动下载额度')
    assert.ok(events.some(event => event.name === 'job_rejected' && event.code === 'download-quota'), '下载额度拒绝单列，不并入已创建任务失败率')
  } finally { await jobs.close(); fs.rmSync(dir, { recursive: true, force: true }) }
}

quotaChecks()
await accessChecks()
for (const [file, before, after, check] of [
  ['docker/server/quota.ts', "db.prepare('INSERT INTO quota VALUES (?, ?, ?)').run(id, action, now)", 'void 0', quotaChecks],
  ['docker/server/quota.ts', 'active.length >= limit', 'false', quotaChecks],
  ['docker/server/quota.ts', "{ duration: DAY, limit: limits.parses }", "{ duration: HOUR, limit: limits.parses }", quotaChecks],
  ['docker/server/config.ts', "!localOrigin && env.ANALYTICS_ENABLED !== '0'", "false && env.ANALYTICS_ENABLED !== '0'", quotaChecks],
  ['docker/server/jobs.ts', "this.quota.consume(owner, 'parse', Date.now(), () => this.platform.parse(owner, parseId))", 'this.platform.parse(owner, parseId)', accessChecks],
  ['docker/server/jobs.ts', "this.quota.consume(owner, 'download', Date.now(), () => { this.state.insertJob(job); this.platform.download(owner, id); commit?.(job) })", 'this.state.insertJob(job); this.platform.download(owner, id); commit?.(job)', accessChecks],
  ['docker/server/jobs.ts', "this.analytics?.record('job_rejected'", "this.analytics?.record('job_created'", accessChecks],
  ['docker/server/jobs.ts', 'restriction && restriction.until > Date.now()', 'false', accessChecks],
]) {
  const source = fs.readFileSync(file, 'utf8'); assert.ok(source.includes(before))
  await assert.rejects(async () => check({ [file]: source.replace(before, after) }), '额度与访问限制变异必须被拦住：' + before)
}
console.log('通过：累计额度、重启持久化、环境漏配、来源冷却与 8 个变异反证')

function optimizationReportChecks(sources = {}) {
  const load = loader({}, { URL, Intl }, sources)
  const { buildReport } = load('docker/server/report.ts')
  const { classifyParseError } = load('shared/parse-error.ts')
  const { platformCategory } = load('shared/web-analytics.ts')
  assert.equal(classifyParseError("Sign in to confirm you're not a bot"), 'verification-required')
  assert.equal(platformCategory('https://pin.it/fixture'), 'pinterest')
  assert.equal(platformCategory('https://pin.it.example.com/fixture'), 'other')
  const options = { from: '2026-10-23T00:00:00Z', to: '2026-10-24T00:00:00Z', asOf: '2026-10-25T00:00:00Z', timezone: 'UTC', environment: 'production', includeTests: false, input: 'all' }
  const event = (name, id, fields = {}) => ({ v: 1, id: name + ':' + id, entityId: id, name, at: '2026-10-23T12:00:00Z', environment: 'production', input: 'user_input', platform: 'youtube', language: 'en', utm: 'direct_or_unknown', referrer: 'direct_or_unknown', ...fields })
  assert.ok(buildReport([event('tool_view', 'dev', { environment: 'development' })], options).coverage.warnings.length > 0)
  const rows = []
  for (const [sessionId, count, result] of [['first', 70, 'success'], ['second', 30, 'success'], ['third', 2, 'error']]) {
    rows.push(event('tool_view', sessionId, { sessionId }))
    for (let i = 0; i < count; i++) {
      rows.push(event('parse_requested', sessionId + i, { sessionId }))
      rows.push(event('parse_finished', sessionId + i, { result }))
    }
  }
  let report = buildReport(rows, options)
  assert.equal(report.breakdown.platform[0].parseError, 2)
  assert.equal(report.parses.concentration.topTwoRequests, 100)
  assert.equal(report.parses.concentration.withoutTopTwo.successRatePercent, 0)
  assert.equal(report.usage.successfulParseSessions, 2)
  rows.push(event('job_created', 'job', { sessionId: 'first' }), event('job_finished', 'job', { result: 'completed' }),
    event('file_delivery_finished', 'job', { method: 'GET', status: 200, result: 'completed' }))
  report = buildReport(rows, options)
  assert.equal(report.usage.fullyDeliveredSessions, 1)
  assert.equal(report.delivery.distinctFullResponseJobs, 1)
}
optimizationReportChecks()
for (const [file, before, after] of [
  ['shared/parse-error.ts', "return 'verification-required'", "return 'authentication'"],
  ['shared/web-analytics.ts', "'pin.it': 'pinterest'", "'pin.it': 'other'"],
  ['docker/server/report.ts', 'Object.keys(environmentEvents).length', 'false'],
  ['docker/server/report.ts', 'group.parseError++', 'void 0'],
  ['docker/server/report.ts', '!topTwo.has(event.sessionId)', 'true'],
  ['docker/server/report.ts', 'fullyDelivered.has(event.entityId)', 'false'],
]) {
  const source = fs.readFileSync(file, 'utf8'); assert.ok(source.includes(before))
  assert.throws(() => optimizationReportChecks({ [file]: source.replace(before, after) }), '优化口径变异必须被拦住：' + before)
}
console.log('通过：环境警告、平台细分、会话漏斗、集中度、真人验证分类与 6 个变异反证')
