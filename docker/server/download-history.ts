import type { DatabaseSync } from 'node:sqlite'
import type { Job } from './jobs'
import { transaction } from './sqlite'
import { platformCategory } from '../../shared/web-analytics'
import { webErrorCodes } from '../../shared/web-errors'

export interface DownloadRecord {
  id: string; owner: string; title: string | null; source: string | null; platform: string | null
  status: Job['status']; phase: string | null; progress: number | null; mode: string | null; format: string | null
  quality: string | null; audioTrack: string | null; subtitles: string[]; fileName: string | null; bytes: number | null
  storage: string | null; createdAt: number; startedAt: number | null; finishedAt: number | null
  queueMs: number | null; downloadMs: number | null; uploadMs: number | null; errorCode: string | null; legacy: boolean
}
const text = (value: unknown, max = 512) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, max) : null
const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
/** 只保留来源页面及媒体标识参数，不复制凭据、签名、跟踪参数或服务器路径。 */
export function historySource(raw: string) {
  try {
    const source = new URL(raw)
    if (!['http:', 'https:'].includes(source.protocol)) return null
    const result = new URL(source.origin + source.pathname)
    for (const key of ['v', 'id', 'bvid', 'video_id']) {
      const value = source.searchParams.get(key)
      if (value && /^[a-zA-Z0-9_-]{1,120}$/.test(value)) result.searchParams.set(key, value)
    }
    return result.href.slice(0, 2048)
  } catch { return null }
}
export function saveDownloadHistory(db: DatabaseSync, job: Job) {
  const saved = db.prepare('SELECT payload FROM download_history WHERE id=?').get(job.id)
  const previous = saved ? JSON.parse(String(saved.payload)) as DownloadRecord : undefined
  const request = job.request
  const row: DownloadRecord = {
    id: job.id, owner: job.owner, title: text(job.title), source: historySource(job.url), platform: platformCategory(job.url),
    status: job.status, phase: text(job.phase, 30), progress: number(job.progress), mode: request?.mode || previous?.mode || null,
    format: text(request?.formatId, 120) || previous?.format || null, quality: text(request?.quality, 120) || previous?.quality || null,
    audioTrack: text(request?.audioTrack, 120) || previous?.audioTrack || null, subtitles: request?.subtitles || previous?.subtitles || [],
    fileName: job.file ? text(job.file.name.split(/[\\/]/).pop(), 255) : previous?.fileName || null,
    bytes: job.file ? number(job.file.size) : previous?.bytes ?? null, storage: job.file?.driver || previous?.storage || null,
    createdAt: job.createdAt, startedAt: number(job.startedAt), finishedAt: number(job.finishedAt),
    queueMs: number(job.queueMs), downloadMs: number(job.downloadMs), uploadMs: number(job.uploadMs),
    errorCode: job.errorCode && webErrorCodes.includes(job.errorCode) ? job.errorCode : null, legacy: false,
  }
  db.prepare(`INSERT INTO download_history(id,owner,created_at,status,payload) VALUES (?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET owner=excluded.owner,created_at=excluded.created_at,status=excluded.status,payload=excluded.payload`).run(job.id, job.owner, job.createdAt, job.status, JSON.stringify(row))
}
/** 嵌套保存点使任务及历史与外层额度事务一起提交或回滚。 */
export function historyWrite<T>(db: DatabaseSync, write: () => T) {
  db.exec('SAVEPOINT download_history_write')
  try { const result = write(); db.exec('RELEASE download_history_write'); return result }
  catch (error) { db.exec('ROLLBACK TO download_history_write; RELEASE download_history_write'); throw error }
}
export function cleanupDownloadHistory(db: DatabaseSync, days: number, now = Date.now()) {
  db.prepare('DELETE FROM download_history WHERE created_at < ? AND NOT EXISTS (SELECT 1 FROM jobs WHERE jobs.id=download_history.id)').run(now - days * 86400000)
}
export function migrateDownloadHistory(db: DatabaseSync) {
  transaction(db, () => {
    if (db.prepare("SELECT 1 FROM migrations WHERE name='download-history-v1'").get()) return
    db.exec(`CREATE TABLE download_history(id TEXT PRIMARY KEY,owner TEXT NOT NULL,created_at INTEGER NOT NULL,status TEXT NOT NULL,payload TEXT NOT NULL CHECK(json_valid(payload)),removed_at INTEGER);
      CREATE INDEX download_history_created ON download_history(created_at DESC,id);
      CREATE INDEX download_history_owner ON download_history(owner,created_at DESC);
      CREATE INDEX download_history_status ON download_history(status,created_at DESC);`)
    for (const row of db.prepare('SELECT payload FROM jobs').all()) saveDownloadHistory(db, JSON.parse(String(row.payload)))
    // 已清理的旧任务只能恢复账本事实，缺失的来源、标题、完成时间不得补造。
    for (const event of db.prepare("SELECT * FROM usage_events WHERE kind='download' AND id LIKE 'job:%'").all()) {
      const id = String(event.id).slice(4)
      if (db.prepare('SELECT 1 FROM download_history WHERE id=?').get(id)) continue
      const row: DownloadRecord = { id, owner: String(event.owner), createdAt: Number(event.at), status: event.status as Job['status'],
        title: null, source: null, platform: null, phase: null, progress: null, mode: null, format: null, quality: null, audioTrack: null, subtitles: [],
        fileName: null, bytes: event.status === 'completed' ? Number(event.bytes) : null, storage: null, startedAt: null, finishedAt: null,
        queueMs: null, downloadMs: null, uploadMs: null, errorCode: null, legacy: true }
      db.prepare('INSERT INTO download_history VALUES (?,?,?,?,?,NULL)').run(id, row.owner, row.createdAt, row.status, JSON.stringify(row))
    }
    db.prepare("INSERT INTO migrations VALUES ('download-history-v1')").run()
  })
}
