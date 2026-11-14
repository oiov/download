import { describe, expect, it } from 'vitest'
import { buildActivity } from './activity'

const now = new Date(2026, 10, 14, 12)

function countOn(build: ReturnType<typeof buildActivity>, y: number, m: number, d: number): number {
  for (const week of build.weeks) {
    for (const day of week) {
      if (day && day.date.getFullYear() === y && day.date.getMonth() === m && day.date.getDate() === d) {
        return day.count
      }
    }
  }
  return -1
}

describe('buildActivity', () => {
  it('有每日计数时以计数为准，不受历史 100 条上限影响', () => {
    const history = [{ createdAt: new Date(2026, 10, 14, 9).getTime() }]
    const build = buildActivity(history, now, { '2026-11-14': 150, '2026-11-01': 2 })
    expect(countOn(build, 2026, 10, 14)).toBe(150)
    expect(countOn(build, 2026, 10, 1)).toBe(2)
    expect(build.total).toBe(152)
  })

  it('没有计数时退回按历史聚合', () => {
    const history = [
      { createdAt: new Date(2026, 10, 14, 9).getTime() },
      { createdAt: new Date(2026, 10, 14, 10).getTime() },
    ]
    const build = buildActivity(history, now, null)
    expect(countOn(build, 2026, 10, 14)).toBe(2)
    expect(build.streak).toBe(1)
  })

  it('忽略格式不对或非正数的计数', () => {
    const build = buildActivity([], now, { '2026-11-14': -3, 'bad': 5, '2026-11-13': 1 })
    expect(build.total).toBe(1)
  })
})
