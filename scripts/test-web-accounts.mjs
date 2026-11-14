// 真实 Better Auth、SQLite 和 HTTP 回归；下载器及支付上游使用明确的本地替身，不需要线上凭据。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createHmac, randomUUID } from 'node:crypto'
import { build } from 'esbuild'
import { WebSocket } from 'ws'
import Stripe from 'stripe'
import { StateStore } from '../docker/server/state.ts'
import { readConfig } from '../docker/server/config.ts'
import { createAuth } from '../docker/server/auth.ts'
import { PlatformStore, hash, scopes } from '../docker/server/platform-store.ts'
import { SessionQuota } from '../docker/server/quota.ts'
import { Billing } from '../docker/server/billing.ts'
import { AnalyticsStore } from '../docker/server/analytics-store.ts'
import { loader } from './lib/load-source.mjs'

const root = path.resolve(import.meta.dirname, '..')
const secret = 'fixture-only-auth-secret-with-more-than-thirty-two-characters'
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'keep-accounts-'))
const serverPort = http.createServer(); serverPort.listen(0, '127.0.0.1'); await once(serverPort, 'listening')
const port = serverPort.address().port; await new Promise(resolve => serverPort.close(resolve))
const origin = 'http://127.0.0.1:' + port
const config = readConfig({ SITE_URL: origin, DOWNVID_DATA_DIR: path.join(temp, 'data'), DOWNVID_DOWNLOADS: path.join(temp, 'downloads'), BETTER_AUTH_SECRET: secret,
  GOOGLE_CLIENT_ID: 'fixture-google-id', GOOGLE_CLIENT_SECRET: 'fixture-google-secret', ADMIN_EMAILS: 'admin@example.test', API_BETA_EMAILS: 'member@example.test', ANALYTICS_ENVIRONMENT: 'test', MAX_FILE_MB: '1', ACCOUNT_GENERATED_DAILY_MB: '10' })
const state = new StateStore(config.dataDir), auth = await createAuth(config, state), platform = auth.store
const context = await auth.auth.$context
const cookies = {}, owners = {}, sessionIds = {}
for (const [name, verified] of [['admin', true], ['member', true], ['other', true], ['unverified', false]]) {
  const user = await context.internalAdapter.createUser({ email: name + '@example.test', name: name === 'member' ? '<script>fixture</script>' : name, emailVerified: verified })
  const session = await context.internalAdapter.createSession(user.id)
  cookies[name] = 'better-auth.session_token=' + encodeURIComponent(session.token + '.' + createHmac('sha256', secret).update(session.token).digest('base64'))
  owners[name] = platform.syncAccount(user).id; sessionIds[name] = session.id
}
for (let i = 0; i < 26; i++) platform.syncAccount({ id: randomUUID(), email: 'page' + i + '@example.test', name: '分页用户 ' + i, emailVerified: true })
const guestToken = 'a'.repeat(64); state.createSession(guestToken, Date.now() + 600000, randomUUID())
const guestOwner = state.session(guestToken).principalId
const guestFile = path.join(config.workDir, 'guest.mp4'); fs.mkdirSync(config.workDir, { recursive: true }); fs.writeFileSync(guestFile, 'guest-media')
const guestJob = { id: randomUUID(), clientId: 'guest-task', owner: guestOwner, title: 'fixture-private-title', url: 'https://example.com/fixture-private-url', createdAt: Date.now() - 60000, status: 'completed', progress: 100, localPath: guestFile, file: { key: 'guest-media', name: 'guest.mp4', driver: 'local', size: 11 } }
state.insertJob(guestJob); platform.download(guestOwner, guestJob.id); platform.finish('job:' + guestJob.id, 'completed', 11)
const member = await auth.identity({ headers: { cookie: cookies.member } })
assert.equal(member.owner, owners.member, '使用真实签名 Cookie 读取 Better Auth 会话')
const readKey = 'kv_' + '1'.repeat(64), allKey = 'kv_' + '2'.repeat(64), secondKey = 'kv_' + '3'.repeat(64)
for (const [id, token, permissions] of [['read', readKey, ['downloads:read']], ['all', allKey, scopes], ['second', secondKey, scopes]]) state.db.prepare('INSERT INTO api_keys(id,owner,digest,label,prefix,scopes,created_at,expires_at) VALUES (?,?,?,?,?,?,?,?)').run(id, owners.member, hash(token), id, token.slice(0,11), JSON.stringify(permissions), Date.now(), Date.now() + 600000)
const analytics = new AnalyticsStore(path.join(config.dataDir, 'analytics')); await analytics.importLegacy(() => false); analytics.close()
state.close()

