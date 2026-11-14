import type { IncomingMessage, ServerResponse } from 'node:http'

export class HttpError extends Error {
  constructor(readonly status: number, readonly code: string, readonly retryAfter?: number) { super(code) }
}
export function privateHeaders(res: ServerResponse) {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0')
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive')
  res.setHeader('Referrer-Policy', 'same-origin')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'none'; style-src 'self'; img-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'")
}
export function json(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data))
}
export function redirect(res: ServerResponse, location: string) { res.writeHead(303, { Location: location }); res.end() }
export async function body(req: IncomingMessage, limit = 32768): Promise<Buffer> {
  if (req.headers['content-encoding'] || Number(req.headers['content-length'] || 0) > limit) throw new HttpError(413, 'body-too-large')
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []; let size = 0
    const cleanup = () => { clearTimeout(timer); req.off('data', data); req.off('end', end); req.off('error', failed); req.off('aborted', failed) }
    const fail = (status: number) => { cleanup(); req.pause(); reject(new HttpError(status, 'invalid-body')) }
    const failed = () => fail(400)
    const data = (chunk: Buffer) => { size += chunk.length; if (size > limit) fail(413); else chunks.push(chunk) }
    const end = () => { cleanup(); resolve(Buffer.concat(chunks)) }
    const timer = setTimeout(() => fail(408), 5000); timer.unref()
    req.on('data', data); req.once('end', end); req.once('error', failed); req.once('aborted', failed)
  })
}
export async function jsonBody(req: IncomingMessage) {
  if (req.headers['content-type']?.split(';')[0] !== 'application/json') throw new HttpError(415, 'json-required')
  try {
    const value = JSON.parse((await body(req)).toString('utf8'))
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error()
    return value as Record<string, any>
  } catch (error) { if (error instanceof HttpError) throw error; throw new HttpError(400, 'invalid-body') }
}
export async function formBody(req: IncomingMessage) {
  if (req.headers['content-type']?.split(';')[0] !== 'application/x-www-form-urlencoded') throw new HttpError(415, 'form-required')
  return new URLSearchParams((await body(req)).toString('utf8'))
}
