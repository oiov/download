import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, it, expect, vi } from 'vitest'

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'downvid-manual-cookie-'))
vi.mock('electron', () => ({ app: { getPath: () => userData } }))

const { getCookieAttempts } = await import('../electron/utils/cookies')

/**
 * 手动指定的 Cookie 文件。
 *
 * yt-dlp 只认 Netscape：直接把扩展导出的 JSON 交给 `--cookies`，它不报错、一条 Cookie 都不带，
 * 退出时还会把空 Cookie 罐写回原文件。JSON 必须先转成独立的临时文件。
 */
describe('手动 Cookie 文件', () => {
  it('JSON 导出转成临时 Netscape 文件，原文件不交给 yt-dlp', () => {
    const source = path.join(userData, 'export.json')
    const raw = '[{"domain":".douyin.com","name":"ttwid","value":"abc","path":"/"}]'
    fs.writeFileSync(source, raw)
    const [attempt] = getCookieAttempts(source)
    const args = attempt.prepare()
    expect(args[0]).toBe('--cookies')
    expect(args[1]).not.toBe(source)
    expect(fs.readFileSync(args[1], 'utf-8')).toContain('.douyin.com\tTRUE\t/\tFALSE\t0\tttwid\tabc')
    attempt.cleanup()
    expect(fs.existsSync(args[1])).toBe(false)
    expect(fs.readFileSync(source, 'utf-8')).toBe(raw)
  })

  it('Netscape 文件原样使用，不额外生成临时文件', () => {
    const source = path.join(userData, 'cookies.txt')
    fs.writeFileSync(source, '# Netscape HTTP Cookie File\n.douyin.com\tTRUE\t/\tFALSE\t0\ta\tb\n')
    const [attempt] = getCookieAttempts(source)
    expect(attempt.prepare()).toEqual(['--cookies', source])
    attempt.cleanup()
  })
})
