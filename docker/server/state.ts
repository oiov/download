import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { isOpaqueId } from '../../shared/web-analytics'
import { WebError } from '../../shared/web-errors'
import { openDatabase, STATE_DATABASE_ID, transaction } from './sqlite'
import type { Job } from './jobs'
import { migratePlatform } from './platform-store'
import { migrateDownloadHistory, saveDownloadHistory, historyWrite } from './download-history'

const schema = `
  CREATE TABLE migrations (name TEXT PRIMARY KEY);
  CREATE TABLE sessions (token TEXT PRIMARY KEY, expires_at INTEGER NOT NULL, analytics_id TEXT NOT NULL);
  CREATE INDEX sessions_expiry ON sessions(expires_at);
  CREATE TABLE jobs (
    id TEXT PRIMARY KEY, owner TEXT NOT NULL, client_id TEXT NOT NULL,
    created_at INTEGER NOT NULL, status TEXT NOT NULL, payload TEXT NOT NULL CHECK(json_valid(payload)),
    UNIQUE(owner, client_id)
  );
  CREATE INDEX jobs_owner_created ON jobs(owner, created_at);
  CREATE TABLE quota (owner_hash TEXT NOT NULL, action TEXT NOT NULL CHECK(action IN ('parse', 'download')), at INTEGER NOT NULL);
  CREATE INDEX quota_owner_action_at ON quota(owner_hash, action, at);
  CREATE INDEX quota_expiry ON quota(at);
`

function legacy(file: string): any {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) }
  catch (error: any) { if (error.code === 'ENOENT') return undefined; throw error }
}

function validJob(job: any): job is Job {
  return job && ['id', 'owner', 'clientId', 'url', 'title'].every(key => typeof job[key] === 'string')
    && job.id.length > 0 && job.owner.length > 0 && job.clientId.length > 0
    && Number.isSafeInteger(job.createdAt) && job.createdAt >= 0 && Number.isFinite(job.progress)
    && ['pending', 'downloading', 'completed', 'error', 'paused'].includes(job.status)
    && (job.localPath === undefined || typeof job.localPath === 'string')
    && (!job.file || typeof job.file.key === 'string' && typeof job.file.name === 'string'
      && Number.isSafeInteger(job.file.size) && job.file.size >= 0 && ['local', 'r2'].includes(job.file.driver))
}

