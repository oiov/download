import { randomBytes, randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Auth, Identity } from './auth'
import type { Jobs } from './jobs'
import { DAY, hash, scopes, type Scope } from './platform-store'
import { HttpError, json, jsonBody, privateHeaders } from './http'
import { WebError, webErrorCode } from '../../shared/web-errors'

export function requireScope(identity: Identity, scope: Scope) {
  if (!identity.keyId || !identity.scopes?.includes(scope)) throw new HttpError(403, 'insufficient-scope')
}

export function createApi(auth: Auth, jobs: Jobs) {
  const db = jobs.state.db
  const attempts = new Map<string, { at: number; count: number }>()
  function rate(owner: string) {
    const now = Date.now(), previous = attempts.get(owner)
    const value = previous && previous.at > now - 60000 ? previous : { at: now, count: 0 }
    if (++value.count > 120) throw new HttpError(429, 'rate-limit', Math.max(1, Math.ceil((value.at + 60000 - now) / 1000)))
    attempts.set(owner, value)
    if (attempts.size > 10000) for (const [key, row] of attempts) if (row.at < now - 60000) attempts.delete(key)
    if (attempts.size > 10000) throw new HttpError(503, 'busy')
  }
  function createKey(identity: Identity, input: { label: unknown; scopes: unknown; days: unknown }) {
    if (!auth.store.beta(identity.account)) throw new HttpError(403, 'api-beta-required')
    if (typeof input.label !== 'string' || !input.label.trim() || input.label.length > 80 || !Array.isArray(input.scopes) || !input.scopes.length || !input.scopes.every(scope => scopes.includes(scope)) || new Set(input.scopes).size !== input.scopes.length) throw new HttpError(400, 'invalid-key')
    const days = Number(input.days)
    if (!Number.isSafeInteger(days) || days < 1 || days > 365) throw new HttpError(400, 'invalid-expiry')
    if (Number(db.prepare('SELECT COUNT(*) n FROM api_keys WHERE owner = ? AND revoked_at IS NULL AND expires_at > ?').get(identity.owner, Date.now())!.n) >= 10) throw new HttpError(409, 'key-limit')
    const token = 'kv_' + randomBytes(32).toString('hex'), id = randomUUID(), now = Date.now()
    db.prepare('INSERT INTO api_keys(id,owner,digest,label,prefix,scopes,created_at,expires_at) VALUES (?,?,?,?,?,?,?,?)')
      .run(id, identity.owner, hash(token), input.label.trim(), token.slice(0, 11), JSON.stringify(input.scopes), now, now + days * DAY)
    return { id, token, expiresAt: now + days * DAY }
  }
  const keys = (owner: string) => db.prepare('SELECT id,label,prefix,scopes,created_at,expires_at,revoked_at,last_used FROM api_keys WHERE owner = ? ORDER BY created_at DESC LIMIT 100').all(owner)
  function revoke(owner: string, id: string) {
    db.prepare('UPDATE api_keys SET revoked_at = ? WHERE owner = ? AND id = ? AND revoked_at IS NULL').run(Date.now(), owner, id)
  }
  async function handle(req: IncomingMessage, res: ServerResponse, url: URL) {
    if (!url.pathname.startsWith('/api/v1/')) return false
    privateHeaders(res)
    try {
      const identity = await auth.identity(req, true)
      if (!identity?.keyId) throw new HttpError(401, 'invalid-key')
      rate(identity.owner)
      const owner = identity.owner
      if (url.pathname === '/api/v1/usage' && req.method === 'GET') {
        requireScope(identity, 'downloads:read'); json(res, 200, { usage: auth.store.usage(owner), limits: auth.store.limits(owner) }); return true
      }
      if (url.pathname === '/api/v1/parse' && req.method === 'POST') {
        requireScope(identity, 'media:parse')
        const input = await jsonBody(req)
        if (Object.keys(input).some(key => key !== 'url')) throw new HttpError(400, 'invalid-parameters')
        const info = await jobs.parse(owner, input.url, { input: 'user_input' })
        // 解析期间 Key 可能被撤销；不再向旧调用方交付结果。
        if (!(await auth.identity(req, true))?.keyId) throw new HttpError(401, 'invalid-key')
        const parsed = jobs.parsedRecords.get(info.parseId)!
        json(res, 200, { parseId: parsed.parseId, expiresAt: new Date(parsed.time + 20 * 60000).toISOString(), title: info.title,
          formats: info.formats, audioFormats: info.audioFormats, subtitles: info.subtitles, audioTracks: info.audioTracks })
        return true
      }
      if (url.pathname === '/api/v1/downloads' && req.method === 'POST') {
        requireScope(identity, 'downloads:create')
        const input = await jsonBody(req)
        const allowed = ['parseId', 'formatId', 'downloadMode', 'subtitles', 'audioTrack']
        if (Object.keys(input).some(key => !allowed.includes(key)) || typeof input.parseId !== 'string' || input.parseId.length > 100 || (input.downloadMode !== undefined && !['video', 'audio', 'subtitle'].includes(input.downloadMode))) throw new HttpError(400, 'invalid-parameters')
        const key = req.headers['idempotency-key']
        if (typeof key !== 'string' || !/^[a-zA-Z0-9_-]{8,120}$/.test(key)) throw new HttpError(400, 'idempotency-key-required')
        // 固定字段顺序，JSON 属性排列不同仍应视为同一个请求。
        const fingerprint = hash(JSON.stringify(allowed.map(field => input[field] ?? null)))
        const saved = db.prepare('SELECT * FROM idempotency WHERE owner = ? AND key = ?').get(owner, key)
        if (saved) {
          if (saved.fingerprint !== fingerprint) throw new HttpError(409, 'idempotency-conflict')
          const job = jobs.jobs.get(String(saved.job_id))
          if (!job) throw new HttpError(410, 'task-expired')
          json(res, 202, { jobId: job.id, statusUrl: '/api/v1/downloads/' + job.id, job: jobs.view(job), replayed: true }); return true
        }
        const entry = jobs.parsedRecords.get(input.parseId)
        if (!entry || entry.owner !== owner || Date.now() - entry.time > 20 * 60000) throw new HttpError(410, 'parse-expired')
        const source = entry.url
        const job = jobs.submit(owner, { ...input, url: source, taskId: 'api:' + randomUUID() }, job => {
          db.prepare('INSERT INTO idempotency VALUES (?,?,?,?,?)').run(owner, key, fingerprint, job.id, Date.now())
        })
        json(res, 202, { jobId: job.id, statusUrl: '/api/v1/downloads/' + job.id, job: jobs.view(job) }); return true
      }
      const match = /^\/api\/v1\/downloads\/([a-zA-Z0-9-]+)(\/cancel)?$/.exec(url.pathname)
      if (match) {
        requireScope(identity, match[2] ? 'downloads:cancel' : 'downloads:read')
        const job = jobs.jobs.get(match[1])
        if (!job || job.owner !== owner || Date.now() >= job.createdAt + jobs.config.ttl) throw new HttpError(404, 'not-found')
        if (match[2] && req.method === 'POST') {
          try { await jobs.pause(owner, job.clientId) } catch { throw new HttpError(409, 'cancel-pending') }
          json(res, 200, { jobId: job.id, status: job.status }); return true
        }
        if (!match[2] && req.method === 'GET') { json(res, 200, jobs.view(job)); return true }
        throw new HttpError(405, 'method-not-allowed')
      }
      // /api/v1/files 复用主路由的私有文件交付与 Range。
      if (url.pathname.startsWith('/api/v1/files/') && ['GET', 'HEAD'].includes(req.method || '')) { requireScope(identity, 'files:read'); return false }
      throw new HttpError(404, 'not-found')
    } catch (error) {
      const safe = error instanceof HttpError ? error : error instanceof WebError ? new HttpError(error.retryAfterSeconds ? 429 : 400, webErrorCode(error), error.retryAfterSeconds) : new HttpError(503, 'unavailable')
      if (safe.retryAfter) res.setHeader('Retry-After', String(safe.retryAfter))
      if (req.method === 'POST') res.setHeader('Connection', 'close')
      json(res, safe.status, { error: safe.code, ...(safe.retryAfter ? { retryAfterSeconds: safe.retryAfter } : {}) })
    }
    return true
  }
  return { handle, createKey, keys, revoke }
}
export type Api = ReturnType<typeof createApi>
