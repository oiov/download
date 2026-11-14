import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import type { Config } from './config'
import type { buildReport, ReportOptions } from './report'
import type { SeeMessage } from '../../src/i18n/see'

export class SeeError extends Error {
  constructor(public status: number, public key: SeeMessage, public retryAfter = 0) { super(key) }
}

export interface SeeFilter {
  days: number
  environment: 'production' | 'development' | 'test'
  input: ReportOptions['input']
  timezone?: string
  includeTests?: boolean
}
export type SeeReport = ReturnType<typeof buildReport> & {
  reader: { backend: string; filesRead: number; malformedLines: number; health?: { since: string; written: number; dropped: number; writeFailures: number } | null }
}

export function seeFilter(params: URLSearchParams): SeeFilter {
  for (const key of params.keys()) if (!['days', 'environment', 'input', 'timezone', 'include-tests'].includes(key) || params.getAll(key).length !== 1) throw new SeeError(400, 'invalidFilter')
  const days = params.get('days') || '7', environment = params.get('environment') || 'production', input = params.get('input') || 'all'
  if (!['1', '7', '30'].includes(days) || !['production', 'development', 'test'].includes(environment) || !['all', 'user_input', 'example', 'unknown'].includes(input)) throw new SeeError(400, 'invalidFilter')
  const timezone = params.get('timezone'), includeTests = params.get('include-tests')
  if (includeTests !== null && includeTests !== '1') throw new SeeError(400, 'invalidFilter')
  if (timezone !== null) { try { if (timezone.length > 80) throw new Error(); new Intl.DateTimeFormat('en', { timeZone: timezone }) } catch { throw new SeeError(400, 'invalidFilter') } }
  return { days: Number(days), environment: environment as SeeFilter['environment'], input: input as SeeFilter['input'], ...(timezone ? { timezone } : {}), ...(includeTests ? { includeTests: true } : {}) }
}

/** 复用镜像内 CLI；开发模式用同一源码，不让同步 SQLite 查询阻塞下载进程。 */
export function runSeeReport(root: string, directory: string, options: ReportOptions, signal: AbortSignal): Promise<SeeReport> {
  const bundled = path.join(root, 'analytics-report.mjs')
  const entry = fs.existsSync(bundled) ? [bundled] : ['--import', 'tsx', path.join(root, 'scripts/analytics-report.ts')]
  const args = ['--max-old-space-size=256', ...entry, '--dir', directory, '--from', options.from, '--to', options.to, '--as-of', options.asOf,
    '--timezone', options.timezone, '--environment', options.environment, '--input', options.input, '--format', 'json', ...(options.includeTests ? ['--include-tests'] : [])]
  return new Promise((resolve, reject) => {
    // 子进程只需运行时环境，不继承看板密码、R2 密钥或 NODE_OPTIONS。
    const env = Object.fromEntries(['PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR'].flatMap(key => process.env[key] ? [[key, process.env[key]!]] : []))
    const child = execFile(process.execPath, args, { cwd: root, env, signal, timeout: 20000, killSignal: 'SIGKILL', maxBuffer: 2 * 1024 * 1024, windowsHide: true }, (error, stdout) => {
      if (error) {
        const fail = () => reject(new SeeError(503, 'reportUnavailable', 10))
        // AbortError 可能早于进程退出，必须等 close，避免停服留下仍持读锁的查询。
        if (child.exitCode === null && child.signalCode === null) child.once('close', fail)
        else fail()
        return
      }
      try {
        const report: SeeReport = JSON.parse(stdout)
        if (!report.metadata || !report.coverage || !report.jobs || !report.usage || !report.reader || report.reader.backend === 'jsonl' && !report.reader.filesRead) throw new Error()
        resolve(report)
      } catch { reject(new SeeError(503, 'reportUnavailable', 10)) }
    })
  })
}

export class SeeReports {
  private readonly cache = new Map<string, { at: number; report: SeeReport }>()
  private running?: { key: string; promise: Promise<SeeReport>; controller: AbortController }
  private starts: number[] = []
  private closed = false

  constructor(private readonly config: Config, private readonly root: string, private readonly run = runSeeReport, private readonly now = Date.now) {}

  async get(filter: SeeFilter) {
    if (this.closed) throw new SeeError(503, 'reportUnavailable')
    const key = `${filter.days}:${filter.environment}:${filter.input}:${filter.timezone || 'Asia/Shanghai'}:${!!filter.includeTests}`, now = this.now()
    const cached = this.cache.get(key)
    if (cached && now - cached.at < 60000) return cached.report
    if (this.running?.key === key) return this.running.promise
    if (this.running) throw new SeeError(503, 'reportBusy', 2)
    this.starts = this.starts.filter(at => at > now - 60000)
    if (this.starts.length >= 6) throw new SeeError(503, 'reportBusy', Math.max(1, Math.ceil((this.starts[0] + 60000 - now) / 1000)))
    this.starts.push(now)
    const controller = new AbortController(), asOf = new Date(now).toISOString()
    const options: ReportOptions = { from: new Date(now - filter.days * 86400000).toISOString(), to: asOf, asOf,
      timezone: filter.timezone || 'Asia/Shanghai', environment: filter.environment, input: filter.input, includeTests: filter.includeTests || false }
    const promise = this.run(this.root, path.join(this.config.dataDir, 'analytics'), options, controller.signal).then(report => {
      this.cache.delete(key)
      while (this.cache.size >= 8) this.cache.delete(this.cache.keys().next().value!)
      this.cache.set(key, { at: this.now(), report })
      return report
    }).finally(() => { this.running = undefined })
    this.running = { key, promise, controller }
    return promise
  }

  async close() {
    this.closed = true
    this.running?.controller.abort()
    await this.running?.promise.catch(() => {})
    this.cache.clear()
  }
}
