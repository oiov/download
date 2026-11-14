import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { LOCALES, allMessages, matchLocale } from './i18n.svelte'
import { fromBackend } from './settings'

const placeholders = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort()

describe('界面词表', () => {
  const messages = allMessages()
  const base = messages['en-US']

  it.each(LOCALES)('%s 的 key 集合与英文一致', (locale) => {
    const keys = Object.keys(messages[locale])
    expect(keys.filter((key) => !(key in base))).toEqual([])
    expect(Object.keys(base).filter((key) => !(key in messages[locale]))).toEqual([])
  })

  it.each(LOCALES)('%s 的占位符与英文一致', (locale) => {
    const mismatched = Object.keys(base).filter(
      (key) => placeholders(base[key]).join() !== placeholders(messages[locale][key] ?? '').join(),
    )
    expect(mismatched).toEqual([])
  })

  it.each(LOCALES)('%s 没有空词条', (locale) => {
    expect(Object.entries(messages[locale]).filter(([, text]) => !text.trim())).toEqual([])
  })
})

describe('系统语言映射', () => {
  it.each([
    ['zh-TW', 'zh-CN'],
    ['en-GB', 'en-US'],
    ['pt-PT', 'pt-BR'],
    ['es-419', 'es'],
    ['ja-JP', 'ja'],
    ['ko_KR', 'ko'],
    ['RU', 'ru'],
    ['it-IT', 'en-US'],
  ])('%s → %s', (tag, expected) => {
    expect(matchLocale(tag)).toBe(expected)
  })
})

describe('语言设置', () => {
  const local = { theme: 'auto', radius: 'default' } as const

  it.each(LOCALES)('保留合法语言 %s', (locale) => {
    expect(fromBackend({ language: locale }, local).language).toBe(locale)
  })

  it('非法语言回退默认值', () => {
    expect(fromBackend({ language: 'zh' }, local).language).toBe('auto')
  })

  it('Go 侧语言白名单与前端一致', () => {
    const source = readFileSync(new URL('../../../internal/settings/settings.go', import.meta.url), 'utf8')
    const block = source.match(/var knownLanguages = map\[string\]bool\{([\s\S]*?)\n\}/)?.[1] ?? ''
    const goCodes = [...block.matchAll(/"([^"]+)": true/g)].map((match) => match[1]).sort()
    expect(goCodes).toEqual(['auto', ...LOCALES].sort())
  })
})
