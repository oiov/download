import { createHash } from 'node:crypto'
import { WebError } from '../../shared/web-errors'
import type { StateStore } from './state'
import { transaction } from './sqlite'
import type { Config } from './config'
import { PlatformStore } from './platform-store'

const HOUR = 3600000
const DAY = 24 * HOUR
const MAX_SESSIONS = 10000
type Action = 'parse' | 'download'

/** 滚动窗口而非自然日；返回可再次预留的时间，不对失败或取消退额。 */
export function quotaRetryAt(times: number[], windows: { duration: number; limit: number }[], now: number): number {
  return Math.max(now, ...windows.map(({ duration, limit }) => {
    const active = times.filter(at => at > now - duration).sort((a, b) => a - b)
    return active.length >= limit ? active[active.length - limit] + duration : now
  }))
}

/** 独立于遥测的业务额度；先落盘再执行，同一会话的重连、并发和重启共用预算。 */
export class SessionQuota {
  constructor(private config: Config, private state: StateStore) {
    this.cleanup()
  }
  consume(owner: string, action: Action, now = Date.now(), commit?: () => void) {
    const id = createHash('sha256').update(owner).digest('hex')
    const platform = new PlatformStore(this.state.db, this.config)
    const limits = platform.limits(owner)
    const windows = action === 'parse'
      ? [{ duration: HOUR, limit: this.config.parseHourlyLimit }, { duration: DAY, limit: limits.parses }]
      : [{ duration: DAY, limit: limits.downloads }]
    const db = this.state.db
    try {
      transaction(db, () => {
        if (platform.account(owner)?.disabled) throw new WebError('authentication', '账户已停用')
        const usage = platform.usage(owner)
        if (action === 'download' && usage.generatedBytes + usage.reservedBytes + this.config.maxFileBytes > limits.generatedBytes) throw new WebError('download-quota', '生成文件额度已用完', 86400)
        const times = db.prepare('SELECT at FROM quota WHERE owner_hash = ? AND action = ? AND at > ? ORDER BY at').all(id, action, now - DAY).map(row => Number(row.at))
        const retryAt = quotaRetryAt(times, windows, now)
        if (retryAt > now) throw new WebError(action === 'parse' ? 'parse-quota' : 'download-quota', '会话累计额度已用完，请等待额度恢复', Math.ceil((retryAt - now) / 1000))
        if (!db.prepare('SELECT 1 FROM quota WHERE owner_hash = ? LIMIT 1').get(id)) {
          this.cleanup(now)
          if (Number(db.prepare('SELECT COUNT(DISTINCT owner_hash) AS n FROM quota').get()!.n) >= MAX_SESSIONS) throw new WebError('busy', '服务繁忙，请稍后重试')
        }
        db.prepare('INSERT INTO quota VALUES (?, ?, ?)').run(id, action, now)
        commit?.()
      })
    } catch (error) {
      if (error instanceof WebError) throw error
      throw new WebError('storage', '无法保存会话额度，请稍后重试')
    }
  }
  cleanup(now = Date.now()) {
    this.state.db.prepare('DELETE FROM quota WHERE at <= ?').run(now - DAY)
  }
}
