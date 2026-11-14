// 真实 SQLite 回归：旧数据迁移、事务、并发额度、隔离故障与报表口径。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { loader } from './lib/load-source.mjs'

const loadSource = sources => loader({}, { URL, Intl }, sources)
const clone = value => JSON.parse(JSON.stringify(value))
const temporary = () => fs.mkdtempSync(path.join(os.tmpdir(), 'keep-sqlite-'))
const owner = 'a'.repeat(64), other = 'b'.repeat(64)
const now = Date.now()
const fixtureJob = (id = 'one', token = owner) => ({ id, owner: token, clientId: id, url: 'https://example.com/video', title: '测试', createdAt: now, status: 'completed', progress: 100 })

function configChecks(sources = {}) {
  const { readConfig } = loadSource(sources)('docker/server/config.ts')
  assert.equal(readConfig({ ANALYTICS_RETENTION_DAYS: '180' }).analyticsRetentionDays, 180)
  assert.throws(() => readConfig({ ANALYTICS_RETENTION_DAYS: '181' }), /最多保留 180 天/)
}

function stateChecks(sources = {}) {
  const dir = temporary(), load = loadSource(sources), { StateStore } = load('docker/server/state.ts')
  const analyticsId = randomUUID(), hash = createHash('sha256').update(owner).digest('hex')
  const files = {
    'web-sessions.json': [[owner, now + 60000, analyticsId], [other, now - 1]],
    'web-jobs.json': [fixtureJob(), fixtureJob('two', other)],
    'web-usage.json': { v: 1, sessions: [[hash, { parse: [now], download: [now] }]] },
  }
  for (const [name, value] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), JSON.stringify(value))
  let store
  try {
    store = new StateStore(dir)
    assert.equal(store.db.prepare('PRAGMA journal_mode').get().journal_mode, 'wal')
    assert.equal(store.db.prepare('PRAGMA synchronous').get().synchronous, 2, '业务额度要求 FULL 同步提交')
    assert.equal(store.session(owner).analyticsId, analyticsId)
    const principal = store.session(owner).principalId
    const otherPrincipal = store.allJobs().find(job => job.id === 'two').owner
    assert.match(principal, /^g:/, '任务归属必须独立于会话凭据')
    assert.notEqual(principal, owner)
    assert.equal(store.session(other), undefined)
    assert.equal(store.allJobs().length, 2)
    assert.equal(store.jobsForOwner(principal).length, 1)
    assert.equal(store.jobsForOwner(owner).length, 0, '旧凭据不能直接作为 owner')
    assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM quota').get().n, 2)
    for (const [name, value] of Object.entries(files)) assert.equal(fs.readFileSync(path.join(dir, name), 'utf8'), JSON.stringify(value), '迁移不得改写原件')
    assert.throws(() => store.insertJob({ ...fixtureJob('duplicate', principal), clientId: 'one' }), /UNIQUE/, '幂等键由数据库约束')
    store.saveJob({ ...fixtureJob('one', principal), status: 'error' })
    assert.equal(store.findJob(principal, 'one').status, 'error')
    assert.equal(store.findJob(otherPrincipal, 'two').status, 'completed', '只更新一个任务')
    store.removeJob('one', otherPrincipal)
    assert.ok(store.findJob(principal, 'one'), '不能删除其他会话任务')
    store.removeJob('one', principal)
    store.cleanupSessions()
    store.close()
    store = new StateStore(dir)
    assert.equal(store.allJobs().length, 1, '重启不能重新导入已删除任务')
    assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM quota').get().n, 2, '迁移不能重复扣额')
    assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 1)
    if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(dir, 'state.sqlite')).mode & 0o777, 0o600)
  } finally { store?.close(); fs.rmSync(dir, { recursive: true, force: true }) }
}