fs.symlinkSync(path.join(root, 'node_modules'), path.join(temp, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
const parser = path.join(temp, 'parser.mjs'), download = path.join(temp, 'download.mjs')
fs.writeFileSync(parser, `export async function parseWithYtdlp(){return {title:'fixture-media',formats:[{formatId:'mp4',hasAudio:true}],audioFormats:[],subtitles:[]}}`)
fs.writeFileSync(download, `import fs from 'node:fs';import path from 'node:path';export async function runYtdlpDownload(_options,dir){await new Promise(resolve=>setTimeout(resolve,50));const file=path.join(dir,'fixture.mp4');fs.writeFileSync(file,'fixture-media');return {filePath:file}}export async function pauseDownload(){}`)
await build({ entryPoints: [path.join(root, 'docker/server/index.ts')], outfile: path.join(temp, 'server.mjs'), bundle: true, format: 'esm', platform: 'node', packages: 'external', logLevel: 'silent', alias: { electron: path.join(root, 'docker/server/electron-shim.ts') }, plugins: [{ name: 'fixture-download-engine', setup(build) { build.onResolve({ filter: /(?:parsers|download)\/ytdlp$/ }, args => ({ path: args.path.includes('parsers') ? parser : download })) } }] })
const child = spawn(process.execPath, [path.join(temp, 'server.mjs')], { cwd: root, env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR,
  APP_ROOT: root, SITE_URL: origin, DOWNVID_WEB_HOST: '127.0.0.1', DOWNVID_WEB_PORT: String(port), DOWNVID_DATA_DIR: config.dataDir, DOWNVID_DOWNLOADS: config.workDir,
  BETTER_AUTH_SECRET: secret, GOOGLE_CLIENT_ID: 'fixture-google-id', GOOGLE_CLIENT_SECRET: 'fixture-google-secret', ADMIN_EMAILS: 'admin@example.test', API_BETA_EMAILS: 'member@example.test', ANALYTICS_ENVIRONMENT: 'test', MAX_FILE_MB: '1', ACCOUNT_GENERATED_DAILY_MB: '10' }, stdio: ['ignore', 'pipe', 'pipe'] })
let output = ''; child.stdout.on('data', data => output += data); child.stderr.on('data', data => output += data)
const sockets = []
const request = (route, cookie, init = {}) => fetch(origin + route, { redirect: 'manual', signal: AbortSignal.timeout(15000), ...init, headers: { ...(cookie ? { Cookie: cookie } : {}), ...init.headers } })
const form = (route, cookie, data = {}, extraHeaders = {}) => request(route, cookie, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/x-www-form-urlencoded', ...extraHeaders }, body: new URLSearchParams(data) })
const api = (route, token = allKey, data, headers = {}) => request('/api/v1' + route, undefined, { method: data ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + token, ...(data ? { 'Content-Type': 'application/json' } : {}), ...headers }, ...(data ? { body: JSON.stringify(data) } : {}) })
let opened
try {
  let ready = false
  for (let i = 0; i < 100; i++) { try { if ((await request('/healthz')).ok) { ready = true; break } } catch {} if (child.exitCode !== null) break; await new Promise(resolve => setTimeout(resolve, 50)) }
  assert.ok(ready, output)
  assert.deepEqual(await (await request('/api/account/session')).json(), { authenticated: false, loginEnabled: true })
  assert.deepEqual(await (await request('/api/account/session', cookies.member)).json(), { authenticated: true, loginEnabled: true }, '公开导航只读取登录布尔值，不泄露账户资料')
  for (const route of ['/dashboard', '/account']) {
    const response = await request(route)
    assert.equal(response.status, 303); assert.equal(response.headers.get('location'), '/?login=1', '未登录不能打开控制面板')
  }
  const memberDashboard = await request('/dashboard?lang=zh', cookies.member)
  assert.equal(memberDashboard.status, 200)
  const memberHtml = await memberDashboard.text()
  assert.match(memberHtml, /class="layout"/); assert.match(memberHtml, /class="rail"/)
  assert.ok(!/href="\/admin(?:["/])/.test(memberHtml), '普通用户的控制面板不渲染任何管理入口')
  const adminDashboard = await request('/dashboard?lang=zh', cookies.admin)
  assert.equal(adminDashboard.status, 200)
  const adminHtml = await adminDashboard.text()
  assert.match(adminHtml, /class="layout"/); assert.match(adminHtml, /class="rail"/); assert.match(adminHtml, /href="\/admin\/users"/)
  assert.equal((await request('/account', cookies.member)).headers.get('location'), '/dashboard?lang=en')
  for (const [cookie, status] of [[undefined, 401], [cookies.member, 403], [cookies.unverified, 403]]) {
    for (const route of ['/admin', '/admin/users', '/admin/downloads', '/admin/downloads/' + guestJob.id, '/admin/analytics/report.json', '/admin/operations']) assert.equal((await request(route, cookie)).status, status)
  }
  assert.equal((await request('/admin/users', undefined, { headers: { Authorization: 'Bearer ' + allKey } })).status, 401, '下载 Key 不能获得管理权')
  assert.equal((await request('/see')).headers.get('location'), '/admin/analytics')
  assert.equal((await form('/see/login', '', { password: 'obsolete-password' })).status, 410, '旧密码入口已移除')
  const users = await request('/admin/users?q=member&days=all', cookies.admin)
  assert.equal(users.status, 200)
  assert.match(users.headers.get('cache-control'), /no-store/); assert.match(users.headers.get('x-robots-tag'), /noindex/)
  const usersHtml = await users.text(); assert.match(usersHtml, /&lt;script&gt;fixture&lt;\/script&gt;/)
  assert.ok(!usersHtml.includes(guestJob.url) && !usersHtml.includes(guestJob.title) && !usersHtml.includes(guestToken))
  const paged = await request('/admin/users', cookies.admin); assert.match(await paged.text(), /下一页/)
  assert.equal((await request('/admin/users?page=2', cookies.admin)).status, 200)
  const history = await request('/admin/downloads?days=all&kind=guest', cookies.admin)
  assert.equal(history.status, 200); assert.match(history.headers.get('cache-control'), /no-store/)
  const historyHtml = await history.text(); assert.ok(historyHtml.includes(guestJob.title)); assert.ok(!historyHtml.includes(guestToken) && !historyHtml.includes(guestFile))
  const historyDetail = await request('/admin/downloads/' + guestJob.id, cookies.admin)
  assert.equal(historyDetail.status, 200); assert.match(await historyDetail.text(), /11 B/)
  assert.equal((await request('/admin/downloads?status=invalid', cookies.admin)).status, 400)
  assert.equal((await request('/admin/downloads?sql=SELECT', cookies.admin)).status, 400)
  assert.equal((await request('/admin/users?sql=SELECT', cookies.admin)).status, 400)
  assert.equal((await request('/admin/operations', cookies.admin)).status, 200)
  for (const ext of ['json', 'csv', 'md']) {
    const report = await request('/admin/analytics/report.' + ext + '?timezone=UTC', cookies.admin)
    assert.equal(report.status, 200); assert.match(report.headers.get('content-disposition'), /attachment/)
  }
  const login = await form('/account/login', '', {})
  assert.equal(login.status, 303); assert.equal(new URL(login.headers.get('location')).origin, 'https://accounts.google.com')
  assert.match(login.headers.get('set-cookie'), /HttpOnly/)
  const modalLogin = await form('/api/account/login?lang=zh', '', {})
  assert.equal(modalLogin.status, 200); assert.equal(new URL((await modalLogin.json()).url).origin, 'https://accounts.google.com')
  assert.equal((await form('/api/account/login', '', {}, { Origin: 'https://other.example.test' })).status, 403)
  for (const Origin of ['', 'null', 'https://other.example.test']) assert.equal((await form('/account/claim', cookies.member, { confirm: 'yes' }, { Origin })).status, 403)
  assert.equal((await form('/account/claim', cookies.member + '; keep_session=' + guestToken)).status, 400, '认领需要显式确认')
  const ws = new WebSocket(origin.replace('http:', 'ws:') + '/api/ws', { headers: { Origin: origin, Cookie: 'keep_session=' + guestToken } }); sockets.push(ws); await once(ws, 'open')
  const closed = once(ws, 'close')
  const claim = await form('/account/claim', cookies.member + '; keep_session=' + guestToken, { confirm: 'yes', guestId: owners.other })
  assert.equal(claim.status, 303); await closed
  assert.equal((await request('/api/files/' + guestJob.id, 'keep_session=' + guestToken)).status, 404)
  assert.equal((await request('/api/files/' + guestJob.id, cookies.other)).status, 404)
  assert.equal(await (await request('/api/files/' + guestJob.id, cookies.member)).text(), 'guest-media')
  const userDetail = await request('/admin/users/' + encodeURIComponent(owners.member) + '?days=all', cookies.admin)
  const detailHtml = await userDetail.text(); assert.equal(userDetail.status, 200); assert.match(detailHtml, /11 B/)
  assert.ok(!detailHtml.includes(guestJob.url) && !detailHtml.includes(guestJob.title))
  assert.equal((await api('/parse', readKey, { url: 'https://8.8.8.8/media' })).status, 403)
  assert.equal((await api('/usage', 'kv_' + '9'.repeat(64))).status, 401)
  const parsed = await api('/parse', allKey, { url: 'https://8.8.8.8/media' }); assert.equal(parsed.status, 200); const info = await parsed.json()
  assert.ok(info.parseId && info.expiresAt); assert.equal(info.cacheFile, undefined)
  const refreshed = await (await api('/parse', allKey, { url: 'https://8.8.8.8/media' })).json()
  assert.notEqual(refreshed.parseId, info.parseId, '同一个链接的新解析不能覆盖前一次 parseId 的授权结果')
  assert.equal((await api('/downloads', allKey, { parseId: info.parseId, formatId: 'mp4', directUrl: 'http://127.0.0.1' }, { 'Idempotency-Key': 'forged-input' })).status, 400)
  assert.equal((await api('/downloads', allKey, { parseId: 'missing', formatId: 'mp4' }, { 'Idempotency-Key': 'expired-parse' })).status, 410)
  const input = { parseId: info.parseId, formatId: 'mp4' }, headers = { 'Idempotency-Key': 'same-task-key' }
  const responses = await Promise.all([api('/downloads', allKey, input, headers), api('/downloads', secondKey, input, headers)])
  assert.ok(responses.every(response => response.status === 202)); const created = await Promise.all(responses.map(response => response.json()))
  assert.equal(created[0].jobId, created[1].jobId, '并发且使用不同 Key 的重放不重复建任务')
  assert.equal((await api('/downloads', allKey, { ...input, formatId: 'other' }, headers)).status, 409)
  assert.equal((await api('/downloads/' + guestJob.id, allKey)).status, 200, '认领任务归同一稳定账户')
  let completed
  for (let i = 0; i < 50; i++) { completed = await (await api('/downloads/' + created[0].jobId)).json(); if (completed.status === 'completed') break; await new Promise(resolve => setTimeout(resolve, 50)) }
  assert.equal(completed.status, 'completed')
  const file = await api('/files/' + created[0].jobId, allKey, undefined, { Range: 'bytes=0-6' }); assert.equal(file.status, 206); assert.equal(await file.text(), 'fixture')
  assert.equal((await api('/files/' + created[0].jobId, readKey)).status, 403)
  const usage = await (await api('/usage')).json(); assert.equal(usage.usage.downloads, 2); assert.equal(usage.usage.generatedBytes, 24); assert.equal(usage.usage.deliveredBytes, 18)
  const newKey = await form('/account/keys', cookies.member, { label: 'fixture-key', days: '1', scopes: 'downloads:read' }); assert.equal(newKey.status, 201); assert.match(await newKey.text(), /kv_[a-f0-9]{64}/)
  assert.equal((await form('/account/keys', cookies.other, { label: 'denied', days: '1', scopes: 'downloads:read' })).status, 403)
  assert.equal((await form('/account/keys/revoke', cookies.member, { id: 'all' })).status, 303)
  assert.equal((await api('/usage')).status, 401, '撤销后旧 Key 立即失效')
  opened = new StateStore(config.dataDir)
  assert.equal(Number(opened.db.prepare('SELECT COUNT(*) n FROM quota WHERE owner_hash=? AND action=?').get(hash(owners.member), 'download').n), 1, '幂等重放只扣一次新任务额度')
  const accountWs = new WebSocket(origin.replace('http:', 'ws:') + '/api/ws', { headers: { Origin: origin, Cookie: cookies.member } }); sockets.push(accountWs); await once(accountWs, 'open')
  const memberClosed = once(accountWs, 'close')
  const loggedOut = await form('/account/logout', cookies.member)
  assert.equal(loggedOut.status, 303); assert.equal(loggedOut.headers.get('location'), '/'); await memberClosed
  assert.equal((await request('/dashboard', cookies.member)).status, 303, '退出后不能继续访问控制面板')
  assert.equal((await (await request('/api/account/session', cookies.member)).json()).authenticated, false)
  assert.equal((await api('/usage', secondKey)).status, 200, '退出浏览器不意外撤销独立 API Key')
  opened.db.prepare('UPDATE web_accounts SET disabled=1 WHERE id=?').run(owners.member)
  assert.equal((await api('/usage', secondKey)).status, 401, '停用账户同时撤销 Key 访问')
  opened.db.prepare('DELETE FROM session WHERE id=?').run(sessionIds.admin)
  assert.equal((await request('/admin/users', cookies.admin)).status, 401, '管理员会话被撤销后不复用登录缓存')
  console.log('通过：真实账户会话、管理员隔离、分页用量、认领撤权、API 幂等/权限/撤销、文件 Range 与退出回归')
} finally {
  for (const socket of sockets) socket.terminate()
  opened?.close()
  if (child.exitCode === null) { const stopped = once(child, 'exit'); child.kill(); await stopped }
}

