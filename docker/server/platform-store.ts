import { createHash, randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { transaction } from './sqlite'
import type { Config } from './config'

export const hash = (value: string) => createHash('sha256').update(value).digest('hex')
export const DAY = 86400000
export const scopes = ['media:parse', 'downloads:create', 'downloads:read', 'downloads:cancel', 'files:read'] as const
export type Scope = typeof scopes[number]
export interface Account { id: string; email: string; name: string; verified: number; disabled: number; created_at: number; last_active: number }

/** 增量迁移保留任务 ID、文件键和旧库；不重新导入已停止写入的 JSON。 */
export function migratePlatform(db: DatabaseSync) {
  transaction(db, () => {
    if (db.prepare("SELECT 1 FROM migrations WHERE name = 'accounts-v1'").get()) return
    db.exec(`
      ALTER TABLE sessions ADD COLUMN principal_id TEXT;
      CREATE TABLE principals (id TEXT PRIMARY KEY, created_at INTEGER NOT NULL);
      CREATE TABLE web_accounts (id TEXT PRIMARY KEY, email TEXT NOT NULL, name TEXT NOT NULL, verified INTEGER NOT NULL, disabled INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, last_active INTEGER NOT NULL);
      CREATE INDEX web_accounts_email ON web_accounts(email);
      CREATE TABLE api_keys (id TEXT PRIMARY KEY, owner TEXT NOT NULL, digest TEXT NOT NULL UNIQUE, label TEXT NOT NULL, prefix TEXT NOT NULL, scopes TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, revoked_at INTEGER, last_used INTEGER);
      CREATE INDEX api_keys_owner ON api_keys(owner);
      CREATE TABLE usage_events (id TEXT PRIMARY KEY, owner TEXT NOT NULL, kind TEXT NOT NULL, at INTEGER NOT NULL, status TEXT NOT NULL, bytes INTEGER NOT NULL DEFAULT 0, reserved INTEGER NOT NULL DEFAULT 0);
      CREATE INDEX usage_owner_time ON usage_events(owner, at);
      CREATE TABLE idempotency (owner TEXT NOT NULL, key TEXT NOT NULL, fingerprint TEXT NOT NULL, job_id TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY(owner, key));
      CREATE TABLE billing_customers (owner TEXT PRIMARY KEY, customer_id TEXT UNIQUE NOT NULL);
      CREATE TABLE subscriptions (id TEXT PRIMARY KEY, owner TEXT NOT NULL, customer_id TEXT NOT NULL, price_id TEXT NOT NULL, status TEXT NOT NULL, period_end INTEGER NOT NULL, updated_at INTEGER NOT NULL);
      CREATE INDEX subscriptions_owner ON subscriptions(owner);
      CREATE TABLE billing_events (id TEXT PRIMARY KEY, at INTEGER NOT NULL);
      CREATE TABLE billing_requests (owner TEXT PRIMARY KEY, request_id TEXT NOT NULL, expires_at INTEGER NOT NULL);
    `)
    const owners = new Set<string>([
      ...db.prepare('SELECT token FROM sessions').all().map(row => String(row.token)),
      ...db.prepare('SELECT DISTINCT owner FROM jobs').all().map(row => String(row.owner)),
    ])
    for (const oldOwner of owners) {
      const principal = 'g:' + randomUUID()
      db.prepare('INSERT INTO principals VALUES (?, ?)').run(principal, Date.now())
      db.prepare('UPDATE sessions SET principal_id = ? WHERE token = ?').run(principal, oldOwner)
      for (const row of db.prepare('SELECT id, payload FROM jobs WHERE owner = ?').all(oldOwner)) {
        const job = JSON.parse(String(row.payload)); job.owner = principal
        db.prepare('UPDATE jobs SET owner = ?, payload = ? WHERE id = ?').run(principal, JSON.stringify(job), String(row.id))
      }
      db.prepare('UPDATE quota SET owner_hash = ? WHERE owner_hash = ?').run(hash(principal), hash(oldOwner))
    }
    // 旧任务只回填仍有可靠记录的资源，不把遥测推断成历史计费事实。
    for (const row of db.prepare('SELECT payload FROM jobs').all()) {
      const job = JSON.parse(String(row.payload))
      db.prepare('INSERT INTO usage_events VALUES (?, ?, ?, ?, ?, ?, 0)').run('job:' + job.id, job.owner, 'download', job.createdAt, job.status, job.status === 'completed' ? job.file?.size || 0 : 0)
    }
    db.prepare("INSERT INTO migrations VALUES ('accounts-v1')").run()
  })
  transaction(db, () => {
    if (db.prepare("SELECT 1 FROM migrations WHERE name = 'account-grants-v1'").get()) return
    db.exec("CREATE TABLE configured_grants (email TEXT NOT NULL, role TEXT NOT NULL, owner TEXT NOT NULL, PRIMARY KEY(email,role))")
    db.prepare("INSERT INTO migrations VALUES ('account-grants-v1')").run()
  })
}

export class PlatformStore {
  constructor(readonly db: DatabaseSync, readonly config: Config) {}
  account(owner: string) { return this.db.prepare('SELECT * FROM web_accounts WHERE id = ?').get(owner) as unknown as Account | undefined }
  syncAccount(user: { id: string; email: string; name: string; emailVerified: boolean }) {
    const owner = 'u:' + user.id, now = Date.now()
    this.db.prepare(`INSERT INTO web_accounts(id,email,name,verified,created_at,last_active) VALUES (?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET email=excluded.email,name=excluded.name,verified=excluded.verified,last_active=excluded.last_active`).run(owner, user.email.toLowerCase(), user.name, user.emailVerified ? 1 : 0, now, now)
    if (user.emailVerified) for (const [role, emails] of [['admin', this.config.adminEmails], ['api-beta', this.config.apiBetaEmails]] as const) {
      if (emails.includes(user.email.toLowerCase())) this.db.prepare('INSERT OR IGNORE INTO configured_grants VALUES (?,?,?)').run(user.email.toLowerCase(), role, owner)
    }
    return this.account(owner)!
  }
  private granted(account: Account | undefined, role: string, ids: string[], emails: string[]) {
    return !!account && !account.disabled && !!account.verified && (ids.includes(account.id.toLowerCase()) || emails.includes(account.email) && this.db.prepare('SELECT owner FROM configured_grants WHERE email=? AND role=?').get(account.email, role)?.owner === account.id)
  }
  admin(account?: Account) { return this.granted(account, 'admin', this.config.adminIds, this.config.adminEmails) }
  beta(account?: Account) { return this.granted(account, 'api-beta', this.config.apiBetaIds, this.config.apiBetaEmails) }
  paid(owner: string, now = Date.now()) {
    return !!this.config.stripePriceId && !!this.db.prepare("SELECT 1 FROM subscriptions WHERE owner = ? AND price_id = ? AND status IN ('active','trialing') AND period_end > ?").get(owner, this.config.stripePriceId, now)
  }
  limits(owner: string) {
    const account = this.account(owner), paid = account && this.paid(owner)
    return { plan: account ? paid ? 'pro' : 'free' : 'guest',
      parses: account ? paid ? this.config.proParseDaily : this.config.accountParseDaily : this.config.parseDailyLimit,
      downloads: account ? paid ? this.config.proDownloadDaily : this.config.accountDownloadDaily : this.config.downloadDailyLimit,
      generatedBytes: account ? paid ? this.config.proGeneratedBytes : this.config.accountGeneratedBytes : this.config.guestGeneratedBytes,
      deliveredBytes: account ? paid ? this.config.proDeliveryBytes : this.config.accountDeliveryBytes : this.config.guestDeliveryBytes,
      concurrent: this.config.ownerConcurrency, maxFileBytes: this.config.maxFileBytes, timeoutMs: this.config.taskTimeout, hourlyParses: this.config.parseHourlyLimit, retainedTasks: this.config.maxSessionTasks }
  }
  usage(owner: string, since = Date.now() - DAY, until = Date.now()) {
    const rows = this.db.prepare(`SELECT kind,status,COUNT(*) n,COALESCE(SUM(bytes),0) bytes,COALESCE(SUM(reserved),0) reserved FROM usage_events WHERE owner = ? AND at >= ? AND at <= ? GROUP BY kind,status`).all(owner, since, until)
    const sum = (kind: string, field: string, status?: string) => rows.filter(row => row.kind === kind && (!status || row.status === status)).reduce((n, row) => n + Number(row[field]), 0)
    return { parses: sum('parse', 'n'), downloads: sum('download', 'n'), completed: sum('download', 'n', 'completed'), failed: sum('download', 'n', 'error'),
      generatedBytes: sum('download', 'bytes'), deliveredBytes: sum('delivery', 'bytes'), reservedBytes: sum('download', 'reserved'), deliveryReservedBytes: sum('delivery', 'reserved'), uncertainDeliveryBytes: sum('delivery', 'reserved', 'uncertain') }
  }
  parse(owner: string, id: string, status = 'requested') {
    this.db.prepare('INSERT INTO usage_events VALUES (?, ?, ?, ?, ?, 0, 0)').run('parse:' + id, owner, 'parse', Date.now(), status)
  }
  download(owner: string, id: string) {
    this.db.prepare('INSERT INTO usage_events VALUES (?, ?, ?, ?, ?, 0, ?)').run('job:' + id, owner, 'download', Date.now(), 'pending', this.config.maxFileBytes)
  }
  finish(id: string, status: string, bytes = 0) {
    this.db.prepare('UPDATE usage_events SET status = ?, bytes = ?, reserved = 0 WHERE id = ?').run(status, bytes, id)
  }
  claim(guest: string, owner: string) {
    if (!guest.startsWith('g:') || !owner.startsWith('u:')) throw new Error('主体无效')
    transaction(this.db, () => {
      // 同一个客户端任务号冲突时拒绝整次认领，不能覆盖任一账户任务。
      for (const row of this.db.prepare('SELECT id,payload FROM jobs WHERE owner = ?').all(guest)) {
        const job = JSON.parse(String(row.payload)); job.owner = owner
        this.db.prepare('UPDATE jobs SET owner = ?, payload = ? WHERE id = ?').run(owner, JSON.stringify(job), String(row.id))
      }
      this.db.prepare('UPDATE usage_events SET owner = ? WHERE owner = ?').run(owner, guest)
      this.db.prepare("UPDATE download_history SET owner=?,payload=json_set(payload,'$.owner',?) WHERE owner=?").run(owner, owner, guest)
      this.db.prepare('UPDATE quota SET owner_hash = ? WHERE owner_hash = ?').run(hash(owner), hash(guest))
      // 当前访客凭据及其他复制出来的访客凭据立即丧失旧主体的访问权。
      const replacement = 'g:' + randomUUID()
      this.db.prepare('INSERT INTO principals VALUES (?,?)').run(replacement, Date.now())
      this.db.prepare('UPDATE sessions SET principal_id = ? WHERE principal_id = ?').run(replacement, guest)
    })
  }
  reserveDelivery(owner: string, bytes: number) {
    const id = 'delivery:' + randomUUID()
    transaction(this.db, () => {
      const usage = this.usage(owner)
      if (usage.deliveredBytes + usage.deliveryReservedBytes + bytes > this.limits(owner).deliveredBytes) throw new Error('交付额度已用完')
      this.db.prepare('INSERT INTO usage_events VALUES (?,?,?,?,?,0,?)').run(id, owner, 'delivery', Date.now(), 'streaming', bytes)
    })
    return id
  }
  users(query: string, offset: number, since: number, until: number) {
    const pattern = '%' + query.replace(/[\\%_]/g, value => '\\' + value) + '%'
    const where = "WHERE email LIKE ? ESCAPE '\\' OR name LIKE ? ESCAPE '\\'"
    const count = Number(this.db.prepare('SELECT COUNT(*) n FROM web_accounts ' + where).get(pattern, pattern)!.n)
    const users = (this.db.prepare('SELECT * FROM web_accounts ' + where + ' ORDER BY created_at DESC,id LIMIT 25 OFFSET ?').all(pattern, pattern, offset) as unknown as Account[])
      .map(account => ({ ...account, plan: this.limits(account.id).plan, usage: this.usage(account.id, since, until) }))
    return { count, users }
  }
}