function rollbackChecks(sources = {}) {
  const dir = temporary(), { StateStore } = loadSource(sources)('docker/server/state.ts')
  let store, db
  try {
    fs.writeFileSync(path.join(dir, 'web-sessions.json'), JSON.stringify([[owner, now + 60000]]))
    fs.writeFileSync(path.join(dir, 'web-jobs.json'), JSON.stringify([fixtureJob()]))
    fs.writeFileSync(path.join(dir, 'web-usage.json'), '{broken')
    assert.throws(() => new StateStore(dir), /不会自动清空/)
    assert.equal(fs.readFileSync(path.join(dir, 'web-usage.json'), 'utf8'), '{broken')
    db = new DatabaseSync(path.join(dir, 'state.sqlite'))
    for (const table of ['sessions', 'jobs', 'quota', 'migrations']) assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n, 0, '迁移失败必须全部回滚')
    db.close(); db = undefined
    fs.writeFileSync(path.join(dir, 'web-usage.json'), JSON.stringify({ v: 1, sessions: [] }))
    store = new StateStore(dir)
    assert.equal(store.allJobs().length, 1, '修复原件后可以安全重试')
    store.db.exec('PRAGMA user_version = 2')
    store.close()
    assert.throws(() => new StateStore(dir), /版本不受支持/, '旧程序不得覆盖未来版本')
    fs.writeFileSync(path.join(dir, 'state.sqlite'), 'broken-database')
    assert.throws(() => new StateStore(dir))
    assert.equal(fs.readFileSync(path.join(dir, 'state.sqlite'), 'utf8'), 'broken-database', '损坏数据库不能重新建空库')
  } finally { db?.close(); store?.close(); fs.rmSync(dir, { recursive: true, force: true }) }
}

async function concurrentQuotaChecks() {
  const dir = temporary(), load = loadSource(), { StateStore } = load('docker/server/state.ts')
  const store = new StateStore(dir); store.close()
  const code = `import { loader } from './scripts/lib/load-source.mjs';
    const load = loader({}, { URL });
    const { StateStore } = load('docker/server/state.ts');
    const { SessionQuota } = load('docker/server/quota.ts');
    const { readConfig } = load('docker/server/config.ts');
    const config = readConfig({ WEB_PARSE_HOURLY_LIMIT: '1', DOWNVID_DATA_DIR: process.argv[1] });
    const store = new StateStore(config.dataDir);
    try { new SessionQuota(config, store).consume('fixture-owner', 'parse'); console.log('accepted') }
    catch (error) { console.log(error.code || 'unexpected') }
    finally { store.close() }`
  const worker = () => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', code, dir], { stdio: ['ignore', 'pipe', 'pipe'] })
    let output = '', errors = ''
    const timeout = setTimeout(() => { child.kill(); reject(new Error('并发额度测试超时')) }, 15000)
    child.stdout.on('data', data => { output += data }); child.stderr.on('data', data => { errors += data })
    child.on('error', reject)
    child.on('exit', status => { clearTimeout(timeout); status === 0 ? resolve(output.trim()) : reject(new Error(errors)) })
  })
  try {
    const results = await Promise.all(Array.from({ length: 4 }, worker))
    assert.equal(results.filter(result => result === 'accepted').length, 1)
    assert.equal(results.filter(result => result === 'parse-quota').length, 3, '并发检查和扣额必须处于同一写事务')
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
}

async function recoveryChecks(sources = {}) {
  const dir = temporary(), events = []
  const load = loader({
    'docker/server/electron-shim.ts': { wsEventBus: new EventEmitter() },
    'docker/server/storage.ts': { createStorage: () => ({}) },
    'electron/parsers/ytdlp.ts': {},
    'electron/parsers/info-cache.ts': {},
    'electron/download/ytdlp.ts': {},
  }, { URL }, sources)
  const { Jobs } = load('docker/server/jobs.ts')
  const config = load('docker/server/config.ts').readConfig({ DOWNVID_DATA_DIR: dir, DOWNVID_DOWNLOADS: path.join(dir, 'work') })
  const pending = { ...fixtureJob('pending'), status: 'downloading', analytics: { entityId: randomUUID() } }
  fs.writeFileSync(path.join(dir, 'web-jobs.json'), JSON.stringify([pending, fixtureJob()]))
  const analytics = { record: name => events.push(name) }
  let jobs
  try {
    jobs = new Jobs(config, '', analytics)
    assert.equal(jobs.jobs.get('pending').errorCode, 'interrupted')
    assert.equal(events.filter(name => name === 'job_finished').length, 1)
    jobs.platform.reserveDelivery('fixture-owner', 100)
    await jobs.close()
    jobs = new Jobs(config, '', analytics)
    assert.equal(jobs.platform.usage('fixture-owner').deliveredBytes, 0, '崩溃前未确认的流量不能冒充实际交付')
    assert.equal(jobs.platform.usage('fixture-owner').uncertainDeliveryBytes, 100, '重启后仍保留未确认交付的预留')
    assert.equal(jobs.platform.usage('fixture-owner').deliveryReservedBytes, 100, '不能靠重启恢复流量额度')
    assert.equal(events.filter(name => name === 'job_finished').length, 1, '重启修复必须持久化，不能每次重启再记录终态')
    const principal = jobs.jobs.get('pending').owner
    assert.equal(jobs.submit(principal, { taskId: 'pending' }).errorCode, 'interrupted', '重启后重放不能再次创建或扣额')
    assert.equal(jobs.submit(principal, { taskId: 'one' }).status, 'completed')
    assert.equal(jobs.state.db.prepare('SELECT COUNT(*) AS n FROM quota').get().n, 0)
    assert.equal(jobs.list(other).length, 0)
  } finally { await jobs?.close(); fs.rmSync(dir, { recursive: true, force: true }) }
}