async function loginFlowChecks(sources = {}) {
  const http = loader()('docker/server/http.ts')
  const load = loader({ 'docker/server/http.ts': { ...http, formBody: async () => new URLSearchParams() } }, { URL, URLSearchParams }, sources)
  const { createAccount } = load('docker/server/account.ts'), { page } = load('docker/server/platform-page.ts')
  let parameters
  const auth = { identity: async () => undefined, cookies: () => {}, call: async (_req, _route, input) => { parameters = input; return { ok: true, json: async () => ({ url: 'https://accounts.google.com/fixture' }) } } }
  const handler = createAccount(auth, {}, { config: { origin, googleClientId: 'fixture' } }, {}, () => {})
  const response = () => ({ headers: {}, setHeader(key, value) { this.headers[key] = value }, getHeader(key) { return this.headers[key] }, writeHead(status, headers = {}) { this.status = status; Object.assign(this.headers, headers); return this }, end(value) { this.body = value } })
  const guest = response()
  await handler.handle({ method: 'GET', headers: {} }, guest, new URL('/dashboard?lang=zh', origin))
  assert.equal(guest.status, 303); assert.equal(guest.headers.Location, '/zh/?login=1')
  const login = response()
  await handler.handle({ method: 'POST', headers: { origin } }, login, new URL('/api/account/login?lang=zh', origin))
  assert.equal(login.status, 200); assert.equal(parameters.callbackURL, '/dashboard?lang=zh', 'Google 登录成功必须返回受保护面板')
  const normal = page('dashboard', 'fixture', 'zh', false, '/dashboard', { dashboard: true })
  const administrator = page('dashboard', 'fixture', 'zh', false, '/dashboard', { dashboard: true, administrator: true })
  for (const html of [normal, administrator]) { assert.match(html, /class="layout"/); assert.match(html, /class="rail"/) }
  assert.ok(!normal.includes('href="/admin/users"')); assert.ok(administrator.includes('href="/admin/users"'))
}

