import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Auth } from './auth'
import type { Jobs } from './jobs'
import { HttpError, json, privateHeaders, redirect } from './http'
import { SeeReports, SeeError, seeFilter } from './see-report'
import { dashboardPage } from './see-page'
import { page, table, esc, bytes, date, stateLabel, heading } from './platform-page'
import { accountTranslator } from '../../src/i18n/account'
import { DAY } from './platform-store'
import { exportReport } from './report-export'
import { AdminReports } from './admin-reports'
import type { AdminQuery } from './admin-data'
import type { Account } from './platform-store'
import { downloadList, downloadDetail } from './admin-downloads'

export function createAdmin(auth: Auth, jobs: Jobs, root: string, reports = new SeeReports(jobs.config, root)) {
  const t = accountTranslator('zh'), store = auth.store
  const dataReports = new AdminReports(jobs.config, root)
  const metrics = (usage: ReturnType<typeof store.usage>) => `<dl class="metrics">${[['downloads', usage.downloads], ['completed', usage.completed], ['generated', bytes(usage.generatedBytes)], ['delivered', bytes(usage.deliveredBytes)]].map(([key, value]) => `<div class="metric"><dt>${esc(t(key as 'downloads'))}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl>`
  let closed = false
  const requests = new Map<string, { at: number; count: number }>()
  async function handle(req: IncomingMessage, res: ServerResponse, url: URL) {
    if (url.pathname !== '/admin' && !url.pathname.startsWith('/admin/') && url.pathname !== '/see' && !url.pathname.startsWith('/see/')) return false
    privateHeaders(res)
    const send = (status: number, html: string) => { res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(req.method === 'HEAD' ? undefined : html) }
    try {
      if (url.pathname === '/see' || url.pathname === '/see/' || url.pathname === '/see/report.json') {
        if (!['GET', 'HEAD'].includes(req.method || '')) throw new HttpError(405, 'method-not-allowed')
        redirect(res, '/admin/analytics' + (url.pathname.endsWith('.json') ? '/report.json' : '') + url.search); return true
      }
      if (url.pathname.startsWith('/see/')) throw new HttpError(410, 'legacy-login-removed')
      if (!['GET', 'HEAD'].includes(req.method || '')) throw new HttpError(405, 'method-not-allowed')
      if (closed) throw new HttpError(503, 'unavailable')
      const identity = await auth.identity(req)
      if (!identity?.account) throw new HttpError(401, 'login-required')
      if (!store.admin(identity.account)) throw new HttpError(403, 'admin-required')
      const read = async (query: AdminQuery) => {
        const data = await dataReports.get(query)
        if (!store.admin((await auth.identity(req))?.account)) throw new HttpError(403, 'admin-required')
        return data
      }
      const now = Date.now(), previous = requests.get(identity.owner)
      const bucket = previous && previous.at > now - 60000 ? previous : { at: now, count: 0 }
      requests.set(identity.owner, bucket)
      if (++bucket.count > 60) throw new HttpError(429, 'rate-limit', 60)
      const current = url.pathname
      const html = (title: Parameters<typeof page>[0], content: string) => page(title, content, 'zh', true, current, { user: { name: identity.account!.name, email: identity.account!.email } })
      if (current === '/admin/downloads' || /^\/admin\/downloads\/[^/]+$/.test(current)) {
        const allowed = ['q', 'owner', 'status', 'kind', 'days', 'page']
        if ([...url.searchParams.keys()].some(key => !allowed.includes(key) || url.searchParams.getAll(key).length !== 1)) throw new HttpError(400, 'invalid-filter')
        const q = url.searchParams.get('q') || '', owner = url.searchParams.get('owner') || '', status = url.searchParams.get('status') || 'all', kind = url.searchParams.get('kind') || 'all', days = url.searchParams.get('days') || '30', pageNumber = Number(url.searchParams.get('page') || 1)
        if (q.length > 120 || owner.length > 120 || !['all', 'pending', 'downloading', 'completed', 'error', 'paused'].includes(status) || !['all', 'account', 'guest'].includes(kind) || !['1', '7', '30', '90', 'all'].includes(days) || !Number.isSafeInteger(pageNumber) || pageNumber < 1 || pageNumber > 10000) throw new HttpError(400, 'invalid-filter')
        const search = new URLSearchParams({ q, owner, status, kind, days, page: String(pageNumber) })
        const since = days === 'all' ? 0 : Date.now() - Number(days) * DAY, until = Date.now()
        if (current !== '/admin/downloads') {
          let id: string
          try { id = decodeURIComponent(current.slice('/admin/downloads/'.length)) } catch { throw new HttpError(400, 'invalid-task') }
          if (!/^[a-zA-Z0-9-]{1,120}$/.test(id)) throw new HttpError(400, 'invalid-task')
          const row = await read({ mode: 'download', id })
          if (!row) throw new HttpError(404, 'not-found')
          send(200, html('historyDetail', downloadDetail(row, jobs, search.toString()))); return true
        }
        const data = await read({ mode: 'downloads', q, owner, status, accountKind: kind, since, until, offset: (pageNumber - 1) * 25 })
        const select = (name: string, label: Parameters<typeof t>[0], options: [string, string][], value: string) => `<label>${esc(t(label))}<select name="${name}">${options.map(([key, title]) => `<option value="${key}"${key === value ? ' selected' : ''}>${esc(title)}</option>`).join('')}</select></label>`
        const filters = `<form class="filters" method="get"><label>${esc(t('historySearch'))}<input type="search" name="q" maxlength="120" value="${esc(q)}"></label><label>${esc(t('historyOwner'))}<input name="owner" maxlength="120" value="${esc(owner)}"></label>${select('status', 'status', [['all', t('anyStatus')], ...['pending', 'downloading', 'completed', 'error', 'paused'].map(value => [value, value === 'paused' ? t('cancelledTask') : stateLabel(value, 'zh')] as [string, string])], status)}${select('kind', 'accountKind', [['all', t('anyUser')], ['account', t('registered')], ['guest', t('guest')]], kind)}${select('days', 'period', [['1', t('day')], ['7', t('week')], ['30', t('month')], ['90', t('quarter')], ['all', t('all')]], days)}<button class="primary">${esc(t('filter'))}</button></form>`
        const href = (n: number) => { const value = new URLSearchParams(search); value.set('page', String(n)); return '/admin/downloads?' + value }
        send(200, html('downloadHistory', `${heading(esc(t('downloadHistory')) + ` <span class="count">${data.count}</span>`, esc(t('historyIntro')))}${filters}<section class="card flush">${downloadList(data.records, jobs, search.toString())}</section><nav class="pager">${pageNumber > 1 ? `<a href="${esc(href(pageNumber - 1))}">${esc(t('previous'))}</a>` : '<span></span>'}${pageNumber * 25 < data.count ? `<a href="${esc(href(pageNumber + 1))}">${esc(t('next'))}</a>` : ''}</nav><p class="note">${esc(t('historyNote').replace('{days}', String(jobs.config.historyRetentionDays)))}</p>`)); return true
      }
      if (['/admin/analytics', '/admin/analytics/report.json', '/admin/analytics/report.csv', '/admin/analytics/report.md'].includes(current)) {
        const filter = seeFilter(url.searchParams)
        if (req.method === 'HEAD') { send(200, ''); return true }
        const report = await reports.get(filter)
        if (!store.admin((await auth.identity(req))?.account)) throw new HttpError(403, 'admin-required')
        if (current.endsWith('.json')) {
          res.setHeader('Content-Disposition', 'attachment; filename="keep-video-analytics.json"'); json(res, 200, report)
        } else if (current.endsWith('.csv') || current.endsWith('.md')) {
          const format = current.endsWith('.csv') ? 'csv' : 'markdown'
          res.writeHead(200, { 'Content-Type': format === 'csv' ? 'text/csv; charset=utf-8' : 'text/markdown; charset=utf-8', 'Content-Disposition': 'attachment; filename="keep-video-analytics.' + (format === 'csv' ? 'csv' : 'md') + '"' })
          res.end(exportReport(report, format))
        } else {
          const content = dashboardPage(report, filter, jobs.config.analyticsEnabled, content => content).replace(/^<main id="main">/, '').replace(/<\/main>$/, '')
          send(200, html('analytics', content))
        }
        return true
      }
      if (current === '/admin' || current === '/admin/') {
        const total = (await read({ mode: 'operations' })).accountCount
        const rows: [Parameters<typeof t>[0], number][] = [['totals', total], ['queue', [...jobs.jobs.values()].filter(job => job.status === 'pending').length], ['running', jobs.running], ['parsing', jobs.parsing]]
        const shortcuts = ([['/admin/users', 'users'], ['/admin/downloads', 'downloadHistory'], ['/admin/analytics', 'analytics'], ['/admin/operations', 'operations']] as const).map(([href, key]) => `<a class="link-card" href="${href}"><strong>${esc(t(key))} →</strong></a>`).join('')
        send(200, html('overview', `${heading(esc(t('overview')), esc(t('adminIntro')))}<dl class="stat-grid">${rows.map(([key, value]) => `<div class="usage-card"><dt>${esc(t(key))}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl><div class="link-grid">${shortcuts}</div>`)); return true
      }
      if (current === '/admin/operations') {
        const data = await read({ mode: 'operations' })
        const values = [[t('storage'), jobs.config.storage], [t('migration'), data.migrations.join(', ')], [t('analytics'), t(jobs.config.analyticsEnabled ? 'enabled' : 'closed')], [t('concurrency'), jobs.config.concurrency], [t('maxFile'), bytes(jobs.config.maxFileBytes)], [t('expiry'), jobs.config.ttl / 3600000 + ' ' + t('hour')],
          [t('schema'), data.version], [t('ledgerRecords'), data.ledgerCount], [t('taskFiles'), data.fileCount], [t('historicalAudit'), t('unknown')],
          [t('stateSize'), data.stateBytes.database === null ? t('unknown') : bytes(data.stateBytes.database)], [t('stateWal'), data.stateBytes.wal === null ? t('unknown') : bytes(data.stateBytes.wal)], [t('stateShm'), data.stateBytes.shm === null ? t('unknown') : bytes(data.stateBytes.shm)], [t('analyticsSize'), data.analytics.status === 'missing' || data.analyticsBytes.database === null ? t('unknown') : bytes(data.analyticsBytes.database)],
          [t('analyticsWal'), data.analyticsBytes.wal === null ? t('unknown') : bytes(data.analyticsBytes.wal)], [t('analyticsShm'), data.analyticsBytes.shm === null ? t('unknown') : bytes(data.analyticsBytes.shm)], [t('localSize'), data.localBytes === null ? t('unknown') : bytes(data.localBytes)], [t('remoteSize'), t('unknown')],
          [t('analyticsState'), stateLabel(data.analytics.status, 'zh')], [t('analyticsMigration'), data.analytics.legacyImportComplete === undefined ? t('unknown') : t(data.analytics.legacyImportComplete ? 'enabled' : 'closed')],
          [t('analyticsRecords'), data.analytics.records ?? t('unknown')], [t('lastEvent'), date(data.analytics.lastEventAt)], [t('malformed'), data.analytics.malformedLines ?? t('unknown')],
          [t('writeFailures'), data.analytics.health?.writeFailures ?? t('unknown')], [t('dropped'), data.analytics.health?.dropped ?? t('unknown')]]
        send(200, html('operations', `${heading(esc(t('operations')), esc(t('operationNote')))}<section class="card flush">${table([t('kind'), t('status')], values.map(row => row.map(esc)))}</section>`)); return true
      }
      if (current === '/admin/users' || /^\/admin\/users\/[^/]+$/.test(current)) {
        if ([...url.searchParams.keys()].some(key => !['q', 'page', 'days'].includes(key) || url.searchParams.getAll(key).length !== 1)) throw new HttpError(400, 'invalid-filter')
        const days = url.searchParams.get('days') || '30', pageNumber = Number(url.searchParams.get('page') || 1), q = url.searchParams.get('q') || ''
        if (!['1', '7', '30', 'all'].includes(days) || !Number.isSafeInteger(pageNumber) || pageNumber < 1 || pageNumber > 10000 || q.length > 120) throw new HttpError(400, 'invalid-filter')
        const until = Date.now(), since = days === 'all' ? 0 : until - Number(days) * DAY
        const select = `<label>${esc(t('period'))}<select name="days">${[['1', 'day'], ['7', 'week'], ['30', 'month'], ['all', 'all']].map(([value, label]) => `<option value="${value}"${value === days ? ' selected' : ''}>${esc(t(label as 'day'))}</option>`).join('')}</select></label>`
        const filter = `<form class="filters" method="get">${current === '/admin/users' ? `<label>${esc(t('search'))}<input type="search" name="q" maxlength="120" value="${esc(q)}"></label>` : ''}${select}<button class="primary">${esc(t('filter'))}</button></form>`
        if (current === '/admin/users') {
          const result = await read({ mode: 'users', q, offset: (pageNumber - 1) * 25, since, until })
          const rows = result.users.map((user: Account & { plan: string; usage: ReturnType<typeof store.usage> }) => [`<a class="identity" href="/admin/users/${encodeURIComponent(user.id)}?days=${days}">${esc(user.name)}</a><div class="status">${esc(user.email)}</div>`, esc(t(user.disabled ? 'disabled' : 'active')), esc(t(user.plan as 'free')), String(user.usage.downloads), bytes(user.usage.generatedBytes), bytes(user.usage.deliveredBytes), esc(date(user.last_active))])
          const href = (n: number) => '/admin/users?' + new URLSearchParams({ q, page: String(n), days })
          send(200, html('users', `${heading(esc(t('users')) + ` <span class="count">${result.count}</span>`, esc(t('userIntro')))}${filter}<section class="card flush">${table(['user', 'status', 'plan', 'downloads', 'generated', 'delivered', 'lastActive'].map(key => t(key as 'user')), rows)}</section><nav class="pager">${pageNumber > 1 ? `<a href="${esc(href(pageNumber - 1))}">${esc(t('previous'))}</a>` : '<span></span>'}${pageNumber * 25 < result.count ? `<a href="${esc(href(pageNumber + 1))}">${esc(t('next'))}</a>` : ''}</nav><p class="note">${esc(t('usageNote'))}</p>`)); return true
        }
        let owner: string
        try { owner = decodeURIComponent(current.slice('/admin/users/'.length)) } catch { throw new HttpError(400, 'invalid-user') }
        const data = await read({ mode: 'user', owner, since, until })
        if (!data) throw new HttpError(404, 'not-found')
        const { user, usage, events } = data
        send(200, html('detail', `<a class="back" href="/admin/users">← ${esc(t('returned'))}</a>${heading(`<span class="identity">${esc(user.name)}</span>`, `${esc(user.email)} · ${esc(t(data.plan as 'free'))} · ${esc(t(user.disabled ? 'disabled' : 'active'))} · ${esc(t('apiEnabled'))}: ${esc(t(store.beta(user) ? 'enabled' : 'closed'))}`, `<a class="button" href="/admin/downloads?owner=${encodeURIComponent(user.id)}&amp;days=all">${esc(t('downloadHistory'))}</a>`)}${filter}${metrics(usage)}<dl class="rows"><div><dt>${esc(t('parses'))}</dt><dd>${usage.parses}</dd></div><div><dt>${esc(t('failed'))}</dt><dd>${usage.failed}</dd></div><div><dt>${esc(t('reserved'))}</dt><dd>${bytes(usage.reservedBytes)}</dd></div><div><dt>${esc(t('deliveryUnconfirmed'))}</dt><dd>${bytes(usage.uncertainDeliveryBytes)}</dd></div></dl><section class="card flush section"><div class="card-head"><h2>${esc(t('userHistory'))}</h2></div>${table(['kind', 'status', 'created', 'bytes'].map(key => t(key as 'kind')), events.map((row: Record<string, unknown>) => [esc(t(({ parse: 'parses', download: 'downloads', delivery: 'delivered' } as const)[row.kind as 'parse'])), esc(stateLabel(row.status, 'zh')), esc(date(Number(row.at))), bytes(Number(row.bytes))]))}</section><p class="note">${esc(t('usageNote'))}</p>`)); return true
      }
      throw new HttpError(404, 'not-found')
    } catch (error) {
      const safe = error instanceof HttpError ? error : error instanceof SeeError ? new HttpError(error.status, error.key, error.retryAfter) : new HttpError(503, 'unavailable')
      if (safe.retryAfter) res.setHeader('Retry-After', String(safe.retryAfter))
      if (url.pathname.endsWith('.json')) json(res, safe.status, { error: safe.code })
      else send(safe.status, page('admin', `<h1>${esc(t('admin'))}</h1><p class="notice">${esc(t(safe.status === 403 ? 'forbidden' : safe.status === 401 ? 'loginRequired' : 'error'))}</p><a class="button" href="/account">${esc(t('account'))}</a>`, 'zh'))
    }
    return true
  }
  return { handle, async close() { closed = true; await Promise.all([reports.close(), dataReports.close()]) } }
}
