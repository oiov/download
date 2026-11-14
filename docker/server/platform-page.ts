import { accountTranslator, type AccountMessage } from '../../src/i18n/account'
import { escapeHTML as esc } from './see-page'
import { seeStyle } from './see-style'
import locales from '../../shared/site-locales.json'

export { esc }
/** 账户页面以 ?lang=<站点前缀> 选择语言（zh、ja、pt-br…），未知值回退英文。 */
export function siteLocale(value: string | null | undefined) {
  const prefix = String(value || '').toLowerCase()
  return locales.find(locale => locale.prefix && locale.prefix === prefix) || locales[0]
}
export const bytes = (n: number) => { const i = n > 0 ? Math.min(4, Math.floor(Math.log(n) / Math.log(1024))) : 0; return (n / 1024 ** i).toLocaleString('en-US', { maximumFractionDigits: 2 }) + ' ' + ['B', 'KiB', 'MiB', 'GiB', 'TiB'][i] }
export const date = (n: number | null | undefined) => n ? new Date(n).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : '—'
export function stateLabel(value: unknown, language = 'en') {
  const labels: Record<string, AccountMessage> = { queued: 'statusQueued', merging: 'statusMerging', uploading: 'statusUploading', pending: 'statusPending', downloading: 'statusDownloading', completed: 'statusCompleted', error: 'statusError', paused: 'statusPaused', requested: 'statusRequested', success: 'statusSuccess', streaming: 'statusStreaming', aborted: 'statusAborted', uncertain: 'statusUncertain', active: 'statusActive', trialing: 'statusTrialing', past_due: 'statusPastDue', canceled: 'statusCanceled', unpaid: 'statusUnpaid', incomplete: 'statusIncomplete', incomplete_expired: 'statusExpired', available: 'statusAvailable', missing: 'statusMissing', unavailable: 'statusUnavailable' }
  return labels[String(value)] ? accountTranslator(language)(labels[String(value)]) : String(value)
}
const tones: Record<string, string> = { completed: 'ok', success: 'ok', active: 'ok', trialing: 'ok', available: 'ok', error: 'bad', aborted: 'bad', past_due: 'bad', unpaid: 'bad', missing: 'bad', incomplete_expired: 'bad', paused: 'muted', canceled: 'muted', unavailable: 'muted' }
/** 状态徽标：颜色只做辅助，文字始终可读。 */
export function badge(value: unknown, language = 'en', label = stateLabel(value, language)) {
  return `<span class="badge badge-${tones[String(value)] || 'info'}">${esc(label)}</span>`
}
/** 页面标题区：标题与说明在左，主操作在右。参数需已转义。 */
export function heading(title: string, intro = '', actions = '') {
  return `<div class="page-head"><div><h1>${title}</h1>${intro ? `<p class="intro">${intro}</p>` : ''}</div>${actions ? `<div class="page-actions">${actions}</div>` : ''}</div>`
}
/** 热力图强度分档：按当期最大值的比例分 4 档，次数为 0 时是 0 档。 */
export function heatLevel(count: number, max: number) {
  if (count <= 0 || max <= 0) return 0
  return Math.min(4, Math.max(1, Math.ceil(count / max * 4)))
}
/**
 * 下载活动热力图（GitHub 贡献图样式）。私有页面 CSP 禁止内联样式，
 * 强度只能用 class 表达；按列（周）排布，每列从周一到周日。
 */