async function startFailureChecks(sources = {}) {
  const dir = temporary(), events = []
  let started = 0, released = 0
  const load = loader({
    'docker/server/electron-shim.ts': { wsEventBus: new EventEmitter() },
    'docker/server/storage.ts': { createStorage: () => ({}) },
    'electron/parsers/ytdlp.ts': {},
    'electron/parsers/info-cache.ts': { retainInfoFile: () => () => { released++ } },
    'electron/download/ytdlp.ts': { runYtdlpDownload: async () => { started++; return { paused: true } }, pauseDownload: async () => {} },
  }, { URL, setInterval, clearInterval }, sources)
  const { Jobs } = load('docker/server/jobs.ts')
  const config = load('docker/server/config.ts').readConfig({ DOWNVID_DATA_DIR: dir, DOWNVID_DOWNLOADS: path.join(dir, 'work') })
  const jobs = new Jobs(config, '', { record: (name, _context, fields) => events.push({ name, ...fields }) })
  try {
    jobs.state.db.exec("CREATE TRIGGER reject_start BEFORE UPDATE ON jobs WHEN NEW.status = 'downloading' BEGIN SELECT RAISE(ABORT, 'fixture'); END")
    const url = 'https://example.com/video'
    jobs.parsed.set(owner + ':' + url, { time: Date.now(), info: { title: '测试', formats: [{ formatId: 'mp4' }] } })
    const job = jobs.submit(owner, { taskId: 'one', url, formatId: 'mp4' })
    await jobs.executions.get(job.id)
    assert.equal(started, 0, '状态提交失败不能启动下载器')
    assert.equal(released, 1, '启动失败仍须释放解析缓存引用')
    assert.equal(jobs.running, 0)
    assert.equal(jobs.state.findJob(owner, 'one').status, 'error')
    assert.equal(jobs.state.db.prepare('SELECT COUNT(*) AS n FROM quota').get().n, 1, '后续失败不返还已提交额度')
    assert.equal(events.filter(event => event.name === 'job_finished' && event.result === 'error').length, 1)
  } finally { await jobs.close(); fs.rmSync(dir, { recursive: true, force: true }) }
}

const event = (name, entityId, fields = {}) => ({ v: 1, id: randomUUID(), name, ...(entityId ? { entityId } : {}),
  at: '2026-10-23T12:00:00.000Z', environment: 'production', client: 'web', input: 'user_input',
  platform: 'youtube', language: 'en', utm: 'direct_or_unknown', referrer: 'direct_or_unknown', test: false, ...fields })
const options = { from: '2026-10-23T00:00:00Z', to: '2026-10-24T00:00:00Z', asOf: '2026-10-25T00:00:00Z', timezone: 'UTC', environment: 'production', input: 'all', includeTests: false }
const withoutExportTime = report => { const value = clone(report); delete value.metadata.exportedAt; return value }

