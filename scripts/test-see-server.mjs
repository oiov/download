// 私有看板回归：真实 HTTP、只读 SQLite 子进程、登录边界及变异反证。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { build } from 'esbuild'
import { loader } from './lib/load-source.mjs'

const root = path.resolve(import.meta.dirname, '..')
const password = 'fixture-only-report-secret'
const source = file => fs.readFileSync(path.join(root, file), 'utf8')
const loadSource = sources => loader({}, { URL, URLSearchParams, Intl }, sources)
const clone = value => JSON.parse(JSON.stringify(value))
const at = Date.now() - 60000
const event = (name, fields = {}) => ({ v: 1, id: randomUUID(), name, at: new Date(at).toISOString(), environment: 'production', client: 'web',
  input: 'user_input', platform: 'youtube', language: 'zh-CN', utm: 'direct_or_unknown', referrer: 'direct_or_unknown', test: false, ...fields })
const session = randomUUID(), entityId = randomUUID(), parseId = randomUUID()
const events = [event('tool_view', { sessionId: session }), event('parse_requested', { sessionId: session, entityId: parseId }),
  event('parse_finished', { entityId: parseId, result: 'success', durationMs: 1000 }), event('job_created', { sessionId: session, entityId }),
  event('job_finished', { entityId, result: 'completed', downloadMs: 2000 }), event('file_delivery_finished', { entityId, method: 'GET', status: 200, bytes: 100, result: 'completed' }),
  event('tool_view', { sessionId: randomUUID(), test: true }), event('tool_view', { sessionId: randomUUID(), environment: 'development' })]
const options = { from: new Date(at - 86400000).toISOString(), to: new Date(at + 30000).toISOString(), asOf: new Date(at + 30000).toISOString(), timezone: 'Asia/Shanghai', environment: 'production', input: 'all', includeTests: false }
const report = { ...loadSource()('docker/server/report.ts').buildReport(events, options), reader: { backend: 'sqlite', filesRead: 0, malformedLines: 0, health: null } }

function pageChecks(sources = {}) {
  const load = loadSource(sources)
  const { seeFilter } = load('docker/server/see-report.ts'), { dashboardPage } = load('docker/server/see-page.ts')
  const { seeMessages } = load('src/i18n/see.ts')
  const filter = seeFilter(new URLSearchParams())
  assert.deepEqual(clone(filter), { days: 7, environment: 'production', input: 'all' })
  for (const invalid of ['days=0', 'days=31', 'days=1&days=7', 'environment=other', 'input=secret', 'dir=/private', 'include-tests=0', 'timezone=invalid-zone', 'sql=SELECT']) assert.throws(() => seeFilter(new URLSearchParams(invalid)))
  assert.equal(seeFilter(new URLSearchParams('include-tests=1&timezone=UTC')).includeTests, true)
  assert.deepEqual(Object.keys(seeMessages['zh-CN']).sort(), Object.keys(seeMessages['en-US']).sort())
  for (const key of Object.keys(seeMessages['zh-CN'])) assert.deepEqual(seeMessages['zh-CN'][key].match(/\{\w+\}/g), seeMessages['en-US'][key].match(/\{\w+\}/g))
  const tainted = clone(report)
  tainted.coverage.warnings.push('<script>alert("fixture")</script>')
  const html = dashboardPage(tainted, filter, false)
  for (const page of [html]) {
    assert.match(page, /<meta name="robots" content="noindex, nofollow, noarchive">/)
    assert.ok(!page.includes('<script'), '私有页面不执行脚本或第三方统计')
    assert.ok(!page.includes(password) && !page.includes(session) && !page.includes(entityId))
  }
  assert.match(html, /&lt;script&gt;/, '统计文本必须做 HTML 转义')
  assert.match(html, /当前已关闭新事件采集/)
  assert.match(html, /匿名会话与下载表现/)
  assert.match(html, /不代表用户设备已保存/)
  assert.match(html, /导出 JSON/)
  assert.ok(!source('scripts/build-website.mjs').includes("url(lang, 'see')"), '公开导航不加入私有入口')
}

