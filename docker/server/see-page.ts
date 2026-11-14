import { t, type SeeMessage } from '../../src/i18n/see'
import type { SeeFilter, SeeReport } from './see-report'

export const escapeHTML = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!)
const text = (key: SeeMessage, params?: Record<string, string | number>) => escapeHTML(t(key, params))
const number = (value: number | null) => value === null ? '—' : value.toLocaleString('zh-CN', { maximumFractionDigits: 2 })
const percent = (value: number | null) => value === null ? '—' : number(value) + '%'
const time = (value: string | null, timezone = 'Asia/Shanghai') => value ? new Intl.DateTimeFormat('zh-CN', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value)) : '—'

function shell(content: string, loggedIn: boolean) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow, noarchive"><title>${text(loggedIn ? 'title' : 'loginTitle')} | Keep Video</title><link rel="icon" href="/assets/favicon.svg"><link rel="stylesheet" href="/account/style.css"></head><body>
    <a class="skip" href="#main">${text('skip')}</a><header class="header"><a class="brand" href="/admin/analytics"><img src="/assets/brand/keep-mark.svg" alt="" width="31" height="31">Keep Video</a>${loggedIn ? `<form action="/account/logout" method="post"><button type="submit">${text('logout')}</button></form>` : ''}</header>
    ${content}<footer>${text('footer')}</footer></body></html>`
}

function select(name: string, label: SeeMessage, options: [string, SeeMessage][], value: string) {
  return `<label>${text(label)}<select name="${name}">${options.map(([key, title]) => `<option value="${key}"${key === value ? ' selected' : ''}>${text(title)}</option>`).join('')}</select></label>`
}
function table(title: SeeMessage, headings: SeeMessage[], rows: (string | number)[][]) {
  return `<section class="section"><h2>${text(title)}</h2><div class="scroll-table" role="region" aria-label="${text(title)}" tabindex="0"><table><thead><tr>${headings.map(key => `<th scope="col">${text(key)}</th>`).join('')}</tr></thead><tbody>${rows.length ? rows.map(row => `<tr>${row.map(cell => `<td>${escapeHTML(cell)}</td>`).join('')}</tr>`).join('') : `<tr><td class="empty" colspan="${headings.length}">${text('noRecords')}</td></tr>`}</tbody></table></div></section>`
}

export function dashboardPage(report: SeeReport, filter: SeeFilter, analyticsEnabled: boolean, render = (content: string) => shell(content, true)) {
  const { usage, jobs, parses, delivery, coverage, metadata, reader } = report
  const query = new URLSearchParams({ days: String(filter.days), environment: filter.environment, input: filter.input }).toString()
  const timezone = filter.timezone || 'Asia/Shanghai'
  const fullQuery = query + '&timezone=' + encodeURIComponent(timezone) + (filter.includeTests ? '&include-tests=1' : '')
  const metrics: [SeeMessage, number, SeeMessage][] = [
    ['measuredSessions', usage.measuredSessions, 'sessionNote'], ['realInputSessions', usage.realInputSessions, 'inputNote'],
    ['created', jobs.created, 'createdNote'], ['completed', jobs.completed, 'completedNote'],
  ]
  const funnel: [SeeMessage, number][] = [['viewed', usage.measuredSessions], ['submitted', usage.realInputSessions], ['parsed', usage.successfulParseSessions], ['jobSessions', usage.jobSessions], ['activated', usage.activatedSessions], ['delivered', usage.fullyDeliveredSessions]]
  const bytes = delivery.streamedBytes < 1024 ? number(delivery.streamedBytes) + ' B' : delivery.streamedBytes < 1048576 ? number(delivery.streamedBytes / 1024) + ' KiB' : number(delivery.streamedBytes / 1048576) + ' MiB'
  const stats: [SeeMessage, string][] = [['parseRate', percent(parses.successRatePercent)], ['jobRate', percent(jobs.completionRatePercent)], ['fullResponses', number(delivery.distinctFullResponseJobs)], ['streamedBytes', bytes], ['cancelled', number(jobs.cancelled)], ['unresolved', number(jobs.queuedOrMissing + jobs.runningOrMissing)]]
  const warnings = [...coverage.warnings, ...(!coverage.windowEvents ? [t('empty')] : []), ...(!analyticsEnabled ? [t('disabled')] : [])]
  if (reader.health && (reader.health.dropped || reader.health.writeFailures)) warnings.push(t('health', { written: reader.health.written, dropped: reader.health.dropped, failures: reader.health.writeFailures }))
  if (reader.malformedLines) warnings.push(t('malformed', { count: reader.malformedLines }))
  const durations: [SeeMessage, typeof parses.duration][] = [['parsing', parses.duration], ['queue', jobs.queue], ['download', jobs.downloadAndMerge], ['upload', jobs.upload]]
  const failures: [SeeMessage, Record<string, number>][] = [['parseFailure', parses.failures], ['downloadFailure', jobs.failures], ['parseRejected', parses.rejections], ['jobRejected', jobs.rejections]]
  const environments = Object.entries(coverage.environmentEventsInWindow).map(([key, count]) => key + ': ' + number(count)).join(' · ') || '—'
  const platforms: Record<string, string> = { youtube: 'YouTube', bilibili: 'Bilibili', tiktok: 'TikTok', twitter: 'X / Twitter', instagram: 'Instagram', douyin: 'Douyin', kuaishou: 'Kuaishou', other: t('other'), unknown: t('unknown') }
  return render(`<main id="main"><h1>${text('title')}</h1><p class="intro">${text('intro')}</p>
    <form class="filters" action="/admin/analytics" method="get">
      ${select('days', 'range', [['1', 'day'], ['7', 'week'], ['30', 'month']], String(filter.days))}
      ${select('environment', 'environment', [['production', 'production'], ['development', 'development'], ['test', 'test']], filter.environment)}
      ${select('input', 'input', [['all', 'all'], ['user_input', 'user_input'], ['example', 'example'], ['unknown', 'unknown']], filter.input)}
      <label>${text('timezone')}<input name="timezone" value="${escapeHTML(timezone)}" maxlength="80" required></label><label><input type="checkbox" name="include-tests" value="1"${filter.includeTests ? ' checked' : ''}>${text('includeTests')}</label>
      <button class="primary" type="submit">${text('refresh')}</button><span class="exports"><a class="export" href="/admin/analytics/report.json?${escapeHTML(fullQuery)}">${text('export')}</a><a href="/admin/analytics/report.csv?${escapeHTML(fullQuery)}">CSV</a><a href="/admin/analytics/report.md?${escapeHTML(fullQuery)}">Markdown</a></span>
    </form><div class="meta"><span>${text('window', { from: time(metadata.from, timezone), to: time(metadata.to, timezone) })} · ${escapeHTML(timezone)}</span><span>${text('snapshot', { time: time(metadata.exportedAt, timezone) })}</span></div>
    ${warnings.map(warning => `<p class="notice" role="status">${escapeHTML(warning)}</p>`).join('')}
    <dl class="metrics">${metrics.map(([key, value, note]) => `<div class="metric"><dt>${text(key)}</dt><dd>${number(value)}<p>${text(note)}</p></dd></div>`).join('')}</dl>
    <div class="columns"><section><h2>${text('funnel')}</h2><div class="funnel">${funnel.map(([key, value]) => `<span>${text(key)}</span><progress aria-label="${text(key)}" max="${Math.max(1, usage.measuredSessions)}" value="${value}"></progress><span class="number">${number(value)}</span>`).join('')}</div><p class="note">${text('funnelNote')}</p></section>
      <section class="delivery"><h2>${text('delivery')}</h2><dl class="rows">${stats.map(([key, value]) => `<div><dt>${text(key)}</dt><dd>${escapeHTML(value)}</dd></div>`).join('')}</dl><p class="note">${text('deliveryNote')}</p></section></div>
    ${table('platforms', ['platform', 'parseAccepted', 'parseSuccess', 'parseError', 'created', 'completed', 'jobError'], report.breakdown.platform.map(row => [platforms[row.value] || row.value, number(row.parseAccepted), number(row.parseSuccess), number(row.parseError), number(row.created), number(row.completed), number(row.error)]))}
    ${(['language', 'utm', 'referrer'] as const).map(field => table(({ language: 'languages', utm: 'utm', referrer: 'referrers' } as const)[field], ['platform', 'parseAccepted', 'parseSuccess', 'created', 'completed', 'jobError'], report.breakdown[field].map(row => [row.value, number(row.parseAccepted), number(row.parseSuccess), number(row.created), number(row.completed), number(row.error)]))).join('')}
    <div class="columns">${table('duration', ['stage', 'samples', 'median', 'p95'], durations.map(([key, value]) => [t(key), number(value.n), value.medianMs === null ? '—' : number(value.medianMs / 1000) + ' s', value.p95Ms === null ? '—' : number(value.p95Ms / 1000) + ' s']))}
      ${table('errors', ['errorKind', 'errorCode', 'count'], failures.flatMap(([key, values]) => Object.entries(values).sort((a, b) => b[1] - a[1]).map(([code, count]) => [t(key), code, number(count)])))}</div>
    <details class="details"><summary>${text('coverage')}</summary><p>${text('caveat')}</p><p>${text('coverageSpan', { from: time(coverage.firstRecordedAt), to: time(coverage.lastRecordedAt) })}</p><p>${text('environments', { values: environments })}</p>
      ${reader.health ? `<p>${text('health', { written: reader.health.written, dropped: reader.health.dropped, failures: reader.health.writeFailures })}</p>` : ''}<p>${text('malformed', { count: reader.malformedLines })}</p><ul>${coverage.caveats.map(value => `<li>${escapeHTML(value)}</li>`).join('')}</ul></details></main>`)
}
