import { describe, it, expect } from 'vitest'
import { DouyinLinkError, douyinVideoId, douyinVideoIdFromRedirect, estimateFileSize, parseCookiesFile, parseCookieText, toNetscapeCookies, buildCookieHeader, DOUYIN_COOKIE_DOMAINS, type CookieItem } from '../electron/parsers/shared'

/**
 * 平台解析器共用工具。
 *
 * estimateFileSize 的结果会显示为「预计大小」，是用户判断该选哪档清晰度的
 * 唯一参考；parseCookiesFile / buildCookieHeader 决定抖音接口能否带对登录态。
 * 两者此前在 douyin.ts 与 kuaishou.ts 里各有一份，抽出后行为必须完全保持。
 */
describe('estimateFileSize', () => {
  it('随分辨率提高而增大', () => {
    const duration = 60_000
    const sizes = [360, 480, 720, 1080].map(h => estimateFileSize(h, duration))
    for (let i = 1; i < sizes.length; i++) {
      expect(sizes[i]).toBeGreaterThan(sizes[i - 1])
    }
  })

  it('随视频时长线性增长', () => {
    const oneMin = estimateFileSize(720, 60_000)
    const twoMin = estimateFileSize(720, 120_000)
    expect(twoMin).toBe(oneMin * 2)
  })

  it('返回整数字节数', () => {
    const size = estimateFileSize(720, 12_345)
    expect(Number.isInteger(size)).toBe(true)
    expect(size).toBeGreaterThan(0)
  })

  it('时长为 0 时返回 0，不产生 NaN', () => {
    expect(estimateFileSize(1080, 0)).toBe(0)
  })

  it('未识别的分辨率落在默认档，仍给出正值', () => {
    // 低于 360 的高度会走默认 2Mbps
    expect(estimateFileSize(240, 10_000)).toBeGreaterThan(0)
  })
})

describe('parseCookiesFile', () => {
  it('解析 Netscape 格式的合法行', () => {
    const cookies = parseCookiesFile(writeTemp([
      '# Netscape HTTP Cookie File',
      '.douyin.com\tTRUE\t/\tTRUE\t0\tsessionid\tabc123',
    ].join('\n')))
    expect(cookies).toHaveLength(1)
    expect(cookies[0]).toMatchObject({
      domain: '.douyin.com',
      includeSubdomains: true,
      path: '/',
      secure: true,
      name: 'sessionid',
      value: 'abc123',
    })
  })

  it('跳过注释与空行', () => {
    const cookies = parseCookiesFile(writeTemp([
      '# 注释',
      '',
      '.douyin.com\tTRUE\t/\tFALSE\t0\ta\t1',
      '   ',
    ].join('\n')))
    expect(cookies).toHaveLength(1)
  })

  it('字段不足 7 个的行被忽略', () => {
    const cookies = parseCookiesFile(writeTemp('.douyin.com\tTRUE\t/\tFALSE\t0'))
    expect(cookies).toEqual([])
  })

  it('文件不存在时返回空数组而非抛错（调用方据此退化为无 Cookie 请求）', () => {
    expect(parseCookiesFile('/definitely/not/here/cookies.txt')).toEqual([])
  })

  it('保留 #HttpOnly_ 前缀的 Cookie（抖音 sessionid 就是 HttpOnly）', () => {
    const cookies = parseCookieText('#HttpOnly_.douyin.com\tTRUE\t/\tTRUE\t0\tsessionid\tabc\n# 普通注释\n')
    expect(cookies).toHaveLength(1)
    expect(cookies[0]).toMatchObject({ domain: '.douyin.com', name: 'sessionid', value: 'abc' })
  })

  it('解析浏览器扩展导出的 JSON 数组', () => {
    const cookies = parseCookiesFile(writeTemp(JSON.stringify([
      { domain: 'douyin.com', hostOnly: false, name: 'ttwid', path: '/', secure: true, expirationDate: 1793010826.5, value: '1%7Cabc' },
      { domain: 'www.douyin.com', hostOnly: true, name: 'sid', value: 'x' },
      { domain: '.douyin.com', name: 'bad', value: 'a\tb' },
    ])))
    expect(cookies).toEqual([
      { domain: '.douyin.com', includeSubdomains: true, path: '/', secure: true, expiry: 1793010826, name: 'ttwid', value: '1%7Cabc' },
      { domain: 'www.douyin.com', includeSubdomains: false, path: '/', secure: false, expiry: 0, name: 'sid', value: 'x' },
    ])
    expect(buildCookieHeader(cookies, DOUYIN_COOKIE_DOMAINS)).toBe('ttwid=1%7Cabc; sid=x')
  })

  it('JSON 转出的 Netscape 文本可被原样解析回来', () => {
    const cookies = parseCookieText('[{"domain":".douyin.com","name":"a","value":"1","secure":true}]')
    const text = toNetscapeCookies(cookies)
    expect(text.startsWith('# Netscape HTTP Cookie File\n')).toBe(true)
    expect(text).toContain('.douyin.com\tTRUE\t/\tTRUE\t0\ta\t1')
    expect(parseCookieText(text)).toEqual(cookies)
  })
})