async function cacheChecks(sources = {}) {
  const load = loadSource(sources), { SeeReports } = load('docker/server/see-report.ts')
  const config = load('docker/server/config.ts').readConfig({})
  let now = Date.now(), count = 0, finish, lastSignal
  const run = (_root, _dir, options, signal) => {
    count++; lastSignal = signal
    assert.equal(options.includeTests, false)
    assert.equal(Date.parse(options.to) - Date.parse(options.from), 7 * 86400000)
    return new Promise((resolve, reject) => { finish = resolve; signal.addEventListener('abort', () => reject(new Error('fixture-abort'))) })
  }
  const reports = new SeeReports(config, root, run, () => now), filter = { days: 7, environment: 'production', input: 'all' }
  try {
    const one = reports.get(filter), two = reports.get(filter)
    assert.equal(count, 1, '同筛选并发合并')
    await assert.rejects(reports.get({ ...filter, environment: 'development' }), error => error.status === 503)
    finish(report)
    assert.equal(await one, report); assert.equal(await two, report)
    assert.equal(await reports.get(filter), report)
    assert.equal(count, 1, '缓存不得重复执行查询')
    for (const extra of [{ input: 'example' }, { input: 'user_input' }, { input: 'unknown' }, { environment: 'test' }, { environment: 'development' }]) {
      const pending = reports.get({ ...filter, ...extra })
      finish(report)
      await pending
    }
    assert.equal(count, 6, '允许正常快速切换筛选，不强制每次等待')
    const overLimit = reports.get({ ...filter, environment: 'test', input: 'example' })
    finish(report)
    await assert.rejects(overLimit, error => error.status === 503, '不同筛选共享每分钟查询额度')
    now += 60001
    const next = reports.get(filter)
    assert.equal(count, 7, '缓存过期必须刷新')
    const rejected = assert.rejects(next)
    await reports.close()
    await rejected
    assert.equal(lastSignal.aborted, true, '停服必须停止报表子进程')
    await assert.rejects(reports.get(filter))
  } finally { await reports.close() }
}

async function cliChecks() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'keep-see-'))
  const load = loadSource(), { AnalyticsStore } = load('docker/server/analytics-store.ts'), { runSeeReport } = load('docker/server/see-report.ts')
  const data = path.join(directory, 'analytics'), store = new AnalyticsStore(data)
  try {
    await store.importLegacy(() => false)
    store.append(events, 1000000)
    await build({ entryPoints: [path.join(root, 'scripts/analytics-report.ts')], bundle: true, platform: 'node', format: 'esm', outfile: path.join(directory, 'analytics-report.mjs'), logLevel: 'silent' })
    const result = await runSeeReport(directory, data, options, new AbortController().signal)
    assert.equal(result.reader.backend, 'sqlite')
    assert.equal(result.usage.measuredSessions, 1, '排除测试及其他环境')
    assert.equal(result.jobs.completed, 1)
    assert.equal(result.delivery.streamedBytes, 100)
    assert.ok(!JSON.stringify(result).includes(session) && !JSON.stringify(result).includes(entityId))
    assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM events').get().n, events.length, '在线报表不得修改数据库')
    await assert.rejects(runSeeReport(directory, path.join(directory, 'missing'), options, new AbortController().signal), error => error.status === 503, '缺库不能假报零访问')
    store.db.exec("DELETE FROM metadata WHERE key = 'legacy-import-complete'")
    await assert.rejects(runSeeReport(directory, data, options, new AbortController().signal), error => error.status === 503, '迁移中不得展示部分统计')
    fs.writeFileSync(path.join(directory, 'analytics-report.mjs'), 'console.log(JSON.stringify({password: process.env.BETTER_AUTH_SECRET}))')
    await assert.rejects(runSeeReport(directory, data, options, new AbortController().signal), error => error.status === 503, '损坏报表不能通过结构检查')
    const pidFile = path.join(directory, 'child.pid')
    fs.writeFileSync(path.join(directory, 'analytics-report.mjs'), `import fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(() => {}, 1000)`)
    const abort = new AbortController()
    const pending = assert.rejects(runSeeReport(directory, data, options, abort.signal), error => error.status === 503)
    try {
      for (let i = 0; i < 500 && !fs.existsSync(pidFile); i++) await new Promise(resolve => setTimeout(resolve, 10))
      assert.ok(fs.existsSync(pidFile), '子进程必须真正启动后再验证停止')
      const pid = Number(fs.readFileSync(pidFile, 'utf8'))
      abort.abort()
      await pending
      assert.throws(() => process.kill(pid, 0), '停止承诺返回前，查询进程必须已经退出')
    } finally { abort.abort(); await pending }
  } finally { store.close(); fs.rmSync(directory, { recursive: true, force: true }) }
}