function downloadHistoryChecks(sources = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'keep-history-'))
  const load = loader({}, { URL, URLSearchParams }, sources)
  const { StateStore } = load('docker/server/state.ts'), { PlatformStore } = load('docker/server/platform-store.ts')
  const { cleanupDownloadHistory } = load('docker/server/download-history.ts'), { readAdminData } = load('docker/server/admin-data.ts'), { downloadDetail } = load('docker/server/admin-downloads.ts')
  let state = new StateStore(directory)
  try {
    const store = new PlatformStore(state.db, readConfig({})), guest = 'g:fixture-history'
    const account = store.syncAccount({ id: 'history-account', email: 'history@example.test', name: '历史用户', emailVerified: true })
    const now = Date.now(), job = { ...guestJob, id: 'history-fixture', owner: guest, title: '<script>history-title</script>', url: 'https://name:private-password@example.com/watch?v=media123&token=private-token&signature=private-signature#private-fragment', createdAt: now - 1000, startedAt: now - 900, finishedAt: now - 100, queueMs: 100, downloadMs: 700, uploadMs: 100, request: { mode: 'video', formatId: 'mp4', quality: '720p', subtitles: ['en'] }, error: 'private-raw-error', file: { ...guestJob.file, key: 'private-storage-key' } }
    job.file.name = 'C:\\private-directory\\example.mp4'
    state.insertJob(job); store.download(guest, job.id); store.finish('job:' + job.id, 'completed', 11)
    const input = query => ({ query, dataDir: directory, workDir: directory, priceId: '' })
    const before = readAdminData(input({ mode: 'download', id: job.id }))
    assert.equal(before.title, job.title); assert.equal(before.source, 'https://example.com/watch?v=media123'); assert.equal(before.quality, '720p'); assert.equal(before.fileName, 'example.mp4', 'Windows 风格的文件名也不能带出父目录')
    const serialized = JSON.stringify(before)
    for (const secret of ['private-password', 'private-token', 'private-signature', 'private-fragment', 'private-storage-key', 'private-raw-error', 'private-directory', guestFile]) assert.ok(!serialized.includes(secret), '历史白名单不得保存敏感字段：' + secret)
    store.claim(guest, account.id)
    assert.equal(readAdminData(input({ mode: 'download', id: job.id })).owner, account.id, '认领必须同步历史主体')
    state.removeJob(job.id, account.id)
    const removed = readAdminData(input({ mode: 'download', id: job.id }))
    assert.equal(removed.bytes, 11); assert.ok(removed.removedAt); assert.equal(removed.retained, false, '清理文件后历史仍可查询')
    const detail = downloadDetail(removed, { jobs: new Map(), config: { ttl: 86400000 } }, '')
    assert.match(detail, /&lt;script&gt;history-title/); assert.ok(!detail.includes('<script>'))
    const old = { ...job, id: 'history-old', clientId: 'old', owner: account.id, createdAt: now - 100 * 86400000 }
    state.insertJob(old); cleanupDownloadHistory(state.db, 90, now)
    assert.ok(readAdminData(input({ mode: 'download', id: old.id })), '仍在任务清单中的记录不得提前清理')
    state.removeJob(old.id, account.id); cleanupDownloadHistory(state.db, 90, now)
    assert.equal(readAdminData(input({ mode: 'download', id: old.id })), null)
    for (let i = 0; i < 26; i++) state.insertJob({ ...job, id: 'page-' + i, clientId: 'page-' + i, owner: account.id, title: '分页测试', status: i % 2 ? 'error' : 'completed' })
    assert.equal(readAdminData(input({ mode: 'downloads', owner: account.id, q: '分页测试' })).records.length, 25)
    assert.equal(readAdminData(input({ mode: 'downloads', owner: account.id, q: '分页测试', offset: 25 })).records.length, 1)
    assert.equal(readAdminData(input({ mode: 'downloads', status: 'error', q: '分页测试' })).count, 13)
    assert.equal(readAdminData(input({ mode: 'downloads', accountKind: 'guest' })).count, 0)
    assert.equal(readAdminData(input({ mode: 'downloads', q: "%' OR 1=1 --" })).count, 0, '搜索参数不能改变 SQL 语义')
    state.db.exec("CREATE TRIGGER history_write_failure BEFORE INSERT ON download_history BEGIN SELECT RAISE(ABORT,'fixture'); END")
    assert.throws(() => state.insertJob({ ...job, id: 'atomic-failure', clientId: 'atomic-failure', owner: account.id }))
    assert.equal(state.findJob(account.id, 'atomic-failure'), undefined, '历史写入失败必须回滚任务写入')
    state.db.exec('DROP TRIGGER history_write_failure')
    state.db.exec("DROP TABLE download_history; DELETE FROM migrations WHERE name='download-history-v1'")
    state.close(); state = new StateStore(directory)
    const migrated = readAdminData(input({ mode: 'download', id: job.id }))
    assert.equal(migrated.legacy, true); assert.equal(migrated.title, null); assert.equal(migrated.bytes, 11, '旧账本只恢复可靠事实')
    state.close(); state = new StateStore(directory)
    assert.equal(readAdminData(input({ mode: 'downloads' })).count, 27, '重启和重复迁移不得复制历史')
  } finally { state.close(); fs.rmSync(directory, { recursive: true, force: true }) }
}

