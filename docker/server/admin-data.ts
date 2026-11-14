import fs from 'node:fs'
import path from 'node:path'
import { ANALYTICS_DATABASE_ID, STATE_DATABASE_ID, openReadOnlyDatabase } from './sqlite'
import { PlatformStore } from './platform-store'
import { readConfig } from './config'

export interface AdminQuery { mode: 'users' | 'user' | 'operations' | 'downloads' | 'download'; q?: string; offset?: number; since?: number; until?: number; owner?: string; id?: string; status?: string; accountKind?: string }
export interface AdminInput { query: AdminQuery; dataDir: string; workDir: string; priceId: string }

/** 只在有时限和内存预算的子进程里执行；不开库、不导入、不返回原始路径或凭据。 */
export function readAdminData(input: AdminInput) {
  const db = openReadOnlyDatabase(path.join(input.dataDir, 'state.sqlite'), STATE_DATABASE_ID)
  try {
    db.exec('BEGIN')
    const store = new PlatformStore(db, { ...readConfig({ ANALYTICS_ENABLED: '0' }), stripePriceId: input.priceId })
    const query = input.query
    if (query.mode === 'users') return store.users(query.q || '', query.offset || 0, query.since || 0, query.until || Date.now())
    if (query.mode === 'user') {
      const user = store.account(query.owner || '')
      if (!user) return null
      return { user, plan: store.limits(user.id).plan, usage: store.usage(user.id, query.since, query.until),
        events: db.prepare('SELECT kind,status,at,bytes FROM usage_events WHERE owner = ? AND at >= ? AND at <= ? ORDER BY at DESC LIMIT 50').all(user.id, query.since || 0, query.until || Date.now()) }
    }
    if (query.mode === 'downloads' || query.mode === 'download') {
      const pattern = '%' + (query.q || '').replace(/[\\%_]/g, value => '\\' + value) + '%'
      const where = `WHERE h.created_at>=? AND h.created_at<=?
        AND (?='' OR h.owner=?) AND (?='all' OR h.status=?)
        AND (?='all' OR (?='account' AND h.owner LIKE 'u:%') OR (?='guest' AND h.owner LIKE 'g:%'))
        AND (?='' OR h.id=?)
        AND (?='' OR a.email LIKE ? ESCAPE '\\' OR a.name LIKE ? ESCAPE '\\' OR json_extract(h.payload,'$.title') LIKE ? ESCAPE '\\' OR h.id LIKE ? ESCAPE '\\')`
      const parameters = [query.since || 0, query.until || Date.now(), query.owner || '', query.owner || '', query.status || 'all', query.status || 'all', query.accountKind || 'all', query.accountKind || 'all', query.accountKind || 'all', query.id || '', query.id || '', query.q || '', pattern, pattern, pattern, pattern]
      const join = ' FROM download_history h LEFT JOIN web_accounts a ON a.id=h.owner '
      const count = Number(db.prepare('SELECT COUNT(*) n' + join + where).get(...parameters)!.n)
      const records = db.prepare('SELECT h.payload,h.removed_at,a.name,a.email,EXISTS(SELECT 1 FROM jobs j WHERE j.id=h.id) AS retained' + join + where + ' ORDER BY h.created_at DESC,h.id LIMIT 25 OFFSET ?').all(...parameters, query.offset || 0)
        .map(row => ({ ...JSON.parse(String(row.payload)), removedAt: row.removed_at, retained: !!row.retained, userName: row.name, userEmail: row.email }))
      return query.mode === 'download' ? records[0] || null : { count, records }
    }
    if (query.mode !== 'operations') throw new Error('查询类型无效')
    const version = Number(db.prepare('PRAGMA user_version').get()!.user_version)
    const migrations = db.prepare('SELECT name FROM migrations ORDER BY name').all().map(row => String(row.name))
    const accountCount = Number(db.prepare('SELECT COUNT(*) n FROM web_accounts').get()!.n)
    const jobs = db.prepare('SELECT status,COUNT(*) n FROM jobs GROUP BY status').all()
    const ledgerCount = Number(db.prepare('SELECT COUNT(*) n FROM usage_events').get()!.n)
    const fileCount = Number(db.prepare("SELECT COUNT(*) n FROM jobs WHERE json_type(payload,'$.file') = 'object'").get()!.n)
    const expired = Number(db.prepare('SELECT COUNT(*) n FROM jobs WHERE created_at < ?').get(Date.now() - 86400000)!.n)
    const size = (file: string) => { try { return fs.statSync(file).size } catch (error: any) { return error.code === 'ENOENT' ? 0 : null } }
    const sizes = (file: string) => ({ database: size(file), wal: size(file + '-wal'), shm: size(file + '-shm') })
    const file = path.join(input.dataDir, 'analytics', 'analytics.sqlite')
    let analytics: Record<string, unknown>
    if (!fs.existsSync(file)) analytics = { status: 'missing' }
    else {
      let reader: ReturnType<typeof openReadOnlyDatabase> | undefined
      try {
        reader = openReadOnlyDatabase(file, ANALYTICS_DATABASE_ID); reader.exec('BEGIN')
        const health = reader.prepare("SELECT value FROM metadata WHERE key = 'health'").get()
        const value = health ? JSON.parse(String(health.value)) : null
        analytics = { status: 'available', schemaVersion: Number(reader.prepare('PRAGMA user_version').get()!.user_version),
          legacyImportComplete: !!reader.prepare("SELECT 1 FROM metadata WHERE key = 'legacy-import-complete'").get(),
          ...reader.prepare('SELECT COUNT(*) records,MAX(at) lastEventAt FROM events').get(),
          malformedLines: Number(reader.prepare('SELECT COALESCE(SUM(malformed_lines),0) n FROM imports').get()!.n),
          health: value ? { written: value.written, dropped: value.dropped, writeFailures: value.writeFailures } : null }
      } catch { analytics = { status: 'unavailable' } }
      finally { reader?.close() }
    }
    const deadline = Date.now() + 3000
    let entries = 0, localBytes = 0, complete = true
    const scan = (dir: string) => {
      try {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          if (++entries > 10000 || Date.now() > deadline) { complete = false; return }
          if (entry.isSymbolicLink()) continue
          const file = path.join(dir, entry.name)
          if (entry.isDirectory()) scan(file)
          else if (entry.isFile()) localBytes += fs.statSync(file).size
          if (!complete) return
        }
      } catch { complete = false }
    }
    scan(input.workDir)
    return { version, migrations, accountCount, jobs, ledgerCount, fileCount, expired, analytics,
      stateBytes: sizes(path.join(input.dataDir, 'state.sqlite')), analyticsBytes: sizes(file),
      localBytes: complete ? localBytes : null, localScanComplete: complete, r2TotalBytes: null, historicalMigrationVerified: false }
  } finally { db.close() }
}
