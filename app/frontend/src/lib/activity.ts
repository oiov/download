/**
 * 下载活动热力图（GitHub contribution 风格）。
 *
 * 优先使用后端持久化的**每日计数**（`ActivityDays`，不受历史 100 条上限影响）；
 * 没有后端时（浏览器预览）退回按历史聚合。都没有时整张图是空的——
 * 这是刻意的：显示假数据会让用户以为下载过 1109 个视频。
 */

export interface ActivityDay {
  date: Date
  count: number
}

export interface ActivityBuild {
  /** 按周分列，每列 7 天（周一 → 周日），首尾可能为 null */
  weeks: (ActivityDay | null)[][]
  /** 每个月第一次出现的周索引，用于月份标签定位 */
  months: { month: number; week: number }[]
  today: ActivityDay
  total: number
  streak: number
  last30: number
}

function startOfDay(date: Date): Date {
  const copy = new Date(date)
  copy.setHours(0, 0, 0, 0)
  return copy
}

/**
 * 按天聚合历史记录。
 *
 * @param history 真实下载历史（`HistoryItem[]`），`counts` 为空时使用
 * @param now     用于测试注入
 * @param counts  后端的每日计数（`YYYY-MM-DD` → 次数，本地日期）
 */
export function buildActivity(
  history: Array<{ createdAt: number }> = [],
  now = new Date(),
  counts: Record<string, number> | null = null,
): ActivityBuild {
  // 先按「本地日期」聚合成 { '2026-9-17': 3 } 这样的表（月份从 0 开始）
  const perDay = new Map<string, number>()
  if (counts) {
    for (const [date, count] of Object.entries(counts)) {
      const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
      if (!match || !Number.isFinite(count) || count <= 0) continue
      perDay.set(`${Number(match[1])}-${Number(match[2]) - 1}-${Number(match[3])}`, count)
    }
  } else {
    for (const item of history) {
      if (!Number.isFinite(item.createdAt)) continue
      const d = startOfDay(new Date(item.createdAt))
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
      perDay.set(key, (perDay.get(key) ?? 0) + 1)
    }
  }

  const today = startOfDay(now)
  const first = new Date(today)
  first.setDate(first.getDate() - 364)

  // 从 first 所在周的周一开始铺格子
  const mondayOffset = (first.getDay() + 6) % 7
  const gridStart = new Date(first)
  gridStart.setDate(gridStart.getDate() - mondayOffset)

  const weeks: (ActivityDay | null)[][] = []
  const days: ActivityDay[] = []
  let cursor = new Date(gridStart)

  while (cursor <= today) {
    const week: (ActivityDay | null)[] = []
    for (let row = 0; row < 7; row++) {
      const date = new Date(cursor)
      if (date < first || date > today) {
        week.push(null)
      } else {
        const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
        const count = perDay.get(key) ?? 0
        const day = { date, count }
        week.push(day)
        days.push(day)
      }
      cursor.setDate(cursor.getDate() + 1)
    }
    weeks.push(week)
  }

  const months: { month: number; week: number }[] = []
  let lastMonth = -1
  weeks.forEach((week, weekIndex) => {
    const firstDay = week.find((day): day is ActivityDay => day !== null)
    if (!firstDay) return
    const month = firstDay.date.getMonth()
    if (month !== lastMonth) {
      months.push({ month, week: weekIndex })
      lastMonth = month
    }
  })

  const total = days.reduce((sum, day) => sum + day.count, 0)
  const last30 = days.slice(-30).reduce((sum, day) => sum + day.count, 0)
  let streak = 0
  for (let i = days.length - 1; i >= 0; i--) {
    if (days[i].count > 0) streak += 1
    else break
  }

  return { weeks, months, today: days[days.length - 1], total, streak, last30 }
}
