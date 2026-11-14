/**
 * 平台解析器共用的工具。
 *
 * 抖音与快手的解析器各自维护时出现了完全重复的实现（码率估算、Cookie 解析），
 * 抽到这里以免两边慢慢漂移；域名过滤这类平台差异通过参数传入。
 */

import fs from 'node:fs'

/** Netscape 格式 cookies.txt 的一行 */
export interface CookieItem {
  domain: string
  includeSubdomains: boolean
  path: string
  secure: boolean
  expiry: number
  name: string
  value: string
}

/**
 * 解析用户导出的 Cookie 文件：Netscape 文本或浏览器扩展导出的 JSON 数组。
 *
 * 与 utils/cookies.ts 里的实现是两回事：那个负责从浏览器导出快照供 yt-dlp 使用，
 * 这里只解析用户已导出的纯文本文件，供平台 API 请求自行拼请求头。
 * 文件不可读时返回空数组——调用方会退化为无 Cookie 请求，而不是整体失败。
 */
export function parseCookiesFile(filePath: string): CookieItem[] {
  try {
    return parseCookieText(fs.readFileSync(filePath, 'utf-8'))
  } catch {
    return []
  }
}

const HTTP_ONLY_PREFIX = '#HttpOnly_'

/**
 * 解析 Cookie 文本。
 *
 * - Cookie-Editor 等扩展导出的是 JSON 数组，只按制表符切会一条都解析不出来；
 * - curl / 浏览器扩展导出的 Netscape 文件会给 HttpOnly Cookie 加 `#HttpOnly_` 前缀，
 *   按注释跳过会丢掉抖音 `sessionid` 这类真正承载登录态的 Cookie。
 */
export function parseCookieText(content: string): CookieItem[] {
  const fromJson = parseJsonCookies(content)
  if (fromJson) return fromJson
  const cookies: CookieItem[] = []
  for (const line of content.split('\n')) {
    let trimmed = line.trim()
    if (trimmed.startsWith(HTTP_ONLY_PREFIX)) trimmed = trimmed.slice(HTTP_ONLY_PREFIX.length)
    if (!trimmed || trimmed.startsWith('#')) continue
    const parts = trimmed.split('\t')
    if (parts.length < 7) continue
    cookies.push({
      domain: parts[0],
      includeSubdomains: parts[1] === 'TRUE',
      path: parts[2],
      secure: parts[3] === 'TRUE',
      expiry: parseInt(parts[4]) || 0,
      name: parts[5],
      value: parts[6],
    })
  }
  return cookies
}

/**
 * 解析浏览器扩展导出的 JSON 数组；不是 JSON 数组时返回 null。
 *
 * hostOnly=false 在 Netscape 里用域名前导点表示「包含子域」；缺少 expirationDate 的是会话 Cookie。
 */
export function parseJsonCookies(content: string): CookieItem[] | null {
  const trimmed = content.trim()
  if (!trimmed.startsWith('[')) return null
  let items: unknown
  try { items = JSON.parse(trimmed) } catch { return null }
  if (!Array.isArray(items)) return null
  const cookies: CookieItem[] = []
  for (const item of items) {
    if (!item || typeof item !== 'object') continue
    const raw = item as Record<string, unknown>
    const name = typeof raw.name === 'string' ? raw.name : ''
    const rawDomain = typeof raw.domain === 'string' ? raw.domain : ''
    const value = raw.value == null ? '' : String(raw.value)
    if (!name || !rawDomain || /[\t\r\n]/.test(name + value + rawDomain)) continue
    const hostOnly = raw.hostOnly === true
    const domain = !hostOnly && !rawDomain.startsWith('.') ? `.${rawDomain}` : rawDomain
    const expiry = Number(raw.expirationDate)
    cookies.push({
      domain,
      includeSubdomains: !hostOnly,
      path: typeof raw.path === 'string' && raw.path ? raw.path : '/',
      secure: raw.secure === true,
      expiry: Number.isFinite(expiry) && expiry > 0 ? Math.floor(expiry) : 0,
      name,
      value,
    })
  }
  return cookies
}

/** 把 Cookie 写成 yt-dlp `--cookies` 唯一接受的 Netscape 文本 */
export function toNetscapeCookies(cookies: CookieItem[]): string {
  const lines = cookies.map(c => [
    c.domain,
    c.includeSubdomains ? 'TRUE' : 'FALSE',
    c.path,
    c.secure ? 'TRUE' : 'FALSE',
    String(c.expiry),
    c.name,
    c.value,
  ].join('\t'))
  return ['# Netscape HTTP Cookie File', ...lines, ''].join('\n')
}

/**
 * 从 cookies 构建 Cookie 请求头。
 *
 * domains 用于过滤：浏览器导出的文件里混着大量无关域名的 Cookie，
 * 全带上既长又可能被平台判为异常请求。
 */
export function buildCookieHeader(cookies: CookieItem[], domains: string[]): string {
  return cookies
    .filter(c => domains.some(d => c.domain.includes(d)))
    .map(c => `${c.name}=${c.value}`)
    .join('; ')
}

/** 抖音相关的 Cookie 域名 */
export const DOUYIN_COOKIE_DOMAINS = ['douyin.com', 'iesdouyin.com', 'snssdk.com']

/** 短链跳转已能确定结论（失效 / 缺登录态），不应再交给后备解析器 */
export class DouyinLinkError extends Error {}

/** `/video/<id>` 或网页版弹层链接的 `?modal_id=<id>` */
export function douyinVideoId(url: string): string | null {
  const id = url.match(/\/video\/(\d+)/)?.[1]
  if (id) return id
  try {
    const modal = new URL(url).searchParams.get('modal_id')
    return modal && /^\d+$/.test(modal) ? modal : null
  } catch {
    return null
  }
}

/**
 * 从短链跳转结果取视频 ID。
 *
 * 抖音把失效短链与匿名请求都 302 到站点首页；交给 yt-dlp 只会得到 `Unsupported URL`，
 * 界面显示「不支持该网站」，用户会一直重试。带了 Cookie 仍落到首页才判为失效。
 * 跳到其他页面（如图文）返回 null，沿用原有的后备解析。
 */
export function douyinVideoIdFromRedirect(redirectedUrl: string, hasCookie: boolean): string | null {
  const id = douyinVideoId(redirectedUrl)
  if (id) return id
  let pathname = ''
  try { pathname = new URL(redirectedUrl).pathname } catch { return null }
  if (pathname !== '/' && pathname !== '') return null
  throw new DouyinLinkError(hasCookie
    ? '[[parse-error:not-found]]抖音短链已失效或视频不存在，请从 App 重新复制分享链接'
    : '[[parse-error:authentication]]抖音把该短链重定向到了站点首页：链接可能已失效，也可能需要登录 Cookie')
}

/**
 * 按分辨率与时长估算文件大小。
 *
 * 平台 API 往往不返回精确大小，只能估；用于界面上给用户一个量级参考，
 * 因此不需要很准。
 */
export function estimateFileSize(height: number, durationMs: number): number {
  const durationSec = durationMs / 1000
  let bitrate = 2000000
  if (height >= 1080) bitrate = 5000000
  else if (height >= 720) bitrate = 2500000
  else if (height >= 480) bitrate = 1500000
  else if (height >= 360) bitrate = 800000
  return Math.floor((bitrate * durationSec) / 8)
}
