import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, fromBackend, normalizeSpeedLimit, toBackendPatch } from './settings'

const local = { theme: DEFAULT_SETTINGS.theme, radius: DEFAULT_SETTINGS.radius }

describe('下载限速', () => {
  it('默认不限速，读写都走 speedLimit 字段', () => {
    expect(DEFAULT_SETTINGS.speedLimit).toBe(0)
    expect(toBackendPatch({ speedLimit: 2048 })).toEqual({ speedLimit: 2048 })
    expect(fromBackend({ speedLimit: 2048 }, local).speedLimit).toBe(2048)
    expect(fromBackend({}, local).speedLimit).toBe(0)
  })

  it('非法值按不限速处理，与 Go 侧 Normalize 一致', () => {
    for (const bad of [-1, Number.NaN, '1024', null, 1024 * 1024 + 1]) {
      expect(normalizeSpeedLimit(bad)).toBe(0)
    }
    expect(normalizeSpeedLimit(1024 * 1024)).toBe(1024 * 1024)
    expect(normalizeSpeedLimit(512.7)).toBe(512)
  })
})
