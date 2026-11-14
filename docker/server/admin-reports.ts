import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import type { Config } from './config'
import type { AdminQuery } from './admin-data'
import { HttpError } from './http'

export class AdminReports {
  private running?: { key: string; promise: Promise<any>; controller: AbortController }
  private cache = new Map<string, { at: number; value: any }>()
  private closed = false
  constructor(readonly config: Config, readonly root: string) {}
  async get(query: AdminQuery) {
    if (this.closed) throw new HttpError(503, 'unavailable')
    const key = JSON.stringify({ ...query, ...(query.since ? { since: Math.floor(query.since / 15000) * 15000 } : {}), ...(query.until ? { until: Math.floor(query.until / 15000) * 15000 } : {}) }), previous = this.cache.get(key)
    if (previous && Date.now() - previous.at < 15000) return previous.value
    if (this.running?.key === key) return this.running.promise
    if (this.running) throw new HttpError(503, 'report-busy', 2)
    const entry = path.join(this.root, 'admin-report.mjs')
    const args = fs.existsSync(entry) ? [entry] : ['--import', 'tsx', path.join(this.root, 'scripts/admin-report.ts')]
    const env = Object.fromEntries(['PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR'].flatMap(key => process.env[key] ? [[key, process.env[key]!]] : []))
    const controller = new AbortController()
    const promise = new Promise<any>((resolve, reject) => {
      const child = execFile(process.execPath, ['--max-old-space-size=128', ...args], { cwd: this.root, env, signal: controller.signal, timeout: 10000, killSignal: 'SIGKILL', windowsHide: true, maxBuffer: 1048576 }, (error, stdout) => {
        if (error) {
          const fail = () => reject(new HttpError(503, 'report-unavailable'))
          if (child.exitCode === null && child.signalCode === null) child.once('close', fail); else fail()
          return
        }
        try { resolve(JSON.parse(stdout)) } catch { reject(new HttpError(503, 'report-unavailable')) }
      })
      child.stdin?.on('error', () => {})
      child.stdin?.end(JSON.stringify({ query, dataDir: this.config.dataDir, workDir: this.config.workDir, priceId: this.config.stripePriceId }))
    }).then(value => {
      while (this.cache.size >= 8) this.cache.delete(this.cache.keys().next().value!)
      this.cache.set(key, { at: Date.now(), value }); return value
    }).finally(() => { this.running = undefined })
    this.running = { key, promise, controller }
    return promise
  }
  async close() { this.closed = true; this.running?.controller.abort(); await this.running?.promise.catch(() => {}); this.cache.clear() }
}