async function crossPlatformChecks() {
  let bundled = true, call
  const processFixture = { execPath: 'C:\\Program Files\\nodejs\\node.exe', env: { PATH: 'C:\\Windows', SystemRoot: 'C:\\Windows', BETTER_AUTH_SECRET: password, R2_SECRET_ACCESS_KEY: 'fixture-only-storage-secret', NODE_OPTIONS: '--inspect' } }
  const load = loader({
    'node:path': path.win32,
    'node:fs': { existsSync: () => bundled },
    'node:child_process': { execFile: (file, args, options, callback) => { call = { file, args, options }; callback(null, JSON.stringify(report)) } },
  }, { process: processFixture })
  const { runSeeReport } = load('docker/server/see-report.ts')
  const root = 'C:\\keep video', directory = path.win32.join(root, 'data', 'analytics')
  await runSeeReport(root, directory, options, new AbortController().signal)
  assert.equal(call.file, processFixture.execPath)
  assert.equal(call.args[1], path.win32.join(root, 'analytics-report.mjs'))
  assert.equal(call.args[call.args.indexOf('--dir') + 1], directory)
  assert.equal(call.options.shell, undefined, '带空格的路径必须通过 argv 而不是 shell 拼接')
  assert.deepEqual(Object.keys(call.options.env).sort(), ['PATH', 'SystemRoot'])
  bundled = false
  await runSeeReport(root, directory, options, new AbortController().signal)
  assert.equal(call.args[3], path.win32.join(root, 'scripts/analytics-report.ts'))
  const files = ['docker/server/config.ts', 'docker/server/see-report.ts', 'docker/server/see-page.ts', 'docker/server/see-style.ts', 'src/i18n/see.ts']
  const crlf = Object.fromEntries(files.map(file => [file, source(file).replace(/\r?\n/g, '\r\n')]))
  pageChecks(crlf)
}

pageChecks(); await cacheChecks(); await cliChecks(); await crossPlatformChecks()
for (const [file, before, after, check] of [
  ['docker/server/see-report.ts', "!['1', '7', '30'].includes(days)", 'false', pageChecks],
  ['docker/server/see-page.ts', 'content="noindex, nofollow, noarchive"', 'content="index, follow"', pageChecks],
  ['docker/server/see-page.ts', '${escapeHTML(warning)}', '${warning}', pageChecks],
  ['docker/server/see-report.ts', 'now - cached.at < 60000', 'true', cacheChecks],
  ['docker/server/see-report.ts', 'this.starts.length >= 6', 'false', cacheChecks],
]) {
  assert.ok(source(file).includes(before), '变异目标必须存在：' + before)
  await assert.rejects(async () => check({ [file]: source(file).replaceAll(before, after) }), '变异必须被拦住：' + before)
}
console.log('通过：管理员报表禁索引、转义、筛选、缓存、SQLite 子进程、Windows 路径与 CRLF 及 5 个变异反证')
