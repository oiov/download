import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { parseWithYtdlp } from '../../electron/parsers/ytdlp'
import { runYtdlpDownload, pauseDownload } from '../../electron/download/ytdlp'
import { retainInfoFile, PARSE_CACHE_LIMIT } from '../../electron/parsers/info-cache'
import { wsEventBus } from './electron-shim'
import { publicTarget } from './security'
import { createStorage, type StoredFile } from './storage'
import type { Config } from './config'
import type { Analytics } from './analytics'
import { cleanContext, EXAMPLE_URL, platformCategory, type AnalyticsContext } from '../../shared/web-analytics'
import { WebError, webErrorCode, isSourceRestriction } from '../../shared/web-errors'
import { SessionQuota } from './quota'
import { StateStore } from './state'
import { PlatformStore } from './platform-store'
import { cleanupDownloadHistory } from './download-history'

const SOURCE_RETRY_DELAY = 5 * 60000

export interface Job {
  id: string; owner: string; clientId: string; url: string; title: string; createdAt: number
  status: 'pending' | 'downloading' | 'completed' | 'error' | 'paused'
  progress: number; file?: StoredFile; localPath?: string; error?: string; options?: any
  errorCode?: string; phase?: 'queued' | 'downloading' | 'merging' | 'uploading'
  analytics?: AnalyticsContext & { entityId: string; parseId?: string }
  startedAt?: number; downloadEndedAt?: number; finishedAt?: number
  queueMs?: number; downloadMs?: number; uploadMs?: number
  request?: { mode: string; formatId: string; quality?: string; audioTrack?: string; subtitles: string[] }
}

