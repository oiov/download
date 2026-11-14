/**
 * 界面语言代码的唯一来源。
 *
 * 单独成文件是为了让 `settings.ts` 这类纯逻辑模块能引用，而不必拉进带 runes 的
 * `i18n.svelte.ts`。Go 侧 `internal/settings` 的语言校验需与这里保持一致。
 */
export const LOCALES = ['zh-CN', 'en-US', 'es', 'pt-BR', 'de', 'fr', 'ja', 'ko', 'ru'] as const
export type Locale = (typeof LOCALES)[number]

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value)
}