async function billingChecks(sources = {}) {
  const billingDir = fs.mkdtempSync(path.join(temp, 'billing-')), state = new StateStore(billingDir)
  const config = { ...readConfig({}), stripePriceId: 'price_fixture', stripeWebhookSecret: 'whsec_fixture', googleClientId: 'fixture', authSecret: secret }
  const store = new PlatformStore(state.db, config)
  const user = store.syncAccount({ id: randomUUID(), email: 'billing@example.test', name: '付费测试', emailVerified: true })
  store.db.prepare('INSERT INTO billing_customers VALUES (?,?)').run(user.id, 'cus_fixture')
  let status = 'active', retrieveCalls = 0, existingSubscription = false, priceCalls = 0, failRetrieve = false
  const checkoutCalls = []
  const sdk = new Stripe('sk_test_fixture')
  const stripe = { webhooks: sdk.webhooks,
    prices: { retrieve: async () => { priceCalls++; return { active:true,type:'recurring',recurring:{interval:'month',interval_count:1,usage_type:'licensed'},unit_amount:500,currency:'usd',billing_scheme:'per_unit' } } },
    checkout: { sessions: { list: async()=>({data:[]}), create: async(options,request)=>{checkoutCalls.push({options,request});return {url:'https://checkout.stripe.com/fixture'}} } },
    billingPortal: { sessions: { create: async()=>({url:'https://billing.stripe.com/fixture'}) } },
    subscriptions: { list: async()=>({data:existingSubscription?[{status:'active'}]:[]}), retrieve: async () => { retrieveCalls++; if(failRetrieve)throw new Error('模拟支付服务暂不可用');return { id: 'sub_fixture', customer: 'cus_fixture', status, items: { data: [{ price: { id: 'price_fixture' }, current_period_end: Math.floor(Date.now()/1000)+3600 }] } } } } }
  const BillingClass = Object.keys(sources).length ? loader({}, { URL, URLSearchParams }, sources)('docker/server/billing.ts').Billing : Billing
  const billing = new BillingClass(config, store, stripe)
  const server = http.createServer(async (req,res) => { try { await billing.webhook(req,res) } catch(error) { res.writeHead(error.status || 503).end() } })
  server.listen(0,'127.0.0.1'); await once(server,'listening')
  const endpoint = 'http://127.0.0.1:' + server.address().port
  const event = id => JSON.stringify({ id, type: 'customer.subscription.updated', data: { object: { id: 'sub_fixture' } } })
  const post = (payload, signature = sdk.webhooks.generateTestHeaderString({ payload, secret: 'whsec_fixture' })) => fetch(endpoint, { method:'POST', headers: { 'stripe-signature':signature }, body:payload })
  try {
    await Promise.all([billing.price(),billing.price()]);assert.equal(priceCalls,1,'公开价格查询合并并发，不重复请求上游')
    const checkouts=await Promise.all([billing.checkout(user.id),billing.checkout(user.id)])
    assert.deepEqual(checkouts,['https://checkout.stripe.com/fixture','https://checkout.stripe.com/fixture'])
    assert.equal(checkoutCalls[0].request.idempotencyKey,checkoutCalls[1].request.idempotencyKey,'重复付款入口必须复用幂等键')
    assert.deepEqual(checkoutCalls[0].options.line_items,[{price:'price_fixture',quantity:1}])
    assert.equal(checkoutCalls[0].options.client_reference_id,user.id)
    assert.equal(store.paid(user.id),false,'创建 Checkout 不直接开通权益')
    existingSubscription=true;assert.equal(await billing.checkout(user.id),'https://billing.stripe.com/fixture','已有订阅转到门户而非重复购买');existingSubscription=false
    assert.equal((await post(event('evt_bad'),'invalid')).status,400); assert.equal(store.paid(user.id),false)
    assert.equal((await post(event('evt_one'))).status,200); assert.equal(store.paid(user.id),true)
    assert.equal((await post(event('evt_one'))).status,200); assert.equal(retrieveCalls,1,'重复事件不重复结算')
    status='canceled'; assert.equal((await post(event('evt_cancel'))).status,200); assert.equal(store.paid(user.id),false)
    assert.equal((await post(event('evt_old'))).status,200); assert.equal(store.paid(user.id),false,'乱序旧通知按上游当前状态核验')
    assert.equal(store.db.prepare('SELECT COUNT(*) n FROM billing_events').get().n,3)
    failRetrieve=true;assert.equal((await post(event('evt_retry'))).status,503);assert.equal(store.db.prepare('SELECT 1 FROM billing_events WHERE id=?').get('evt_retry'),undefined)
    failRetrieve=false;assert.equal((await post(event('evt_retry'))).status,200,'上游暂不可用的事件允许安全重试')
    console.log('通过：Stripe 签名、事件幂等、取消权益与乱序通知核验（本地支付上游替身）')
  } finally { await billing.close(); server.closeAllConnections(); await new Promise(resolve=>server.close(resolve)); state.close(); fs.rmSync(billingDir,{recursive:true,force:true}) }
}

