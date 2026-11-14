import { accountTranslator, type AccountMessage } from '../../src/i18n/account'
import { PARSE_MESSAGES, type ParseErrorKind } from '../../shared/parse-error'
import { bytes, date, esc, stateLabel, table } from './platform-page'
import type { DownloadRecord } from './download-history'
import type { Jobs } from './jobs'

export interface AdminDownload extends DownloadRecord { removedAt: number | null; retained: boolean; userName: string | null; userEmail: string | null }
const t = accountTranslator('zh')
const unknown = () => t('unknown')
const size = (value: number | null) => value === null ? unknown() : bytes(value)
const seconds = (value: number | null) => value === null ? unknown() : (value / 1000).toLocaleString('zh-CN', { maximumFractionDigits: 2 }) + ' ' + t('seconds')
function fileState(row: AdminDownload, jobs: Jobs) {
  if (row.removedAt) return t('removedFile')
  if (!row.retained) return row.legacy ? unknown() : t('removedFile')
  if (row.createdAt + jobs.config.ttl <= Date.now()) return t('expiredFile')
  return row.fileName ? t('withinRetention') : t('noFile')
}
function user(row: AdminDownload) {
  return row.owner.startsWith('u:') ? `<a class="identity" href="/admin/users/${encodeURIComponent(row.owner)}">${esc(row.userName || row.owner)}</a><div class="status identity">${esc(row.userEmail || '')}</div>` : `${esc(t('guest'))}<div class="status identity">${esc(row.owner)}</div>`
}
function source(row: AdminDownload) { return row.source ? `<a class="source-link" href="${esc(row.source)}" target="_blank" rel="noopener noreferrer">${esc(row.source)}</a>` : esc(unknown()) }
function status(row: AdminDownload) { return row.status === 'paused' ? t('cancelledTask') : stateLabel(row.status, 'zh') }
function errorMessage(code: string | null) {
  if (!code) return '—'
  const keys: Record<string, AccountMessage> = { timeout: 'errorTimeout', 'too-large': 'errorTooLarge', storage: 'errorStorage', stopping: 'errorStopping', interrupted: 'errorInterrupted', 'stop-failed': 'errorStopFailed', busy: 'errorBusy', 'queue-full': 'errorBusy', 'parse-quota': 'errorQuota', 'download-quota': 'errorQuota', 'parse-required': 'errorParseRequired' }
  return keys[code] ? t(keys[code]) : PARSE_MESSAGES[code as ParseErrorKind] || t('errorUnknown')
}
export function downloadList(records: AdminDownload[], jobs: Jobs, query: string) {
  const headings: AccountMessage[] = ['user', 'title', 'source', 'mode', 'format', 'status', 'progress', 'fileSize', 'created', 'finished', 'fileState', 'viewDownload']
  return '<div class="history-list">' + table(headings.map(key => t(key)), records.map(row => {
    const live = jobs.jobs.get(row.id)
    return [user(row), `<a class="history-title" href="/admin/downloads/${encodeURIComponent(row.id)}?${esc(query)}">${esc(row.title || unknown())}</a><div class="status">${esc(row.id)}</div>`, source(row), esc(row.mode ? t(row.mode as 'video') : unknown()), esc(row.format || unknown()), esc(status(row)), live ? Math.round(live.progress) + '%' : row.progress === null ? '—' : Math.round(row.progress) + '%', esc(size(row.bytes)), esc(date(row.createdAt)), esc(date(row.finishedAt)), esc(fileState(row, jobs)), `<a href="/admin/downloads/${encodeURIComponent(row.id)}?${esc(query)}">${esc(t('viewDownload'))}</a>`]
  })) + '</div>'
}
export function downloadDetail(row: AdminDownload, jobs: Jobs, query: string) {
  const live = jobs.jobs.get(row.id)
  const fields: [AccountMessage, string][] = [
    ['taskId', esc(row.id)], ['user', user(row) + `<div class="status identity">${esc(row.owner)}</div>`], ['title', esc(row.title || unknown())], ['source', source(row)], ['platform', esc(row.platform || unknown())],
    ['mode', esc(row.mode ? t(row.mode as 'video') : unknown())], ['format', esc(row.format || unknown())], ['quality', esc(row.quality || unknown())], ['audioTrack', esc(row.audioTrack || unknown())], ['subtitles', esc(row.subtitles.join(', ') || '—')],
    ['status', esc(status(row))], ['phase', esc(stateLabel(live?.phase || row.phase || '—', 'zh'))], ['progress', (live ? Math.round(live.progress) : row.progress) === null ? '—' : Math.round(live?.progress ?? row.progress ?? 0) + '%'],
    ['fileName', esc(row.fileName || unknown())], ['fileSize', esc(size(row.bytes))], ['storage', esc(row.storage || unknown())], ['fileState', esc(fileState(row, jobs))],
    ['created', esc(date(row.createdAt))], ['started', esc(date(row.startedAt))], ['finished', esc(date(row.finishedAt))], ['expires', esc(date(row.createdAt + jobs.config.ttl))], ['removedAt', esc(date(row.removedAt))],
    ['elapsed', esc(seconds(row.finishedAt === null ? null : row.finishedAt - row.createdAt))], ['queueTime', esc(seconds(row.queueMs))], ['downloadTime', esc(seconds(row.downloadMs))], ['uploadTime', esc(seconds(row.uploadMs))],
    ['errorCategory', esc(row.errorCode || '—')], ['failureReason', esc(errorMessage(row.errorCode))],
  ]
  return `<a class="back" href="/admin/downloads?${esc(query)}">← ${esc(t('returnedHistory'))}</a><h1>${esc(t('historyDetail'))}</h1>${row.legacy ? `<p class="notice">${esc(t('legacyHistory'))}</p>` : ''}<section class="card flush section history-detail">${table([t('historyField'), t('historyValue')], fields.map(([key, value]) => [t(key), value]))}</section>`
}