async function analyticsMigrationChecks(sources = {}) {
  const dir = temporary(), load = loadSource(sources)
  const { AnalyticsStore } = load('docker/server/analytics-store.ts')
  const { readAnalyticsReport } = load('docker/server/analytics-reader.ts')
  const records = Array.from({ length: 205 }, () => event('tool_view', undefined, { sessionId: randomUUID() }))
  records[0].url = 'fixture-secret-url'
  const file = path.join(dir, '2026-10-23.jsonl')
  const text = records.map(row => JSON.stringify(row)).join('\r\n') + '\r\n{partial\n'
  fs.writeFileSync(file, text)
  let store
  try {
    store = new AnalyticsStore(dir)
    let calls = 0
    await assert.rejects(store.importLegacy(() => ++calls > 125), /已停止/)
    assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM events').get().n, 100)
    const firstBytes = store.db.prepare('SELECT bytes FROM days').get().bytes
    await assert.rejects(readAnalyticsReport(dir, options), /尚未完成/, '不能把半迁移报告当作完整数据')
    store.close(); store = new AnalyticsStore(dir)
    await store.importLegacy(() => false)
    assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM events').get().n, records.length, '中断重试不能重复导入')
    const totalBytes = store.db.prepare('SELECT bytes FROM days').get().bytes
    assert.ok(totalBytes > firstBytes)
    await store.importLegacy(() => false)
    assert.equal(store.db.prepare('SELECT bytes FROM days').get().bytes, totalBytes, '迁移重放不重复计容量')
    assert.equal(fs.readFileSync(file, 'utf8'), text, '保留迁移原件')
    const result = await readAnalyticsReport(dir, options)
    assert.equal(result.reader.malformedLines, 1)
    assert.equal(result.report.usage.toolViews, 205)
    assert.ok(!JSON.stringify(store.db.prepare('SELECT payload FROM events').all()).includes('fixture-secret'))
    assert.equal(store.append([event('tool_view')], totalBytes).dropped, 1, '迁移数据计入当天写入上限')
    store.close(); store = new AnalyticsStore(dir)
    assert.equal(store.append([event('tool_view')], totalBytes).dropped, 1, '重启不能重置每日容量')
    await store.cleanup('2026-10-24')
    assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM events').get().n, 0)
    assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM days').get().n, 0)
    assert.equal(fs.existsSync(file), false)
  } finally { store?.close(); fs.rmSync(dir, { recursive: true, force: true }) }
}

async function reportChecks(sources = {}) {
  const dir = temporary(), load = loadSource(sources)
  const { AnalyticsStore } = load('docker/server/analytics-store.ts')
  const { readAnalyticsReport } = load('docker/server/analytics-reader.ts')
  const { buildReport } = load('docker/server/report.ts')
  const job = randomUUID(), parse = randomUUID(), prior = randomUUID(), session = randomUUID()
  const rows = [event('tool_view', undefined, { sessionId: session }), event('parse_requested', parse, { sessionId: session }),
    event('parse_finished', parse, { sessionId: session, result: 'success', at: '2026-10-24T01:00:00.000Z' }),
    event('job_created', job, { sessionId: session, parseId: parse }), event('job_started', job),
    event('job_finished', job, { sessionId: session, result: 'completed', at: '2026-10-24T01:00:00.000Z', downloadMs: 30 }),
    event('file_delivery_finished', job, { method: 'GET', status: 200, bytes: 10, result: 'completed', at: '2026-10-24T02:00:00.000Z' }),
    event('job_created', prior, { at: '2026-10-22T01:00:00.000Z' }), event('job_finished', prior, { result: 'error' }),
    event('job_finished', randomUUID(), { result: 'error' }), event('parse_rejected', undefined, { code: 'parse-quota' }),
    event('file_delivery_finished', randomUUID(), { method: 'GET', status: 206, bytes: 4, result: 'completed' }),
    event('tool_view', undefined, { environment: 'development', sessionId: randomUUID() }),
    event('job_created', randomUUID(), { test: true }), event('example_selected', undefined, { at: '2026-10-21T00:00:00.000Z' }),
    event('job_created', randomUUID(), { input: 'example' })]
  rows.push({ ...rows[5] }, { ...rows[0], test: true }, { ...rows[1], at: '2026-10-26T00:00:00.000Z' })
  fs.writeFileSync(path.join(dir, '2026-10-23.jsonl'), rows.map(row => JSON.stringify(row)).join('\n'))
  let store
  try {
    assert.deepEqual(withoutExportTime((await readAnalyticsReport(dir, options)).report), withoutExportTime(buildReport(rows, options)))
    store = new AnalyticsStore(dir)
    await store.importLegacy(() => false)
    for (const environment of ['production', 'development', 'test']) for (const input of ['all', 'user_input', 'example']) for (const includeTests of [true, false]) {
      for (const asOf of [options.to, options.asOf]) {
        const filter = { ...options, environment, input, includeTests, asOf }
        const actual = (await readAnalyticsReport(dir, filter)).report
        assert.deepEqual(withoutExportTime(actual), withoutExportTime(buildReport(rows, filter)), 'SQLite 与旧报表必须保留相同分母、孤儿、去重和跨日口径')
      }
    }
    store.close()
    fs.writeFileSync(path.join(dir, 'analytics.sqlite'), 'broken')
    await assert.rejects(readAnalyticsReport(dir, options), '数据库损坏不能静默退回过期 JSONL')
  } finally { store?.close(); fs.rmSync(dir, { recursive: true, force: true }) }
}

