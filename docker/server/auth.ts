import type { IncomingMessage, ServerResponse } from 'node:http'
import { betterAuth } from 'better-auth'
import { getMigrations } from 'better-auth/db/migration'
import { fromNodeHeaders } from 'better-auth/node'
import type { Config } from './config'
import type { StateStore } from './state'
import { PlatformStore, hash, type Account, type Scope } from './platform-store'
import { body, HttpError, privateHeaders } from './http'

export interface Identity { owner: string; account?: Account; guest?: string; token?: string; sessionId?: string; keyId?: string; scopes?: Scope[]; analyticsId?: string }

export async function createAuth(config: Config, state: StateStore) {
  const store = new PlatformStore(state.db, config)
  const auth = config.authSecret ? betterAuth({
    appName: 'Keep Video', baseURL: config.origin, basePath: '/api/auth', secret: config.authSecret,
    database: state.db, trustedOrigins: [config.origin],
    socialProviders: config.googleClientId ? { google: { clientId: config.googleClientId, clientSecret: config.googleClientSecret } } : {},
    session: { expiresIn: 7 * 86400, cookieCache: { enabled: false } },
    advanced: { database: { generateId: 'uuid' } },
    telemetry: { enabled: false },
    logger: { disabled: true },
    rateLimit: { enabled: true, window: 60, max: 30, storage: 'database' },
  }) : undefined
  if (auth) { const migration = await getMigrations(auth.options); await migration.runMigrations() }
  const guest = (req: IncomingMessage) => {
    const tokens = (req.headers.cookie || '').split(';').map(part => part.trim()).filter(part => part.startsWith('keep_session='))
    if (tokens.length !== 1) return undefined
    const token = tokens[0].slice(13)
    if (!/^[a-f0-9]{64}$/.test(token)) return undefined
    const saved = state.session(token)
    return saved ? { owner: saved.principalId, guest: saved.principalId, token, analyticsId: saved.analyticsId } : undefined
  }
  async function identity(req: IncomingMessage, allowKey = false): Promise<Identity | undefined> {
    if (req.headers.authorization) {
      if (!allowKey || !/^Bearer kv_[a-f0-9]{64}$/.test(req.headers.authorization)) return undefined
      const token = req.headers.authorization.slice(7)
      const row = state.db.prepare('SELECT * FROM api_keys WHERE digest = ? AND revoked_at IS NULL AND expires_at > ?').get(hash(token), Date.now())
      if (!row) return undefined
      const account = store.account(String(row.owner))
      if (!account || account.disabled || !account.verified) return undefined
      if (!store.beta(account)) throw new HttpError(403, 'api-beta-required')
      state.db.prepare('UPDATE api_keys SET last_used = ? WHERE id = ?').run(Date.now(), String(row.id))
      return { owner: String(row.owner), account, keyId: String(row.id), scopes: JSON.parse(String(row.scopes)) }
    }
    const visitor = guest(req)
    if (!auth) return visitor
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers), query: { disableCookieCache: true } })
    if (!session) return visitor
    const account = store.syncAccount(session.user)
    if (account.disabled) return undefined
    return { ...visitor, owner: account.id, account, sessionId: session.session.id }
  }
  async function call(req: IncomingMessage, endpoint: string, data: unknown): Promise<Response> {
    if (!auth) throw new HttpError(503, 'login-unavailable')
    const headers = fromNodeHeaders(req.headers)
    headers.set('Content-Type', 'application/json')
    return auth.handler(new Request(config.origin + '/api/auth/' + endpoint, { method: 'POST', headers, body: JSON.stringify(data) }))
  }
  function cookies(response: Response, res: ServerResponse) {
    const values = response.headers.getSetCookie()
    if (values.length) res.setHeader('Set-Cookie', values)
  }
  async function handle(req: IncomingMessage, res: ServerResponse, url: URL) {
    if (!url.pathname.startsWith('/api/auth/')) return false
    privateHeaders(res)
    if (!auth) { res.writeHead(404).end(); return true }
    // 只开放本次产品需要的认证入口，避免默认附带的账户修改路由扩大授权面。
    if (!['/api/auth/sign-in/social', '/api/auth/callback/google', '/api/auth/sign-out'].includes(url.pathname)) { res.writeHead(404).end(); return true }
    if (!['GET', 'POST'].includes(req.method || '')) throw new HttpError(405, 'method-not-allowed')
    if (req.method === 'POST' && req.headers.origin !== config.origin) throw new HttpError(403, 'invalid-origin')
    const payload = req.method === 'POST' ? await body(req) : undefined
    const response = await auth.handler(new Request(url, { method: req.method, headers: fromNodeHeaders(req.headers), ...(payload ? { body: new Uint8Array(payload) } : {}) }))
    cookies(response, res)
    res.writeHead(response.status, Object.fromEntries([...response.headers].filter(([name]) => !['set-cookie', 'content-length', 'content-security-policy'].includes(name))))
    res.end(Buffer.from(await response.arrayBuffer()))
    return true
  }
  return { auth, store, guest, identity, handle, call, cookies }
}
export type Auth = Awaited<ReturnType<typeof createAuth>>
