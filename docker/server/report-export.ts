/** CLI 与后台导出使用同一白名单聚合对象；CSV 防止公式注入。 */
export function exportReport(result: unknown, format: 'markdown' | 'csv') {
  const flat: [string, string][] = []
  function flatten(value: any, prefix = '') {
    if (Array.isArray(value)) value.forEach((entry, index) => flatten(entry, prefix + '.' + index))
    else if (value && typeof value === 'object') for (const [key, entry] of Object.entries(value)) flatten(entry, prefix ? prefix + '.' + key : key)
    else flat.push([prefix, value === null ? '未知/无法计算' : String(value)])
  }
  flatten(result)
  if (format === 'csv') {
    const quote = (value: string) => '"' + (/^[=+@-]/.test(value) ? "'" : '') + value.replaceAll('"', '""') + '"'
    return 'metric,value\n' + flat.map(row => row.map(quote).join(',')).join('\n')
  }
  return '# Keep Video 下载漏斗日报\n\n服务端事件口径，非计费账本；空值不等于零。\n\n| 指标 | 值 |\n| --- | --- |\n' + flat.map(([key, value]) => '| ' + key + ' | ' + value.replaceAll('|', '\\|').replaceAll('\n', ' ') + ' |').join('\n')
}