async function isolationChecks() {
  const dir = temporary(), load = loadSource()
  const { Analytics } = load('docker/server/analytics.ts'), { StateStore } = load('docker/server/state.ts')
  const { SessionQuota } = load('docker/server/quota.ts'), { readConfig } = load('docker/server/config.ts')
  const config = readConfig({ DOWNVID_DATA_DIR: dir }), state = new StateStore(dir), analytics = new Analytics(config)
  let locked
  try {
    analytics.record('tool_view'); await analytics.flush()
    locked = new DatabaseSync(path.join(analytics.directory, 'analytics.sqlite'))
    locked.exec('BEGIN IMMEDIATE')
    analytics.record('tool_view'); await analytics.flush()
    assert.equal(analytics.health.writeFailures, 1)
    assert.equal(analytics.health.dropped, 1)
    new SessionQuota(config, state).consume(owner, 'parse')
    state.createSession(owner, Date.now() + 60000, randomUUID())
    assert.ok(state.session(owner), '统计写锁或故障不能锁住业务库')
    locked.exec('ROLLBACK'); locked.close(); locked = undefined
    await analytics.close()
    const corruptDir = path.join(dir, 'broken-analytics')
    fs.mkdirSync(path.join(corruptDir, 'analytics'), { recursive: true })
    const file = path.join(corruptDir, 'analytics', 'analytics.sqlite')
    fs.writeFileSync(file, 'broken')
    const corrupt = new Analytics({ ...config, dataDir: corruptDir })
    corrupt.record('tool_view'); await corrupt.flush(); await corrupt.close()
    assert.equal(corrupt.health.dropped, 1)
    assert.equal(fs.readFileSync(file, 'utf8'), 'broken')
  } finally { locked?.close(); await analytics.close(); state.close(); fs.rmSync(dir, { recursive: true, force: true }) }
}

configChecks()
stateChecks()
rollbackChecks()
await concurrentQuotaChecks()
await recoveryChecks()
await startFailureChecks()
await analyticsMigrationChecks()
await reportChecks()
await isolationChecks()
for (const [file, before, after, check] of [
  ['docker/server/config.ts', "> 180) throw new Error('统计原始事件最多保留 180 天')", "> 181) throw new Error('统计原始事件最多保留 181 天')", configChecks],
  ['docker/server/state.ts', 'UNIQUE(owner, client_id)', 'UNIQUE(owner, id)', stateChecks],
  ['docker/server/sqlite.ts', "try { db.exec('ROLLBACK') }", "try { db.exec('COMMIT') }", rollbackChecks],
  ['docker/server/jobs.ts', 'this.state.saveJob(job)', 'void 0', recoveryChecks],
  ['docker/server/jobs.ts', "SET status = 'uncertain' WHERE kind = 'delivery'", "SET status = 'uncertain', reserved = 0 WHERE kind = 'delivery'", recoveryChecks],
  ['docker/server/jobs.ts', 'try { this.persist(job) }', 'try { void 0 }', startFailureChecks],
  ['docker/server/analytics-store.ts', 'payload, file, line)', 'payload, null, null)', analyticsMigrationChecks],
  ['docker/server/analytics-reader.ts', 'OR entity_id IN (SELECT entity_id FROM entities)', '', reportChecks],
]) {
  const source = fs.readFileSync(file, 'utf8'); assert.ok(source.includes(before))
  await assert.rejects(async () => check({ [file]: source.replace(before, after) }), 'SQLite 变异必须被回归拦住：' + before)
}
console.log('通过：SQLite 迁移/回滚/权限/并发额度/重启恢复/容量/故障隔离、36 组报表等价及 8 个变异反证')
