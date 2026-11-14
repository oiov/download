// 用真实 SDK 和本地 S3 协议端点验证存储，不需要线上桶凭据。
import assert from 'node:assert/strict'
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createStorage, parseRange } from '../docker/server/storage.ts'
import { readConfig } from '../docker/server/config.ts'
import { StateStore } from '../docker/server/state.ts'
import { createAuth } from '../docker/server/auth.ts'
import { createFiles } from '../docker/server/files.ts'
import { hash } from '../docker/server/platform-store.ts'
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keep-storage-'))
const source = path.join(dir, 'sample.mp4')
fs.writeFileSync(source, 'sample-media')
const objects = new Map()
const calls = []
const server = http.createServer(async (req, res) => {
  calls.push(req.method)
  const key = new URL(req.url, 'http://localhost').pathname
  if (req.method === 'PUT') {
    const chunks = []; for await (const chunk of req) chunks.push(chunk)
    objects.set(key, Buffer.concat(chunks)); res.setHeader('ETag', '"test"'); res.end(); return
  }
  const body = objects.get(key)
  if (req.method === 'DELETE') { objects.delete(key); res.writeHead(204).end(); return }
  if (!body) { res.writeHead(404).end(); return }
  const range = parseRange(req.headers.range, body.length)
  const data = range ? body.subarray(range.start, range.end + 1) : body
  if (range) res.writeHead(206, { 'Content-Range': `bytes ${range.start}-${range.end}/${body.length}`, 'Content-Length': data.length })
  else res.setHeader('Content-Length', data.length)
  res.end(data)
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
try {
  const config = readConfig({})
  const local = createStorage(config)
  const file = await local.save(source, 'sample')
  const result = await local.open(file, source, 'bytes=0-5')
  const chunks = []; for await (const chunk of result.stream) chunks.push(chunk)
  assert.equal(Buffer.concat(chunks).toString(), 'sample')
  const r2 = createStorage({ ...config, storage: 'r2', r2: { endpoint: 'http://127.0.0.1:' + server.address().port, bucket: 'test', accessKeyId: 'test', secretAccessKey: 'test' } })
  const remote = await r2.save(source, 'owner/job/sample.mp4')
  const read = await r2.open(remote, '')
  const downloaded = []; for await (const chunk of read.stream) downloaded.push(chunk)
  assert.equal(Buffer.concat(downloaded).toString(), 'sample-media')
  await r2.remove(remote)
  assert.equal(objects.size, 0)
  assert.deepEqual(calls, ['PUT', 'GET', 'DELETE'])
  console.log('本地 Range 与 S3 SDK 上传、读取、删除通过')
  const state = new StateStore(path.join(dir, 'state'))
  const accountConfig = { ...config, apiBetaEmails: ['owner@example.test', 'other@example.test'], dataDir: path.join(dir, 'state') }
  const auth = await createAuth(accountConfig, state)
  const owner = auth.store.syncAccount({ id: 'fixture-owner', email: 'owner@example.test', name: '测试账户', emailVerified: true })
  const other = auth.store.syncAccount({ id: 'fixture-other', email: 'other@example.test', name: '其他账户', emailVerified: true })
  const tokens = ['kv_' + '4'.repeat(64), 'kv_' + '5'.repeat(64), 'kv_' + '6'.repeat(64)]
  for (const [i, token] of tokens.entries()) state.db.prepare('INSERT INTO api_keys(id,owner,digest,label,prefix,scopes,created_at,expires_at) VALUES (?,?,?,?,?,?,?,?)').run(String(i), i === 1 ? other.id : owner.id, hash(token), '测试', token.slice(0,11), JSON.stringify([i === 2 ? 'downloads:read' : 'files:read']), Date.now(), Date.now() + 600000)
  try {
    for (const [driver, storage] of [['local', local], ['r2', r2]]) {
      state.db.prepare('UPDATE api_keys SET revoked_at=NULL WHERE id=?').run('0')
      const file = await storage.save(source, 'fixture/private/' + driver + '/sample.mp4')
      const job = { id: 'fixture-file', owner: owner.id, file, localPath: source, createdAt: Date.now() }
      const handler = createFiles(auth, { config: { ...accountConfig, storage: driver }, storage, jobs: new Map([[job.id, job]]) })
      const gateway = http.createServer(async (req, res) => {
        try { if (!await handler.handle(req, res, new URL(req.url, 'http://localhost'))) res.writeHead(404).end() }
        catch (error) { if (!res.headersSent) res.writeHead(error.status || 503); res.end() }
      })
      await new Promise(resolve => gateway.listen(0, '127.0.0.1', resolve))
      const url = 'http://127.0.0.1:' + gateway.address().port + '/api/v1/files/' + job.id
      const get = (token, method = 'GET', range) => fetch(url, { method, headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(range ? { Range: range } : {}) } })
      try {
        const before = calls.length, usageBefore = auth.store.usage(owner.id).deliveredBytes
        assert.equal((await get()).status, 401)
        assert.equal((await get(tokens[1])).status, 404)
        assert.equal((await get(tokens[2])).status, 403)
        assert.equal(calls.length, before, driver + ' 未授权请求不能先读取私有对象')
        const response = await get(tokens[0], 'GET', 'bytes=0-5')
        assert.equal(response.status, 206); assert.equal(await response.text(), 'sample')
        assert.match(response.headers.get('cache-control'), /no-store/)
        assert.equal((await get(tokens[0], 'HEAD')).status, 200)
        assert.equal(auth.store.usage(owner.id).deliveredBytes, usageBefore + 6, 'HEAD 不消耗交付流量')
        job.createdAt = Date.now() - config.ttl - 1
        assert.equal((await get(tokens[0])).status, 404)
        job.createdAt = Date.now()
        state.db.prepare('UPDATE api_keys SET revoked_at=? WHERE id=?').run(Date.now(), '0')
        assert.equal((await get(tokens[0])).status, 401)
      } finally { gateway.closeAllConnections(); await new Promise(resolve => gateway.close(resolve)); await storage.remove(file) }
    }
    console.log('通过：local/R2 真实私有文件处理器的账户隔离、scope、撤销、过期、Range、HEAD 与交付账本')
  } finally { state.close() }
} finally {
  await new Promise(resolve => server.close(resolve))
  fs.rmSync(dir, { recursive: true, force: true })
}