function storeChecks(sources = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'keep-platform-'))
  const load = loader({}, { URL }, sources), { StateStore } = load('docker/server/state.ts'), { PlatformStore, hash } = load('docker/server/platform-store.ts')
  const state = new StateStore(dir), store = new PlatformStore(state.db, readConfig({}))
  try {
    const token='c'.repeat(64); state.createSession(token,Date.now()+60000,randomUUID()); const guest=state.session(token).principalId
    const account=store.syncAccount({id:'fixture-account',email:'fixture@example.test',name:'测试',emailVerified:true})
    state.insertJob({...guestJob,owner:guest}); store.download(guest,guestJob.id); store.finish('job:'+guestJob.id,'completed',11)
    new SessionQuota(readConfig({}),state).consume(guest,'parse')
    store.claim(guest,account.id)
    assert.notEqual(state.session(token).principalId,guest,'旧访客凭据必须失去被认领的主体')
    assert.equal(state.jobsForOwner(guest).length,0); assert.equal(state.jobsForOwner(account.id).length,1)
    assert.equal(store.usage(account.id).generatedBytes,11); assert.equal(state.db.prepare('SELECT COUNT(*) n FROM quota WHERE owner_hash=?').get(hash(account.id)).n,1)
    state.removeJob(guestJob.id,account.id); assert.equal(store.usage(account.id).downloads,1,'文件与任务删除后保留业务用量')
    assert.throws(()=>store.reserveDelivery(account.id,store.limits(account.id).deliveredBytes+1))
    const before=state.db.prepare('SELECT COUNT(*) n FROM quota').get().n
    assert.throws(()=>new SessionQuota(readConfig({}),state).consume(account.id,'download',Date.now(),()=>{store.download(account.id,'fixture-rollback');throw new Error('模拟任务提交失败')}))
    assert.equal(state.db.prepare('SELECT COUNT(*) n FROM quota').get().n,before,'提交失败时预留次数也必须回滚')
    assert.equal(store.usage(account.id).downloads,1,'提交失败不得留下用量预留')
    const config={...readConfig({}),adminEmails:['fixture@example.test']}, grants=new PlatformStore(state.db,config)
    grants.syncAccount({id:'fixture-account',email:account.email,name:'测试',emailVerified:true})
    assert.equal(grants.admin(grants.account(account.id)),true)
    const replaced=grants.syncAccount({id:'new-account',email:account.email,name:'测试',emailVerified:true})
    assert.equal(grants.admin(replaced),false,'同邮箱的新主体不能继承旧账户的管理员授权')
    state.db.prepare('UPDATE web_accounts SET disabled=1 WHERE id=?').run(account.id)
    assert.equal(grants.admin(grants.account(account.id)),false)
  } finally {state.close();fs.rmSync(dir,{recursive:true,force:true})}
}
async function adminProcessChecks() {
  let bundled=true, call, input
  const fixtureProcess={execPath:'C:\\Program Files\\nodejs\\node.exe',env:{PATH:'C:\\Windows',SystemRoot:'C:\\Windows',BETTER_AUTH_SECRET:secret,STRIPE_SECRET_KEY:'fixture-private-key',NODE_OPTIONS:'--inspect'}}
  const load=loader({
    'node:path':path.win32,'node:fs':{existsSync:()=>bundled},
    'node:child_process':{execFile:(file,args,options,callback)=>{call={file,args,options};queueMicrotask(()=>callback(null,'{"users":[],"count":0}'));return {stdin:{on:()=>{},end:value=>{input=JSON.parse(value)}}}}},
  },{process:fixtureProcess,queueMicrotask})
  const {AdminReports}=load('docker/server/admin-reports.ts')
  const config={...readConfig({}),dataDir:'C:\\keep video\\data',workDir:'C:\\keep video\\downloads',authSecret:secret,stripeSecret:'fixture-private-key'}
  for(const bundle of [true,false]) {
    bundled=bundle
    const reports=new AdminReports(config,'C:\\keep video')
    await reports.get({mode:'users',q:'fixture',offset:0,since:0,until:Date.now()})
    assert.equal(call.file,fixtureProcess.execPath);assert.equal(call.options.shell,undefined)
    assert.equal(call.args[bundle?1:3],path.win32.join('C:\\keep video',bundle?'admin-report.mjs':'scripts/admin-report.ts'))
    assert.deepEqual(Object.keys(call.options.env).sort(),['PATH','SystemRoot'])
    assert.equal(input.dataDir,config.dataDir);assert.ok(!JSON.stringify(input).includes(secret)&&!JSON.stringify(input).includes('fixture-private-key'),'只读子进程不继承账户或支付凭据')
    await reports.close()
  }
  const files=['docker/server/platform-store.ts','docker/server/state.ts','docker/server/quota.ts','docker/server/sqlite.ts']
  storeChecks(Object.fromEntries(files.map(file=>[file,fs.readFileSync(path.join(root,file),'utf8').replace(/\r?\n/g,'\r\n')])))
  console.log('通过：新增管理员子进程的 Windows 路径、凭据隔离与 CRLF 语义')
}
try {
  downloadHistoryChecks(); await loginFlowChecks(); await billingChecks(); storeChecks(); await adminProcessChecks()
  downloadHistoryChecks(Object.fromEntries(['docker/server/download-history.ts', 'docker/server/state.ts', 'docker/server/admin-data.ts', 'docker/server/admin-downloads.ts'].map(file => [file, fs.readFileSync(path.join(root, file), 'utf8').replace(/\r?\n/g, '\r\n')])))
  for (const [file, before, after] of [
    ['docker/server/download-history.ts', 'source: historySource(job.url)', 'source: job.url'],
    ['docker/server/state.ts', 'write(); saveDownloadHistory(this.db, job)', 'write()'],
    ['docker/server/platform-store.ts', '.run(owner, owner, guest)', '.run(guest, guest, guest)'],
    ['docker/server/download-history.ts', 'AND NOT EXISTS (SELECT 1 FROM jobs WHERE jobs.id=download_history.id)', ''],
  ]) {
    const source = fs.readFileSync(path.join(root, file), 'utf8'); assert.ok(source.includes(before))
    assert.throws(() => downloadHistoryChecks({ [file]: source.replace(before, after) }), '下载历史变异必须被拦住：' + before)
  }
  console.log('通过：管理员下载历史的保留、迁移、筛选分页、脱敏、认领与原子写入及 4 个变异反证')
  for (const [file, before, after] of [
    ['docker/server/account.ts', "callbackURL: '/dashboard' + suffix", "callbackURL: '/account' + suffix"],
    ['docker/server/account.ts', 'if (!account || !identity) { redirect(res, loginLocation); return true }', 'if (false) { redirect(res, loginLocation); return true }'],
    ['docker/server/platform-page.ts', 'admin || options.administrator ? ', 'true ? '],
  ]) {
    const source = fs.readFileSync(path.join(root, file), 'utf8'); assert.ok(source.includes(before))
    await assert.rejects(loginFlowChecks({ [file]: source.replace(before, after) }), '登录与面板权限变异必须被拦住：' + before)
  }
  console.log('通过：登录弹框接口、Google 回跳、Dashboard 会话门禁、共用布局与角色入口及 3 个变异反证')
  for (const [before,after] of [
    [".run(replacement, guest)", '.run(replacement, replacement)'],
    [".run(owner, guest)", '.run(guest, guest)'],
    ['usage.deliveredBytes + usage.deliveryReservedBytes + bytes > this.limits(owner).deliveredBytes', 'false'],
  ]) {
    const source=fs.readFileSync(path.join(root,'docker/server/platform-store.ts'),'utf8'); assert.ok(source.includes(before))
    assert.throws(()=>storeChecks({'docker/server/platform-store.ts':source.replaceAll(before,after)}),'账户变异必须被拦住：'+before)
  }
  console.log('通过：任务认领与用量账本的 3 个变异反证')
  for(const [before,after] of [
    ['this.stripe.webhooks.constructEvent(payload, signature, this.config.stripeWebhookSecret)', "JSON.parse(payload.toString('utf8'))"],
    ["if (db.prepare('SELECT 1 FROM billing_events WHERE id = ?').get(event.id)) return", 'if (false) return'],
  ]) {
    const source=fs.readFileSync(path.join(root,'docker/server/billing.ts'),'utf8');assert.ok(source.includes(before))
    await assert.rejects(billingChecks({'docker/server/billing.ts':source.replaceAll(before,after)}),'支付变异必须被拦住：'+before)
  }
  console.log('通过：支付签名与事件幂等的 2 个变异反证')
} finally {fs.rmSync(temp,{recursive:true,force:true})}
