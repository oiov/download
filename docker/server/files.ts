import type { IncomingMessage, ServerResponse } from 'node:http'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { Auth } from './auth'
import type { Jobs } from './jobs'
import type { Analytics } from './analytics'
import type { EventFields } from '../../shared/web-analytics'
import { parseRange } from './storage'
import { requireScope } from './api'
import { HttpError } from './http'

/** 网页与 API、local 与 R2 共用同一授权和交付账本。 */
export function createFiles(auth: Auth, jobs: Pick<Jobs, 'jobs' | 'storage' | 'config'>, analytics?: Analytics) {
  const config = jobs.config
  const deliveries = new Map<ServerResponse, { req: IncomingMessage; owner: string; keyId?: string; sessionId?: string }>()
  async function handle(req: IncomingMessage, res: ServerResponse, url: URL) {
    if (!/^\/api\/(?:v1\/)?files\/[a-zA-Z0-9-]+$/.test(url.pathname)) return false
    if (!['GET', 'HEAD'].includes(req.method || '')) throw new HttpError(405, 'method-not-allowed')
    res.setHeader('Cache-Control', 'private, no-store')
    res.setHeader('X-Robots-Tag', 'noindex')
    const identity = await auth.identity(req, true)
    if (!identity) { res.writeHead(401).end(); return true }
    const owner = identity.owner
    if (identity.keyId) requireScope(identity, 'files:read')
    const job = jobs.jobs.get(url.pathname.split('/').pop()!)
    if (!job || job.owner !== owner) { res.writeHead(404).end(); return true }
    const started = Date.now()
    const fields: EventFields = { entityId: job.analytics?.entityId, method: req.method as 'GET' | 'HEAD', bytes: 0, status: 500, result: 'error' }
    let deliveryId: string | undefined
    try {
      if (!job.file || Date.now() - job.createdAt >= config.ttl) { fields.status = 404; res.writeHead(404).end(); return true }
      try {
        const range = parseRange(req.headers.range, job.file.size)
        if (range) { fields.rangeStart = range.start; fields.rangeEnd = range.end }
      } catch { fields.status = 416; res.writeHead(416, { 'Content-Range': 'bytes */' + job.file.size }).end(); return true }
      const file = await jobs.storage.open(job.file, job.localPath!, req.headers.range)
      if (!Number.isSafeInteger(file.size) || file.size < 0 || file.size > job.file.size) { file.stream.destroy(); throw new Error('文件大小无效') }
      const current = await auth.identity(req, true)
      if (!current || current.owner !== owner || current.keyId !== identity.keyId || current.sessionId !== identity.sessionId) { file.stream.destroy(); fields.status = 401; res.writeHead(401).end(); return true }
      if (req.method !== 'HEAD') {
        try { deliveryId = auth.store.reserveDelivery(owner, file.size) }
        catch { file.stream.destroy(); fields.status = 429; res.writeHead(429, { 'Retry-After': '3600' }).end(); return true }
      }
      fields.status = file.contentRange ? 206 : 200
      res.writeHead(fields.status, { 'Content-Type': 'application/octet-stream', 'Content-Length': file.size, 'Accept-Ranges': 'bytes', 'Content-Disposition': "attachment; filename*=UTF-8''" + encodeURIComponent(job.file.name), ...(file.contentRange ? { 'Content-Range': file.contentRange } : {}) })
      if (req.method === 'HEAD') { file.stream.destroy(); res.end(); fields.result = 'completed'; return true }
      const counter = new Transform({ transform(chunk, _encoding, callback) {
        if (fields.bytes! + chunk.length > file.size) { callback(new Error('文件大小不匹配')); return }
        fields.bytes! += chunk.length; callback(null, chunk)
      } })
      deliveries.set(res, { req, owner, keyId: identity.keyId, sessionId: identity.sessionId })
      await pipeline(file.stream, counter, res)
      fields.result = 'completed'
    } catch {
      fields.result = res.destroyed ? 'aborted' : 'error'
      if (!res.headersSent) res.writeHead(500)
      res.end()
    } finally {
      deliveries.delete(res)
      if (deliveryId) auth.store.finish(deliveryId, fields.result || 'error', fields.bytes)
      analytics?.record('file_delivery_finished', job.analytics, { ...fields, durationMs: Date.now() - started })
    }
    return true
  }
  return { handle, deliveries }
}
