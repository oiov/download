import { describe, it, expect } from 'vitest'
import { readWebPrefill } from '../shared/web-prefill'

/**
 * 官网首屏「粘贴链接 → 下载」把链接带进在线工具。
 * 外站构造的链接只能预填，不能替访客自动发起解析；非 http(s) 一律拒绝。
 */
describe('在线工具预填链接', () => {
  const page = 'https://keep.video/zh/app/?url=https%3A%2F%2Fyoutu.be%2Fabc&utm_source=x#top'

  it('同站提交时预填并自动解析，地址栏去掉链接参数', () => {
    expect(readWebPrefill(page, 'https://keep.video/zh/')).toEqual({
      url: 'https://youtu.be/abc', autoParse: true, cleanUrl: '/zh/app/?utm_source=x#top',
    })
  })

  it('外站或无来源时只预填，不自动解析', () => {
    expect(readWebPrefill(page, 'https://evil.example/')?.autoParse).toBe(false)
    expect(readWebPrefill(page, '')?.autoParse).toBe(false)
  })

  it('拒绝非 http(s)、超长与空值', () => {
    expect(readWebPrefill('https://keep.video/app/?url=javascript%3Aalert(1)', 'https://keep.video/')).toBeNull()
    expect(readWebPrefill('https://keep.video/app/?url=' + encodeURIComponent('https://x.com/' + 'a'.repeat(3000)), 'https://keep.video/')).toBeNull()
    expect(readWebPrefill('https://keep.video/app/?url=', 'https://keep.video/')).toBeNull()
    expect(readWebPrefill('https://keep.video/app/', 'https://keep.video/')).toBeNull()
  })
})
