/**
 * 官网首屏表单以 GET 提交到在线工具（`/app/?url=…`），无需额外脚本。
 *
 * 只接受 http(s) 链接并限制长度；自动解析仅限同站来源，避免外站构造链接替访客消耗解析额度。
 */
export const PREFILL_PARAM = 'url'
const MAX_PREFILL_LENGTH = 2048

export interface WebPrefill {
  url: string
  autoParse: boolean
  /** 去掉预填参数后的地址，用于替换地址栏，链接不留在历史与统计里 */
  cleanUrl: string
}

export function readWebPrefill(href: string, referrer: string): WebPrefill | null {
  let page: URL
  try { page = new URL(href) } catch { return null }
  const raw = page.searchParams.get(PREFILL_PARAM)?.trim()
  if (!raw) return null
  page.searchParams.delete(PREFILL_PARAM)
  const cleanUrl = page.pathname + page.search + page.hash
  if (raw.length > MAX_PREFILL_LENGTH) return null
  try {
    if (!['http:', 'https:'].includes(new URL(raw).protocol)) return null
  } catch {
    return null
  }
  let sameSite = false
  try { sameSite = new URL(referrer).origin === page.origin } catch {}
  return { url: raw, autoParse: sameSite, cleanUrl }
}
