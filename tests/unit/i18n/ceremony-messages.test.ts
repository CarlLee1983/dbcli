/**
 * The ceremony strings, in both languages.
 *
 * The rest of the mutation tests run in the default language, so a zh-TW file
 * that was missing a key or had lost a placeholder would pass every one of them
 * and only show up as an English sentence — or a bare key — in front of a
 * Chinese-speaking user. Key parity and placeholder parity are checked here
 * mechanically, so adding an English string without its translation fails.
 */

import { describe, test, expect, afterAll } from 'bun:test'
import en from '../../../resources/lang/en/ceremony.json'
import zhTW from '../../../resources/lang/zh-TW/ceremony.json'
import { MessageLoader } from '@/i18n/message-loader'

const placeholders = (value: string): string[] =>
  [...value.matchAll(/{(\w+)}/g)].map((m) => m[1] as string).sort()

describe('ceremony resources', () => {
  test('every English key exists in Traditional Chinese and vice versa', () => {
    expect(Object.keys(zhTW).sort()).toEqual(Object.keys(en).sort())
  })

  test('a translation never drops or invents a placeholder', () => {
    for (const [key, english] of Object.entries(en as Record<string, string>)) {
      const translated = (zhTW as Record<string, string>)[key] as string
      expect({ key, vars: placeholders(translated) }).toEqual({
        key,
        vars: placeholders(english),
      })
    }
  })

  test('no translation is left as the English string', () => {
    for (const [key, english] of Object.entries(en as Record<string, string>)) {
      expect((zhTW as Record<string, string>)[key]).not.toBe(english)
    }
  })
})

describe('ceremony rendering in zh-TW', () => {
  // The loader reads DBCLI_LANG once, in its constructor, so a language switch
  // means a new instance. The original is put back afterwards: every other test
  // file in this process shares the singleton.
  const original = MessageLoader.getInstance()
  const previousLang = Bun.env.DBCLI_LANG

  function zhLoader(): MessageLoader {
    Bun.env.DBCLI_LANG = 'zh-TW'
    ;(MessageLoader as unknown as { instance: MessageLoader | null }).instance = null
    return MessageLoader.getInstance()
  }

  afterAll(() => {
    if (previousLang === undefined) delete Bun.env.DBCLI_LANG
    else Bun.env.DBCLI_LANG = previousLang
    ;(MessageLoader as unknown as { instance: MessageLoader | null }).instance = original
  })

  test('the row count and table reach the translated sentence', () => {
    const rendered = zhLoader().interpolate('ceremony.updated', { count: 3, table: 'users' })

    expect(rendered).toContain('3')
    expect(rendered).toContain('users')
    expect(rendered).not.toContain('{')
  })

  test('a failure reason is interpolated, not appended', () => {
    const rendered = zhLoader().interpolate('ceremony.failed', { reason: 'deadlock detected' })

    expect(rendered).toContain('deadlock detected')
    expect(rendered).not.toContain('{reason}')
    expect(rendered).not.toBe('ceremony.failed')
  })

  test('the confirmation block is translated too', () => {
    const loader = zhLoader()

    // A key that resolved to the key name would mean the block is unreachable
    // in Chinese, which is how an untranslated string usually shows up.
    for (const key of ['ceremony.confirm_sql', 'ceremony.confirm_params']) {
      expect(loader.t(key)).not.toBe(key)
      expect(loader.t(key)).not.toBe((en as Record<string, string>)[key.split('.')[1] as string])
    }
  })
})
