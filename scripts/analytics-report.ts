import fs from 'node:fs/promises'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { readAnalyticsReport } from '../docker/server/analytics-reader'
import { sourceCategory } from '../shared/web-analytics'
import { exportReport } from '../docker/server/report-export'

const { values: args } = parseArgs({ options: {
  dir: { type: 'string', default: path.join(process.env.DOWNVID_DATA_DIR || 'data/userdata', 'analytics') },
  from: { type: 'string' }, to: { type: 'string' }, 'as-of': { type: 'string', default: new Date().toISOString() },
  timezone: { type: 'string', default: 'Asia/Shanghai' }, environment: { type: 'string', default: 'production' },
  'include-tests': { type: 'boolean', default: false }, input: { type: 'string', default: 'all' },
  format: { type: 'string', default: 'markdown' }, umami: { type: 'string' },
  'umami-from': { type: 'string' }, 'umami-to': { type: 'string' }, 'umami-timezone': { type: 'string' },
  'umami-exported-at': { type: 'string' }, 'umami-filters': { type: 'string' },
  help: { type: 'boolean' },
} })
if (args.help) {
  console.log('用法：analytics:report --from ISO时间含时区 --to ISO时间含时区 [--as-of ISO时间] [--dir 事件目录] [--timezone Asia/Shanghai] [--environment production|development|test] [--input all|example|user_input|unknown] [--include-tests] [--format markdown|json|csv] [--umami 导出CSV] [--umami-from 时间 --umami-to 时间 --umami-timezone 时区 --umami-exported-at 时间 --umami-filters 筛选说明]')
  process.exit(0)
}
for (const [name, value] of [['from', args.from], ['to', args.to], ['as-of', args['as-of']]]) {
  if (!value || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value)) throw new Error(name + ' 必须是包含时区的 ISO 时间')
}
if (!['production', 'development', 'test'].includes(args.environment!)) throw new Error('统计环境无效')
if (!['all', 'example', 'user_input', 'unknown'].includes(args.input!)) throw new Error('输入分类无效')
if (!['markdown', 'csv', 'json'].includes(args.format!)) throw new Error('输出格式无效')
const { report, reader } = await readAnalyticsReport(args.dir!, { from: args.from!, to: args.to!, asOf: args['as-of']!, timezone: args.timezone!, environment: args.environment!, includeTests: args['include-tests']!, input: args.input as 'all' })
for (const warning of report.coverage.warnings) console.warn('统计提示：' + warning)

/** Umami 导出含引号和逗号；仅累加可加的 PV，不累加页面 UV 或访问数。 */
function csvRows(text: string) {
  const rows: string[][] = []
  let row: string[] = [], cell = '', quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '"') { if (quoted && text[i + 1] === '"') { cell += '"'; i++ } else quoted = !quoted }
    else if (!quoted && ch === ',') { row.push(cell); cell = '' }
    else if (!quoted && ch === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = '' }
    else cell += ch
  }
  if (quoted) throw new Error('CSV 引号未闭合')
  if (cell || row.length) { row.push(cell.replace(/\r$/, '')); rows.push(row) }
  return rows
}
let umami: unknown = null
if (args.umami) {
  const [header, ...rows] = csvRows((await fs.readFile(args.umami, 'utf8')).replace(/^\uFEFF/, ''))
  const nameAt = header.indexOf('name'), pvAt = header.indexOf('pageviews')
  if (nameAt < 0 || pvAt < 0) throw new Error('Umami CSV 缺少 name/pageviews')
  const groups = new Map<string, number>(), sources = new Map<string, number>()
  let total = 0, excluded = 0, rowCount = 0
  for (const row of rows) {
    if (row.length === 1 && !row[0]) continue
    const value = Number(row[pvAt])
    if (!Number.isSafeInteger(value) || value < 0 || !row[nameAt]) throw new Error('Umami CSV 存在无效行')
    const url = new URL(row[nameAt], 'https://keep.video')
    rowCount++; total += value
    if (!args['include-tests'] && url.searchParams.get('analytics_test') === '1') { excluded += value; continue }
    groups.set(url.pathname, (groups.get(url.pathname) || 0) + value)
    const source = sourceCategory(url.searchParams.get('utm_source') || '')
    sources.set(source, (sources.get(source) || 0) + value)
  }
  umami = {
    metadata: { from: args['umami-from'] || null, to: args['umami-to'] || null, timezone: args['umami-timezone'] || null, exportedAt: args['umami-exported-at'] || null, filters: args['umami-filters'] || null },
    sameWindow: Boolean(args['umami-from'] && args['umami-to'] && args['umami-timezone'] && Date.parse(args['umami-from']) === Date.parse(args.from!) && Date.parse(args['umami-to']) === Date.parse(args.to!)),
    rowCount, rawPageviews: total, excludedTestPageviews: excluded, includedPageviews: total - excluded,
    siteVisitors: null, visits: null, referrers: null, hourlyTrend: null, entryPages: null,
    pathnamePageviews: Object.fromEntries(groups), utmTaggedPageviews: Object.fromEntries(sources),
    note: '路径报表仅能复核 PV。页面 visitors/visits 不可累加成站点总数，缺少的窗口、来源和入站页不能推断。bounces/totaltime 全零不解释成真实零值。',
  }
}
const result = { ...report, reader, umami }
if (args.format === 'json') console.log(JSON.stringify(result, null, 2))
else console.log(exportReport(result, args.format as 'markdown' | 'csv'))