export function heatmap(activity: { start: number; counts: number[] }, labels: { title: string; summary: string; day: (date: string, count: number) => string; less: string; more: string; note: string }) {
  const { start, counts } = activity
  const max = Math.max(0, ...counts)
  const lead = (new Date(start).getUTCDay() + 6) % 7
  const cells = Array.from({ length: lead }, () => '<span class="heat-cell void"></span>')
  counts.forEach((count, index) => {
    const day = new Date(start + index * 86400000).toISOString().slice(0, 10)
    cells.push(`<span class="heat-cell l${heatLevel(count, max)}" title="${esc(labels.day(day, count))}"></span>`)
  })
  const legend = [0, 1, 2, 3, 4].map(level => `<span class="heat-cell l${level}"></span>`).join('')
  return `<section class="card heat-card"><div class="card-head"><div><h2>${esc(labels.title)}</h2><p>${esc(labels.summary)}</p></div></div><div class="heat-scroll"><div class="heat-grid" role="img" aria-label="${esc(labels.summary)}">${cells.join('')}</div></div><div class="heat-foot"><span class="note">${esc(labels.note)}</span><span class="heat-legend">${esc(labels.less)}${legend}${esc(labels.more)}</span></div></section>`
}
// 私有页面 CSP 禁止内联样式，用量条只能用原生 <progress>。
export const platformStyle = seeStyle + `
body { background: var(--paper); }
a { text-decoration: none; }
button, input, select, .button { border-radius: 8px; }
input[type=checkbox], input[type=radio] { min-height: 0; width: 16px; height: 16px; padding: 0; margin: 0; accent-color: var(--accent); flex-shrink: 0; }
.button, button { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 40px; padding: 8px 14px; font-size: 14px; font-weight: 600; line-height: 1.3; white-space: nowrap; color: var(--ink); }
.button:hover, button:hover { border-color: color-mix(in srgb, var(--ink) 35%, transparent); }
.primary, .button.primary { background: var(--accent); border-color: var(--accent); }
.danger, .button.danger { color: var(--error); border-color: color-mix(in srgb, var(--error) 30%, transparent); background: var(--surface); }
.danger:hover { background: color-mix(in srgb, var(--error) 6%, var(--surface)); border-color: var(--error); }
.small { min-height: 32px; padding: 4px 10px; font-size: 13px; }
form { margin: 0; }
.text-link { color: var(--focus); font-size: 14px; font-weight: 600; }
.text-link:hover { text-decoration: underline; }
.topbar { position: sticky; top: 0; z-index: 20; background: color-mix(in srgb, var(--paper) 92%, transparent); backdrop-filter: blur(10px); border-bottom: 1px solid var(--line); }
.topbar-inner { max-width: 1320px; margin: auto; min-height: 64px; padding: 0 32px; display: flex; align-items: center; gap: 28px; }
.topbar .brand { font-size: 19px; gap: 9px; flex-shrink: 0; }
.topbar .brand img { width: 28px; height: 28px; }
.topnav { display: flex; gap: 4px; align-items: center; font-size: 14px; }
.topnav a { padding: 8px 12px; border-radius: 7px; color: var(--muted); font-weight: 500; }
.topnav a:hover { color: var(--ink); background: color-mix(in srgb, var(--ink) 5%, transparent); }
.topnav a[aria-current=page] { color: var(--ink); font-weight: 650; }
.topbar-actions { margin-left: auto; display: flex; align-items: center; gap: 10px; }
.lang-menu { position: relative; }
.lang-menu summary { list-style: none; display: flex; align-items: center; gap: 6px; cursor: pointer; min-height: 38px; padding: 0 10px; border-radius: 7px; font-size: 13px; color: var(--muted); }
.lang-menu summary::-webkit-details-marker { display: none; }
.lang-menu summary::after { content: ''; width: 5px; height: 5px; border-right: 1.5px solid currentColor; border-bottom: 1.5px solid currentColor; transform: translateY(-2px) rotate(45deg); }
.lang-menu summary:hover, .lang-menu[open] summary { color: var(--ink); background: color-mix(in srgb, var(--ink) 5%, transparent); }
.lang-menu .menu-panel { min-width: 200px; z-index: 30; }
.lang-menu .menu-panel a[aria-current] { color: var(--ink); font-weight: 650; background: var(--paper); }
.topbar .account-link { min-height: 38px; height: 38px; padding: 0 15px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); font-size: 13px; font-weight: 600; }
.user-menu { position: relative; }
.user-menu summary { list-style: none; display: flex; align-items: center; gap: 9px; cursor: pointer; padding: 4px 10px 4px 4px; border: 1px solid var(--line); border-radius: 999px; background: var(--surface); font-size: 13px; font-weight: 600; min-height: 40px; }
.user-menu summary::-webkit-details-marker { display: none; }
.user-menu summary::after { content: ''; width: 6px; height: 6px; border-right: 1.5px solid var(--muted); border-bottom: 1.5px solid var(--muted); transform: translateY(-2px) rotate(45deg); margin: 0 2px 0 2px; }
.user-menu[open] summary, .user-menu summary:hover { border-color: color-mix(in srgb, var(--ink) 30%, transparent); }
.avatar { width: 30px; height: 30px; border-radius: 50%; display: grid; place-items: center; background: var(--accent); color: var(--ink); font-size: 13px; font-weight: 700; flex-shrink: 0; }
.user-name { max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.menu-panel { position: absolute; right: 0; top: calc(100% + 8px); min-width: 250px; padding: 6px; background: var(--surface); border: 1px solid var(--line); border-radius: 12px; box-shadow: 0 14px 40px #12251d1f; display: grid; gap: 2px; }
.menu-identity { padding: 10px 12px 12px; margin-bottom: 4px; border-bottom: 1px solid var(--line); display: grid; gap: 2px; }
.menu-identity strong { font-size: 14px; overflow-wrap: anywhere; }
.menu-identity span { font-size: 12px; color: var(--muted); overflow-wrap: anywhere; }
.menu-panel a, .menu-panel button { display: flex; width: 100%; justify-content: flex-start; padding: 9px 12px; min-height: 0; border: 0; border-radius: 7px; background: transparent; font-size: 14px; font-weight: 500; }
.menu-panel a:hover, .menu-panel button:hover { background: var(--paper); }
.menu-panel form { border-top: 1px solid var(--line); margin-top: 4px; padding-top: 4px; }
.menu-panel button { color: var(--error); }
.layout { max-width: 1320px; margin: auto; display: grid; grid-template-columns: 232px minmax(0, 1fr); min-height: calc(100vh - 140px); }
.rail { padding: 28px 18px 28px 32px; border-right: 1px solid var(--line); }
.rail nav { display: grid; gap: 2px; position: sticky; top: 88px; }
.rail a { padding: 9px 12px; border-radius: 8px; font-size: 14px; color: var(--muted); font-weight: 500; }
.rail a:hover { color: var(--ink); background: color-mix(in srgb, var(--ink) 4%, transparent); }
.rail a[aria-current=page] { background: var(--surface); color: var(--ink); font-weight: 650; box-shadow: 0 0 0 1px var(--line); }
.rail-group { margin: 0 12px 6px; font-size: 11px; font-weight: 650; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); }
.rail-group:not(:first-child) { margin-top: 22px; }
main { padding: 36px 32px 56px; }
.layout main { width: 100%; min-width: 0; max-width: none; margin: 0; padding: 32px 40px 64px; }
h1 { font-size: clamp(24px, 3vw, 30px); line-height: 1.3; }
h1 .count { font-size: 14px; font-weight: 600; color: var(--muted); background: var(--surface); border: 1px solid var(--line); border-radius: 999px; padding: 1px 10px; margin-left: 8px; vertical-align: middle; letter-spacing: 0; }
.page-head { display: flex; justify-content: space-between; align-items: flex-end; gap: 24px; flex-wrap: wrap; margin-bottom: 28px; }
.page-head .intro { margin-top: 6px; max-width: 720px; }
.page-actions { display: flex; gap: 10px; flex-wrap: wrap; }
.back { display: inline-block; font-size: 13px; color: var(--muted); margin-bottom: 14px; }
.back:hover { color: var(--ink); }
.section { margin: 0 0 28px; }
.card { background: var(--surface); border: 1px solid var(--line); border-radius: 12px; padding: 22px 24px; min-width: 0; }
.card + .card { margin-top: 20px; }
.card h2 { font-size: 16px; margin: 0; }
.card-head { display: flex; justify-content: space-between; align-items: center; gap: 16px; margin-bottom: 14px; }
.card-head p { font-size: 13px; color: var(--muted); margin-top: 4px; }
.card > p { font-size: 14px; color: var(--muted); }
.card.flush { padding: 0; overflow: hidden; }
.card.flush .card-head { padding: 18px 20px 0; }
.card .scroll-table { border-top: 0; }
.card table th, .card table td { padding: 12px 16px; }
.card table th:first-child, .card table td:first-child { padding-left: 20px; }
.card table th:last-child, .card table td:last-child { padding-right: 20px; }
.card table tr:last-child td { border-bottom: 0; }
.card table th { background: color-mix(in srgb, var(--paper) 60%, var(--surface)); }
.usage-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px; margin: 0; }
.usage-card { background: var(--surface); border: 1px solid var(--line); border-radius: 12px; padding: 18px 20px; }
.usage-card dt { font-size: 13px; color: var(--muted); }
.usage-card dd { margin: 8px 0 14px; font-size: 24px; font-weight: 650; letter-spacing: -.02em; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.usage-card dd small { font-size: 13px; font-weight: 500; color: var(--muted); letter-spacing: 0; }
.usage-card progress { height: 6px; display: block; }
.grid-2 > .card { margin-top: 0; }
.heat-card { margin-top: 20px; }
/* 窄屏时滚动容器用 rtl 让初始位置停在最近几周，网格本身仍按 ltr 排列 */
.heat-scroll { overflow-x: auto; padding-bottom: 4px; direction: rtl; }
.heat-grid { direction: ltr; display: grid; grid-auto-flow: column; grid-template-rows: repeat(7, auto); grid-auto-columns: minmax(10px, 1fr); gap: 3px; width: max-content; min-width: 100%; }
.heat-grid .heat-cell { aspect-ratio: 1; }
.heat-cell { display: block; width: auto; height: auto; border-radius: 3px; background: var(--track); }
.heat-cell.void { background: transparent; }
.heat-cell.l1 { background: color-mix(in srgb, var(--accent) 28%, var(--track)); }
.heat-cell.l2 { background: color-mix(in srgb, var(--accent) 52%, var(--track)); }
.heat-cell.l3 { background: color-mix(in srgb, var(--accent) 76%, var(--track)); }
.heat-cell.l4 { background: var(--focus); }
.heat-foot { display: flex; justify-content: space-between; align-items: center; gap: 16px; flex-wrap: wrap; margin-top: 12px; }
.heat-foot .note { margin: 0; }
.heat-legend { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; color: var(--muted); }
.heat-legend .heat-cell { width: 10px; height: 10px; }
.grid-2 { display: grid; grid-template-columns: minmax(0, 2fr) minmax(280px, 1fr); gap: 20px; align-items: start; margin-top: 20px; }
.stat-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px; margin: 0 0 24px; }
.link-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 16px; }
.link-card { display: block; background: var(--surface); border: 1px solid var(--line); border-radius: 12px; padding: 18px 20px; }
.link-card:hover { border-color: color-mix(in srgb, var(--ink) 30%, transparent); }
.link-card strong { display: block; font-size: 15px; margin-bottom: 4px; }
.link-card span { font-size: 13px; color: var(--muted); }
.card .plan-name { color: var(--ink); font-size: 22px; font-weight: 650; margin: 2px 0 8px; }
.plan-card .actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 18px; }
.facts { margin: 0; }
.facts div { display: grid; grid-template-columns: 160px minmax(0, 1fr); gap: 16px; padding: 12px 0; border-bottom: 1px solid var(--line); font-size: 14px; }
.facts div:last-child { border-bottom: 0; padding-bottom: 0; }
.facts dt { color: var(--muted); }
.facts dd { margin: 0; overflow-wrap: anywhere; }
.badge { display: inline-flex; align-items: center; padding: 2px 9px; border-radius: 999px; font-size: 12px; font-weight: 600; line-height: 1.6; white-space: nowrap; }
.badge-ok { background: #e3f1e6; color: #2b6a3d; }
.badge-bad { background: #fbe6e1; color: var(--error); }
.badge-info { background: #fff0df; color: #9a4a1c; }
.badge-muted { background: #eceee8; color: var(--muted); }
.empty-state { padding: 36px 20px; text-align: center; color: var(--muted); font-size: 14px; }
.empty-state .button { margin-top: 14px; }
.details-note { margin-top: 14px; font-size: 12px; color: var(--muted); }
.details-note summary { font-size: 12px; font-weight: 600; color: var(--muted); min-height: 0; }
.details-note p { margin-top: 8px; line-height: 1.8; }
.key-form { display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 1fr); gap: 16px; margin: 0; }
.key-form input:not([type=checkbox]) { width: 100%; }
.key-form fieldset { grid-column: 1 / -1; border: 0; padding: 0; margin: 0; }
.key-form legend { font-size: 12px; color: var(--muted); margin-bottom: 8px; padding: 0; }
.key-form .form-actions { grid-column: 1 / -1; }
.scopes { display: flex; gap: 8px; flex-wrap: wrap; }
.scopes label { flex-direction: row; align-items: center; gap: 8px; padding: 7px 12px; border: 1px solid var(--line); border-radius: 999px; font-size: 13px; color: var(--ink); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; cursor: pointer; }
.scopes label:has(input:checked) { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 10%, var(--surface)); }
code, pre { overflow-wrap: anywhere; white-space: pre-wrap; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; }
.secret { padding: 16px 18px; background: var(--surface); border: 1px solid var(--line); border-radius: 10px; user-select: all; margin: 16px 0 20px; }
.key-prefix { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; color: var(--muted); }
.scope-list { display: flex; flex-wrap: wrap; gap: 4px; white-space: normal; }
.scope-list code { font-size: 11px; background: var(--paper); border: 1px solid var(--line); border-radius: 5px; padding: 1px 6px; }
.status { color: var(--muted); font-size: 12px; } .identity { overflow-wrap: anywhere; }
.inline { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
.tasks th, .tasks td { text-align: left; }
.tasks th:last-child, .tasks td:last-child { text-align: right; }
.task-title { display: block; min-width: 180px; max-width: 460px; white-space: normal; overflow-wrap: anywhere; }
.source-link { display:block;max-width:260px;white-space:normal;overflow-wrap:anywhere; }.history-title { display:block;max-width:240px;white-space:normal;overflow-wrap:anywhere; }.history-detail td { white-space:normal;overflow-wrap:anywhere; }.history-detail .source-link { max-width:none; }
.history-list table { width:max-content;min-width:100%; }.history-list th,.history-list td { text-align:left;vertical-align:top; }.history-list td { min-width:80px; }.history-list td:first-child { min-width:170px; }.history-list .history-title { min-width:220px; }.history-list .source-link { min-width:220px; }.history-list .status { max-width:240px;white-space:normal;overflow-wrap:anywhere; }.history-detail td { text-align:left; }.history-detail td:first-child { width:180px; }
.scroll-table { max-width: 100%; overflow: auto; } td a { font-weight: 600; }
.filters { background: var(--surface); border: 1px solid var(--line); border-radius: 12px; padding: 16px 18px; margin: 24px 0 20px; gap: 12px 14px; }
.page-head + .filters { margin-top: 0; }
.filters input:not([type=checkbox]) { min-width: 200px; }
.filters label:has(input[type=checkbox]) { flex-direction: row; align-items: center; min-height: 44px; font-size: 13px; color: var(--ink); }
.exports { display: flex; align-items: center; gap: 4px; margin-left: auto; font-size: 13px; color: var(--muted); min-height: 44px; }
.exports a { padding: 6px 8px; border-radius: 6px; color: var(--ink); font-weight: 600; }
.exports a:hover { background: var(--paper); }
.exports .export { margin-left: 0; padding: 6px 8px; }
.metrics { background: var(--surface); border: 1px solid var(--line); border-radius: 12px; padding: 22px 24px; margin: 0 0 24px; }
.account-metrics dd { font-size: 22px; overflow-wrap: anywhere; }
.plan-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 20px; margin-top: 8px; }
.plan { padding: 24px; border: 1px solid var(--line); border-radius: 12px; background: var(--surface); display: flex; flex-direction: column; }
.plan.current { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
.plan h2 { margin-bottom: 6px; } .plan > p { font-size: 14px; color: var(--muted); min-height: 50px; }
.plan dl { margin: 16px 0 22px; flex: 1; } .plan dl div { display: flex; justify-content: space-between; gap: 16px; padding: 10px 0; border-bottom: 1px solid var(--line); font-size: 13px; } .plan dt { color: var(--muted); } .plan dd { margin: 0; text-align: right; font-weight: 600; font-variant-numeric: tabular-nums; }
.plan .button, .plan form button { width: 100%; }
.pager { display: flex; justify-content: space-between; gap: 20px; margin-top: 16px; }
.pager a { font-size: 14px; font-weight: 600; }
.history-block { margin-top: 18px; border-top: 1px solid var(--line); }
.note { font-size: 12px; color: var(--muted); margin-top: 16px; }
footer { max-width: 1320px; padding: 20px 32px 32px; border-top: 1px solid var(--line); }
@media (max-width: 1100px) { .usage-grid, .stat-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } .grid-2 { grid-template-columns: 1fr; } }
@media (max-width: 860px) {
  .topbar-inner { flex-wrap: wrap; gap: 10px 16px; padding: 10px 20px; }
  .topnav { order: 3; width: 100%; overflow-x: auto; margin: 0 -12px; }
  .user-name { display: none; }
  .layout { grid-template-columns: 1fr; }
  .rail { padding: 12px 20px; border-right: 0; border-bottom: 1px solid var(--line); overflow-x: auto; }
  .rail nav { display: flex; gap: 4px; position: static; }
  .rail a { white-space: nowrap; }
  .rail-group { display: none; }
  .layout main, main { padding: 24px 20px 48px; }
  .plan-grid { grid-template-columns: 1fr; }
  .key-form { grid-template-columns: 1fr; }
  .facts div { grid-template-columns: 1fr; gap: 2px; }
  .exports { margin-left: 0; }
  footer { padding: 20px; }
}
@media (max-width: 560px) { .usage-grid, .stat-grid { grid-template-columns: 1fr; } }
/* 与官网 site.css 同一组视觉语言：白底、Inter 字栈、暖橙强调与胶囊按钮。 */
:root { --paper: #ffffff; --soft: #f6f4f1; --ink: #14191c; --muted: #62696e; --line: #e6e3df; --track: #efece8; --focus: #b3471b;
  font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif; -webkit-font-smoothing: antialiased; }
body { background: var(--paper); }
h1 { letter-spacing: -.035em; }
.button, button:not(.menu-panel button), .topbar .account-link { border-radius: 999px; }
.button, button { padding-inline: 18px; }
.small { padding-inline: 12px; }
.rail a[aria-current=page] { background: var(--soft); box-shadow: none; }
.card { border-radius: 16px; }
.card table th, .menu-panel a[aria-current], .menu-panel a:hover, .menu-panel button:hover { background: var(--soft); }
`
type PageOptions = { publicLogin?: boolean; dashboard?: boolean; administrator?: boolean; user?: { name: string; email: string } }
export function page(title: AccountMessage, content: string, language = 'en', admin = false, current = '', options: PageOptions = {}) {
  const locale = siteLocale(language), t = accountTranslator(locale.appLocale)
  const query = locale.prefix ? '?lang=' + locale.prefix : '', home = locale.prefix ? `/${locale.prefix}/` : '/'
  const publicLogin = !!options.publicLogin && !options.user, hasLayout = admin || options.dashboard
  const isCurrent = (href: string) => current === href || (['/admin/users', '/admin/downloads'].includes(href) && current.startsWith(href + '/'))
  const link = (href: string, key: AccountMessage, className = '') => `<a href="${href}${href.startsWith('/admin') ? '' : query}"${className ? ` class="${className}"` : ''}${isCurrent(href) ? ' aria-current="page"' : ''}>${esc(t(key))}</a>`
  const userLinks: [string, AccountMessage][] = [['/dashboard', 'summary'], ['/dashboard/tasks', 'tasks'], ['/dashboard/keys', 'keys'], ['/dashboard/account', 'accountPage']]
  const adminLinks: [string, AccountMessage][] = [['/admin', 'overview'], ['/admin/users', 'users'], ['/admin/downloads', 'downloadHistory'], ['/admin/analytics', 'analytics'], ['/admin/operations', 'operations']]
  const rail = hasLayout ? `<aside class="rail"><nav aria-label="${esc(t('dashboard'))}"><p class="rail-group">${esc(t('account'))}</p>${userLinks.map(([href, key]) => link(href, key)).join('')}${admin || options.administrator ? `<p class="rail-group">${esc(t('admin'))}</p>` + adminLinks.map(([href, key]) => link(href, key)).join('') : ''}</nav></aside>` : ''
  const login = publicLogin ? `<dialog class="login-dialog" aria-labelledby="login-title" aria-describedby="login-description" data-dashboard="/dashboard${query}" data-unavailable="${esc(t('unavailable'))}" data-error="${esc(t('loginError'))}"><button type="button" class="login-close" data-login-close aria-label="${esc(t('close'))}">×</button><img class="login-mark" src="/assets/brand/frame-play.svg" width="48" height="48" alt=""><h2 id="login-title">${esc(t('loginTitle'))}</h2><p id="login-description">${esc(t('loginIntro'))}</p><form action="/account/login${query}" method="post"><button type="submit" class="login-google"><img src="/assets/brand/google.svg" width="20" height="20" alt="">${esc(t('login'))}</button></form><p class="login-error" role="alert" hidden></p><button type="button" class="login-guest" data-login-close>${esc(t('continueGuest'))}</button></dialog>` : ''
  const user = options.user
  const menu = user ? `<details class="user-menu"><summary aria-label="${esc(t('accountMenu'))}"><span class="avatar" aria-hidden="true">${esc((user.name || user.email || '?').trim().charAt(0).toUpperCase())}</span><span class="user-name">${esc(user.name || user.email)}</span></summary><div class="menu-panel"><div class="menu-identity"><strong>${esc(user.name)}</strong><span>${esc(user.email)}</span></div><a href="/dashboard${query}">${esc(t('dashboard'))}</a><a href="/dashboard/account${query}">${esc(t('accountPage'))}</a>${admin || options.administrator ? `<a href="/admin">${esc(t('admin'))}</a>` : ''}<form action="/account/logout${query}" method="post"><button type="submit">${esc(t('logout'))}</button></form></div></details>` : ''
  const accountArea = menu || (publicLogin ? `<button type="button" class="account-link" data-login-trigger data-dashboard-label="${esc(t('dashboard'))}">${esc(t('signIn'))}</button>` : '')
  const langSwitch = admin ? '' : `<details class="lang-menu"><summary aria-label="${esc(t('language'))}">${esc(locale.name)}</summary><div class="menu-panel">${locales.map(item => `<a href="${current}?lang=${item.prefix || 'en'}" lang="${item.code}" hreflang="${item.code}"${item === locale ? ' aria-current="true"' : ''}>${esc(item.name)}</a>`).join('')}</div></details>`
  return `<!doctype html><html lang="${locale.code}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex, nofollow, noarchive"><title>${esc(t(title))} | Keep Video</title><link rel="icon" href="/assets/favicon.svg"><link rel="stylesheet" href="/account/style.css">${publicLogin ? '<link rel="stylesheet" href="/assets/login.css"><script src="/assets/account.js" defer></script>' : ''}</head><body><a class="skip" href="#main">${esc(t(title))}</a><header class="topbar"><div class="topbar-inner"><a class="brand" href="${home}"><img src="/assets/brand/frame-play.svg" width="28" height="28" alt="">Keep Video</a><nav class="topnav" aria-label="${esc(t('mainNav'))}">${link(home + 'app/', 'tool')}${link('/pricing', 'pricing')}${link('/developers', 'developers')}</nav><div class="topbar-actions">${langSwitch}${accountArea}</div></div></header>${hasLayout ? '<div class="layout">' + rail : ''}<main id="main">${content}</main>${hasLayout ? '</div>' : ''}<footer>${esc(t(admin ? 'security' : 'retention'))}</footer>${login}</body></html>`
}
export function table(headings: string[], rows: string[][]) {
  return `<div class="scroll-table" role="region" tabindex="0"><table><thead><tr>${headings.map(heading => `<th scope="col">${esc(heading)}</th>`).join('')}</tr></thead><tbody>${rows.length ? rows.map(row => `<tr>${row.map(cell => `<td>${cell}</td>`).join('')}</tr>`).join('') : `<tr><td class="empty" colspan="${headings.length}">—</td></tr>`}</tbody></table></div>`
}