export class Jobs extends EventEmitter {
  jobs = new Map<string, Job>()
  parsed = new Map<string, { time: number; info: any; context?: AnalyticsContext; parseId?: string }>()
  parsedRecords = new Map<string, { owner: string; url: string; time: number; info: any; context?: AnalyticsContext; parseId: string }>()
  running = 0
  parsing = 0
  closing = false
  executions = new Map<string, Promise<void>>()
  private releases = new Map<string, () => void>()
  private controllers = new Map<string, AbortController>()
  private pauseRequests = new Map<string, Promise<void>>()
  private parseWaiters = new Set<() => void>()
  private restrictedParses = new Map<string, { code: string; until: number }>()
  private quota: SessionQuota
  readonly state: StateStore
  readonly platform: PlatformStore
  private closed = false
  storage: ReturnType<typeof createStorage>
  constructor(public config: Config, public proxy: string, private analytics?: Analytics) {
    super()
    this.setMaxListeners(100)
    this.storage = createStorage(config)
    fs.mkdirSync(config.dataDir, { recursive: true })
    fs.mkdirSync(config.workDir, { recursive: true })
    this.state = new StateStore(config.dataDir)
    this.platform = new PlatformStore(this.state.db, config)
    try {
      // 崩溃时实际交付量未知，保留剩余预留到窗口过期，不能靠重启恢复流量额度。
      this.state.db.prepare("UPDATE usage_events SET status = 'uncertain' WHERE kind = 'delivery' AND status = 'streaming'").run()
      this.quota = new SessionQuota(config, this.state)
      for (const job of this.state.allJobs()) {
        if (job.file && job.file.driver !== config.storage) throw new Error('请先清理旧存储任务再切换存储驱动')
        if (job.status === 'pending' || job.status === 'downloading') {
          job.status = 'error'; job.error = '服务已重启，请重新解析下载'; job.errorCode = 'interrupted'
          job.finishedAt = Date.now()
          this.state.saveJob(job)
          this.recordFinished(job)
        }
        this.jobs.set(job.id, job)
      }
    } catch (error) { this.state.close(); throw error }
    wsEventBus.on('download:progress', data => {
      const job = this.jobs.get(data.taskId)
      if (!job || job.status !== 'downloading') return
      const phase = data.status === 'merging' || data.status === 'completed' ? 'merging' : 'downloading'
      if (job.phase !== phase) {
        job.phase = phase
        if (job.analytics) this.analytics?.record('job_stage', job.analytics, { entityId: job.analytics.entityId, phase })
        this.emit('updated', job.owner)
      }
      job.progress = Math.min(98, data.percent || 0)
      this.emit('progress', job.owner, { taskId: job.clientId, status: phase, percent: job.progress, speed: data.speed, eta: data.eta, totalSize: data.totalSize })
    })
  }
  persist(job: Job) { this.state.saveJob(job) }
  view(job: Job) {
    const expiresAt = job.createdAt + this.config.ttl
    const fileExists = !!job.file && Date.now() < expiresAt
    return { id: job.id, clientId: job.clientId, title: job.title, url: job.url, status: job.status, phase: job.phase, progress: job.progress, errorCode: job.errorCode, createdAt: new Date(job.createdAt).toISOString(), expiresAt: new Date(expiresAt).toISOString(), filePath: fileExists ? '/api/files/' + job.id : undefined, fileExists, quality: job.file?.name || '', format: job.file ? path.extname(job.file.name).slice(1) : '' }
  }
  list(owner: string) { return this.state.jobsForOwner(owner).map(j => this.view(this.jobs.get(j.id) || j)) }
  async parse(owner: string, raw: unknown, metadata: Partial<AnalyticsContext> = {}) {
    const context = cleanContext({ ...metadata, platform: platformCategory(raw), input: raw === EXAMPLE_URL ? 'example' : metadata.input === 'user_input' ? 'user_input' : 'unknown' })
    const reject = (code: string, message: string, retryAfterSeconds?: number): never => {
      this.analytics?.record('parse_rejected', context, { result: 'rejected', code })
      throw new WebError(code, message, retryAfterSeconds)
    }
    if (this.closing) reject('stopping', '服务正在停止')
    if (typeof raw !== 'string' || raw.length > 4096) reject('invalid-url', '链接无效')
    if (this.parsing >= this.config.concurrency) reject('busy', '解析繁忙，请稍后重试')
    const input = raw as string
    const restrictionKey = createHash('sha256').update(owner + '\0' + input).digest('hex')
    const restriction = this.restrictedParses.get(restrictionKey)
    if (restriction && restriction.until > Date.now()) reject(restriction.code, '来源限制尚未解除，请勿反复重试同一链接', Math.ceil((restriction.until - Date.now()) / 1000))
    this.restrictedParses.delete(restrictionKey)
    this.parsing++
    const parseId = randomUUID(), startedAt = Date.now()
    let accepted = false
    try {
      try { this.quota.consume(owner, 'parse', Date.now(), () => this.platform.parse(owner, parseId)) }
      catch (error) { reject(webErrorCode(error), '无法预留解析额度，请稍后重试', error instanceof WebError ? error.retryAfterSeconds : undefined) }
      try { await publicTarget(input) } catch { reject('invalid-url', '链接无效或不是公网地址') }
      accepted = true
      this.analytics?.record('parse_requested', context, { entityId: parseId })
      const info = await parseWithYtdlp(input, '', this.proxy)
      this.platform.finish('parse:' + parseId, 'success')
      const key = owner + ':' + input
      this.parsed.delete(key)
      this.parsed.set(key, { time: Date.now(), info, context, parseId })
      this.parsedRecords.set(parseId, { owner, url: input, time: Date.now(), info, context, parseId })
      while (this.parsed.size > PARSE_CACHE_LIMIT) this.parsed.delete(this.parsed.keys().next().value!)
      while (this.parsedRecords.size > PARSE_CACHE_LIMIT) this.parsedRecords.delete(this.parsedRecords.keys().next().value!)
      const { cacheFile, ...publicInfo } = info
      this.analytics?.record('parse_finished', context, { entityId: parseId, result: 'success', durationMs: Date.now() - startedAt })
      return { ...publicInfo, parseId }
    } catch (error) {
      const code = webErrorCode(error)
      if (accepted) {
        this.platform.finish('parse:' + parseId, 'error')
        this.analytics?.record('parse_finished', context, { entityId: parseId, result: 'error', code, durationMs: Date.now() - startedAt })
        if (isSourceRestriction(code)) {
          this.restrictedParses.set(restrictionKey, { code, until: Date.now() + SOURCE_RETRY_DELAY })
          while (this.restrictedParses.size > 1000) this.restrictedParses.delete(this.restrictedParses.keys().next().value!)
          throw new WebError(code, '来源要求验证或登录，当前在线请求无法继续', SOURCE_RETRY_DELAY / 1000)
        }
      }
      throw error
    } finally {
      this.parsing--
      if (!this.parsing) { for (const resolve of this.parseWaiters) resolve(); this.parseWaiters.clear() }
    }
  }
  submit(owner: string, raw: any, commit?: (job: Job) => void) {
    if (this.closing) throw new WebError('stopping', '服务正在停止')
    if (typeof raw?.taskId !== 'string' || raw.taskId.length > 120) throw new WebError('invalid-url', '任务标识无效')
    // 重连重放即使发生在解析缓存失效后，也只返回原任务；重试必须使用新标识。
    const saved = this.state.findJob(owner, raw.taskId)
    const existing = saved ? this.jobs.get(saved.id) || saved : undefined
    if (existing) return existing
    const record = typeof raw.parseId === 'string' ? this.parsedRecords.get(raw.parseId) : undefined
    const parsed = raw.parseId ? record?.owner === owner && record.url === raw.url ? record : undefined : this.parsed.get(owner + ':' + raw?.url)
    if (!parsed || Date.now() - parsed.time > 20 * 60000) throw new WebError('parse-required', '请先重新解析链接')
    const reject = (error: WebError): never => {
      this.analytics?.record('job_rejected', parsed.context, { parseId: parsed.parseId, result: 'rejected', code: error.code })
      throw error
    }
    if ([...this.jobs.values()].filter(j => ['pending', 'downloading'].includes(j.status)).length >= this.config.maxQueued || [...this.jobs.values()].filter(j => j.owner === owner).length >= this.config.maxSessionTasks) reject(new WebError('queue-full', '任务数量达到上限，请删除旧任务后重试'))
    const mode = ['video', 'audio', 'subtitle'].includes(raw.downloadMode) ? raw.downloadMode : 'video'
    const formats = [...parsed.info.formats, ...(parsed.info.audioFormats || [])]
    const format = formats.find((f: any) => f.formatId === raw.formatId)
    if (!format && mode !== 'subtitle') reject(new WebError('format-unavailable', '请选择解析结果中的格式'))
    const id = randomUUID()
    const job: Job = { id, owner, clientId: raw.taskId, url: raw.url, title: parsed.info.title, createdAt: Date.now(), status: 'pending', phase: 'queued', progress: 0,
      analytics: { ...cleanContext(parsed.context), entityId: randomUUID(), parseId: parsed.parseId } }
    job.options = { url: job.url, taskId: id, outputDir: path.join(this.config.workDir, id), formatId: format?.formatId || 'best', hasAudio: format?.hasAudio, downloadMode: mode, filenameTemplate: '%(title).120B.%(ext)s', proxy: this.proxy, cookiesFile: '', cacheFile: parsed.info.cacheFile, acceleration: { enabled: false }, subtitles: (parsed.info.subtitles || []).filter((s: any) => Array.isArray(raw.subtitles) && raw.subtitles.includes(s.language)).map((s: any) => s.language), audioTrack: (parsed.info.audioTracks || []).find((a: any) => a.id === raw.audioTrack?.id) }
    job.request = { mode, formatId: job.options.formatId, quality: format?.quality, audioTrack: job.options.audioTrack?.id, subtitles: job.options.subtitles }
    try { this.quota.consume(owner, 'download', Date.now(), () => { this.state.insertJob(job); this.platform.download(owner, id); commit?.(job) }) }
    catch (error) { reject(error instanceof WebError ? error : new WebError('storage', '无法保存会话额度')) }
    this.jobs.set(id, job)
    this.analytics?.record('job_created', job.analytics, { entityId: job.analytics!.entityId, parseId: parsed.parseId, phase: 'queued' }, job.analytics!.entityId + ':created')
    this.releases.set(id, retainInfoFile(job.options.cacheFile))
    this.emit('updated', owner); this.pump()
    return job
  }
  pump() {
    if (this.closing) return
    for (const job of this.jobs.values()) {
      if (this.running >= this.config.concurrency) break
      if (job.status !== 'pending') continue
      if ([...this.jobs.values()].filter(other => other.owner === job.owner && this.executions.has(other.id)).length >= this.platform.limits(job.owner).concurrent) continue
      this.running++; job.status = 'downloading'; job.phase = 'downloading'; job.startedAt = Date.now()
      job.queueMs = job.startedAt - job.createdAt
      try { this.persist(job) }
      catch {
        job.status = 'error'; job.errorCode = 'storage'; job.error = '任务保存失败'
        job.finishedAt = Date.now()
        this.releases.get(job.id)?.(); this.releases.delete(job.id)
        delete job.options
        try { this.persist(job) } catch { /* 仍无法提交时保留旧记录，重启按中断恢复。 */ }
        this.recordFinished(job)
        this.running--; this.emit('finished', job); this.emit('updated', job.owner)
        continue
      }
      if (job.analytics) this.analytics?.record('job_started', job.analytics, { entityId: job.analytics.entityId, queueMs: job.queueMs, phase: 'downloading' }, job.analytics.entityId + ':started')
      this.emit('updated', job.owner)
      const execution = this.run(job).catch(() => { job.status = 'error'; job.errorCode = 'storage'; job.error = '任务保存失败' }).finally(() => {
        job.finishedAt ||= Date.now()
        this.recordFinished(job)
        this.emit('finished', job); this.emit('updated', job.owner)
        this.executions.delete(job.id); this.running--; this.pump()
      })
      this.executions.set(job.id, execution)
    }
  }
  async run(job: Job) {
    const dir = job.options.outputDir
    const abort = new AbortController()
    this.controllers.set(job.id, abort)
    const stop = (message: string, code: string) => {
      job.status = 'error'; job.error = message; job.errorCode = code; abort.abort()
      void pauseDownload(job.id).catch(() => { job.error = '无法停止下载进程，请稍后重试' })
    }
    const timeout = setTimeout(() => stop('任务超时', 'timeout'), this.config.taskTimeout)
    const sizeCheck = setInterval(() => {
      try {
        const size = fs.readdirSync(dir).reduce((sum, name) => sum + fs.statSync(path.join(dir, name)).size, 0)
        if (size > this.config.maxFileBytes) stop('文件超过大小限制', 'too-large')
      } catch {}
    }, 2000)
    try {
      fs.mkdirSync(dir, { recursive: true })
      const result = await runYtdlpDownload(job.options, dir)
      job.downloadEndedAt = Date.now()
      if (job.status !== 'downloading' || result.paused) { if (job.status === 'downloading') job.status = 'paused'; return }
      const filePath = result.filePath
      if (!filePath || !path.resolve(filePath).startsWith(path.resolve(dir) + path.sep)) throw new Error('没有生成可下载文件')
      job.localPath = filePath
      job.phase = 'uploading'; this.emit('updated', job.owner)
      if (job.analytics) this.analytics?.record('job_stage', job.analytics, { entityId: job.analytics.entityId, phase: 'uploading' })
      job.file = await this.storage.save(filePath, job.owner + '/' + job.id + '/' + path.basename(filePath), abort)
      if (job.status !== 'downloading') { await this.storage.remove(job.file); delete job.file; return }
      job.status = 'completed'; job.progress = 100
      if (this.config.storage === 'r2') fs.rmSync(dir, { recursive: true, force: true })
    } catch (error) { if (job.status !== 'paused') { job.status = 'error'; job.errorCode ||= job.phase === 'uploading' ? 'storage' : webErrorCode(error); job.error ||= '下载或保存失败，请重试或选择其他格式' } }
    finally {
      const ended = Date.now()
      job.downloadMs = (job.downloadEndedAt || ended) - (job.startedAt || job.createdAt)
      job.uploadMs = job.downloadEndedAt && job.phase === 'uploading' ? ended - job.downloadEndedAt : 0
      clearTimeout(timeout); clearInterval(sizeCheck)
      this.controllers.delete(job.id)
      this.releases.get(job.id)?.(); this.releases.delete(job.id)
      if (job.status !== 'completed') fs.rmSync(dir, { recursive: true, force: true })
      delete job.options
      job.finishedAt = ended
      this.persist(job)
    }
  }
  private recordFinished(job: Job) {
    this.platform.finish('job:' + job.id, job.status, job.status === 'completed' ? job.file?.size || 0 : 0)
    if (!job.analytics) return
    this.analytics?.record('job_finished', job.analytics, {
      entityId: job.analytics.entityId, result: job.status === 'completed' ? 'completed' : job.status === 'paused' && !job.errorCode ? 'cancelled' : 'error',
      code: job.errorCode, queueMs: job.queueMs, downloadMs: job.downloadMs, uploadMs: job.uploadMs,
      durationMs: (job.finishedAt || Date.now()) - job.createdAt, bytes: job.file?.size,
    }, job.analytics.entityId + ':finished')
  }
  claim(guest: string, owner: string) {
    this.platform.claim(guest, owner)
    for (const job of this.jobs.values()) if (job.owner === guest) job.owner = owner
    for (const key of this.parsed.keys()) if (key.startsWith(guest + ':')) this.parsed.delete(key)
    for (const [key, value] of this.parsedRecords) if (value.owner === guest) this.parsedRecords.delete(key)
    this.emit('updated', owner)
  }
  async pause(owner: string, clientId: string) {
    const job = [...this.jobs.values()].find(j => j.owner === owner && j.clientId === clientId && (this.executions.has(j.id) || ['pending', 'downloading'].includes(j.status)))
    if (!job) return
    const existing = this.pauseRequests.get(job.id)
    if (existing) return existing
    const request = this.pauseJob(job).finally(() => this.pauseRequests.delete(job.id))
    this.pauseRequests.set(job.id, request)
    return request
  }
  private async pauseJob(job: Job) {
    const pending = job.status === 'pending'
    const previous = job.status
    job.status = 'paused'
    try { await pauseDownload(job.id) }
    catch (error) { job.status = previous; throw error }
    this.controllers.get(job.id)?.abort()
    await this.executions.get(job.id)
    if (pending) {
      this.releases.get(job.id)?.(); this.releases.delete(job.id)
      delete job.options; job.finishedAt = Date.now(); job.queueMs = job.finishedAt - job.createdAt
      this.persist(job)
      this.recordFinished(job); this.emit('finished', job)
    }
    this.persist(job); this.emit('updated', job.owner)
  }
  async remove(owner: string, id: string) {
    const job = this.jobs.get(id)
    if (!job || job.owner !== owner || this.executions.has(id) || ['pending', 'downloading'].includes(job.status)) throw new Error('任务不存在或仍在运行')
    if (job.file) await this.storage.remove(job.file)
    fs.rmSync(path.join(this.config.workDir, id), { recursive: true, force: true })
    this.state.removeJob(id, owner); this.jobs.delete(id)
  }
  async cleanup() {
    // 额度清理失败不重置预算，也不能变成未处理的后台异常。
    try { this.quota.cleanup() } catch { console.warn('会话额度清理失败，将在下一轮重试') }
    try { cleanupDownloadHistory(this.state.db, this.config.historyRetentionDays) }
    catch { console.warn('下载历史清理失败，将在下一轮重试') }
    for (const [key, restriction] of this.restrictedParses) if (restriction.until <= Date.now()) this.restrictedParses.delete(key)
    for (const job of this.jobs.values()) {
      if (Date.now() - job.createdAt > this.config.ttl && !['pending', 'downloading'].includes(job.status)) {
        try { await this.remove(job.owner, job.id) } catch { /* 保留清单，下次继续删除。 */ }
      }
    }
    for (const [key, value] of this.parsed) if (Date.now() - value.time > 20 * 60000) this.parsed.delete(key)
    for (const [key, value] of this.parsedRecords) if (Date.now() - value.time > 20 * 60000) this.parsedRecords.delete(key)
  }
  async close() {
    if (this.closed) return
    this.closing = true
    await Promise.all([...this.jobs.values()].map(async job => {
      if (job.status === 'pending' || job.status === 'downloading') { job.errorCode = 'stopping'; await this.pause(job.owner, job.clientId) }
      else if (this.executions.has(job.id)) {
        await pauseDownload(job.id)
        this.controllers.get(job.id)?.abort()
      }
    }))
    await Promise.all(this.executions.values())
    if (this.parsing) await new Promise<void>(resolve => this.parseWaiters.add(resolve))
    this.state.close()
    this.closed = true
  }
}