describe('buildCookieHeader', () => {
  const cookies: CookieItem[] = [
    { domain: '.douyin.com', includeSubdomains: true, path: '/', secure: true, expiry: 0, name: 'sessionid', value: 'abc' },
    { domain: '.iesdouyin.com', includeSubdomains: true, path: '/', secure: true, expiry: 0, name: 'ttwid', value: 'def' },
    { domain: '.google.com', includeSubdomains: true, path: '/', secure: true, expiry: 0, name: 'NID', value: 'should-not-appear' },
  ]

  it('只保留指定域名的 Cookie', () => {
    const header = buildCookieHeader(cookies, DOUYIN_COOKIE_DOMAINS)
    expect(header).toContain('sessionid=abc')
    expect(header).toContain('ttwid=def')
    expect(header).not.toContain('NID')
    expect(header).not.toContain('should-not-appear')
  })

  it('按 `name=value; name=value` 拼接', () => {
    const header = buildCookieHeader(cookies.slice(0, 2), DOUYIN_COOKIE_DOMAINS)
    expect(header).toBe('sessionid=abc; ttwid=def')
  })

  it('域名不匹配时返回空串（而非 undefined）', () => {
    expect(buildCookieHeader([cookies[2]], DOUYIN_COOKIE_DOMAINS)).toBe('')
  })

  it('空数组返回空串', () => {
    expect(buildCookieHeader([], DOUYIN_COOKIE_DOMAINS)).toBe('')
  })
})

// 用系统临时目录写测试夹具；这里不引入 fs mock，直接落盘更接近真实行为
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

function writeTemp(content: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'downvid-cookies-'))
  const file = path.join(dir, 'cookies.txt')
  fs.writeFileSync(file, content)
  return file
}

describe('抖音短链跳转', () => {
  it('从视频页与网页版弹层链接取 ID', () => {
    expect(douyinVideoId('https://www.douyin.com/video/7300000000000000001?previous_page=app')).toBe('7300000000000000001')
    expect(douyinVideoId('https://www.douyin.com/?modal_id=7300000000000000002')).toBe('7300000000000000002')
    expect(douyinVideoIdFromRedirect('https://www.douyin.com/discover?modal_id=7300000000000000003', false)).toBe('7300000000000000003')
  })

  it('跳到首页时直接给出结论，不再落到 yt-dlp 的 Unsupported URL', () => {
    expect(() => douyinVideoIdFromRedirect('https://www.douyin.com/', true)).toThrow(DouyinLinkError)
    expect(() => douyinVideoIdFromRedirect('https://www.douyin.com/', true)).toThrow('[[parse-error:not-found]]')
    expect(() => douyinVideoIdFromRedirect('https://www.douyin.com/?recommend=1', false)).toThrow('[[parse-error:authentication]]')
  })

  it('跳到图文等其他页面时交回原有后备解析', () => {
    expect(douyinVideoIdFromRedirect('https://www.douyin.com/note/7300000000000000004', false)).toBeNull()
  })
})