/** SQLite 是业务事实来源；运行中的进程、进度和解析结果仍由调度器管理。 */
export class StateStore {
  readonly db
  private closed = false
  private historyReady = false
  constructor(directory: string) {
    this.db = openDatabase(path.join(directory, 'state.sqlite'), STATE_DATABASE_ID, schema)
    try { this.importLegacy(directory); migratePlatform(this.db); migrateDownloadHistory(this.db); this.historyReady = true }
    catch { this.close(); throw new Error('无法迁移业务清单；请检查或恢复备份，不会自动清空会话、任务或额度') }
  }
  private importLegacy(directory: string) {
    transaction(this.db, () => {
      if (this.db.prepare("SELECT 1 FROM migrations WHERE name = 'legacy-json-v1'").get()) return
      const sessions = legacy(path.join(directory, 'web-sessions.json'))
      if (sessions !== undefined) {
        if (!Array.isArray(sessions) || sessions.length > 10001) throw new Error('会话清单无效')
        for (const entry of sessions) {
          if (!Array.isArray(entry) || !/^[a-f0-9]{64}$/.test(entry[0]) || !Number.isSafeInteger(entry[1]) || entry[1] < 0) throw new Error('会话清单无效')
          this.db.prepare('INSERT INTO sessions VALUES (?, ?, ?)').run(entry[0], entry[1], isOpaqueId(entry[2]) ? entry[2] : randomUUID())
        }
      }
      const jobs = legacy(path.join(directory, 'web-jobs.json'))
      if (jobs !== undefined) {
        if (!Array.isArray(jobs)) throw new Error('任务清单无效')
        for (const job of jobs) {
          if (!validJob(job)) throw new Error('任务清单无效')
          this.insertJob(job)
        }
      }
      const usage = legacy(path.join(directory, 'web-usage.json'))
      if (usage !== undefined) {
        if (usage?.v !== 1 || !Array.isArray(usage.sessions) || usage.sessions.length > 10000) throw new Error('额度清单无效')
        const seen = new Set<string>()
        for (const entry of usage.sessions) {
          if (!Array.isArray(entry) || entry.length !== 2) throw new Error('额度清单无效')
          const [id, actions] = entry
          if (typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id) || seen.has(id) || !actions) throw new Error('额度清单无效')
          seen.add(id)
          for (const action of ['parse', 'download']) {
            if (!Array.isArray(actions[action]) || !actions[action].every((at: unknown) => Number.isSafeInteger(at) && Number(at) >= 0)) throw new Error('额度清单无效')
            for (const at of actions[action]) this.db.prepare('INSERT INTO quota VALUES (?, ?, ?)').run(id, action, at)
          }
        }
      }
      this.db.prepare("INSERT INTO migrations VALUES ('legacy-json-v1')").run()
    })
  }
  session(token: string, now = Date.now()) {
    return this.db.prepare('SELECT analytics_id AS analyticsId, principal_id AS principalId FROM sessions WHERE token = ? AND expires_at > ?').get(token, now) as { analyticsId: string; principalId: string } | undefined
  }
  createSession(token: string, expiresAt: number, analyticsId: string) {
    transaction(this.db, () => {
      this.cleanupSessions()
      if (Number(this.db.prepare('SELECT COUNT(*) AS n FROM sessions').get()!.n) >= 10000) throw new WebError('busy', '会话数量达到上限')
      const principal = 'g:' + randomUUID()
      this.db.prepare('INSERT INTO principals VALUES (?, ?)').run(principal, Date.now())
      this.db.prepare('INSERT INTO sessions(token,expires_at,analytics_id,principal_id) VALUES (?, ?, ?, ?)').run(token, expiresAt, analyticsId, principal)
    })
  }
  cleanupSessions(now = Date.now()) { this.db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now) }
  allJobs(): Job[] { return this.db.prepare('SELECT payload FROM jobs ORDER BY created_at, rowid').all().map(row => JSON.parse(String(row.payload))) }
  jobsForOwner(owner: string): Job[] { return this.db.prepare('SELECT payload FROM jobs WHERE owner = ? ORDER BY created_at DESC, rowid DESC').all(owner).map(row => JSON.parse(String(row.payload))) }
  findJob(owner: string, clientId: string): Job | undefined {
    const row = this.db.prepare('SELECT payload FROM jobs WHERE owner = ? AND client_id = ?').get(owner, clientId)
    return row ? JSON.parse(String(row.payload)) : undefined
  }
  insertJob(job: Job) {
    const { options: _, ...saved } = job
    const write = () => this.db.prepare('INSERT INTO jobs VALUES (?, ?, ?, ?, ?, ?)').run(job.id, job.owner, job.clientId, job.createdAt, job.status, JSON.stringify(saved))
    if (!this.historyReady) { write(); return }
    historyWrite(this.db, () => { write(); saveDownloadHistory(this.db, job) })
  }
  saveJob(job: Job) {
    const { options: _, ...saved } = job
    historyWrite(this.db, () => {
      const result = this.db.prepare('UPDATE jobs SET created_at = ?, status = ?, payload = ? WHERE id = ? AND owner = ? AND client_id = ?')
        .run(job.createdAt, job.status, JSON.stringify(saved), job.id, job.owner, job.clientId)
      if (result.changes !== 1) throw new Error('任务不存在，无法保存')
      saveDownloadHistory(this.db, job)
    })
  }
  removeJob(id: string, owner: string) {
    historyWrite(this.db, () => {
      const result = this.db.prepare('DELETE FROM jobs WHERE id = ? AND owner = ?').run(id, owner)
      if (result.changes) this.db.prepare('UPDATE download_history SET removed_at=? WHERE id=? AND owner=?').run(Date.now(), id, owner)
    })
  }
  close() { if (!this.closed) { this.db.close(); this.closed = true } }
}
