/**
 * The Elasticsearch shell's messages were English string literals in the code
 * — every one of them, while the SQL shell one directory over went through the
 * catalogue. CONTRIBUTING.md is not ambiguous about this ("All user-facing
 * messages must be translatable"), so the gap was a violation and not a
 * preference.
 *
 * Parity is checked the way `permission-refusal-messages.test.ts` checks it:
 * a translation that was never written, or that lost a placeholder, passes
 * every English-locale test in the suite and surfaces only as an English
 * sentence in front of a Chinese-speaking operator.
 *
 * `BlacklistRejection: ` is deliberately absent from these keys. It is the
 * machine-readable prefix the recovery path and several tests match on, so it
 * is concatenated in code and stays the same in every language.
 */

import { describe, test, expect, afterAll } from 'bun:test'
import en from '../../../resources/lang/en/shell.json'
import zhTW from '../../../resources/lang/zh-TW/shell.json'
import enMessages from '../../../resources/lang/en/messages.json'
import zhTWMessages from '../../../resources/lang/zh-TW/messages.json'
import { MessageLoader } from '@/i18n/message-loader'

const ES_KEYS = Object.keys(en.es)

const placeholders = (value: string): string[] =>
  [...value.matchAll(/{(\w+)}/g)].map((m) => m[1] as string).sort()

describe('Elasticsearch shell message keys', () => {
  test('every English key has a Traditional Chinese counterpart', () => {
    expect(Object.keys(zhTW.es).sort()).toEqual(ES_KEYS.sort())
  })

  test('a translation never drops or invents a placeholder', () => {
    for (const key of ES_KEYS) {
      const english = (en.es as Record<string, string>)[key]!
      const translated = (zhTW.es as Record<string, string>)[key]!
      expect({ key, vars: placeholders(translated) }).toEqual({ key, vars: placeholders(english) })
    }
  })

  test('no translation is left as the English string', () => {
    for (const key of ES_KEYS) {
      expect((zhTW.es as Record<string, string>)[key]).not.toBe(
        (en.es as Record<string, string>)[key]
      )
    }
  })

  test('the blacklist wildcard refusal is translated too', () => {
    const english = (enMessages as { blacklist: Record<string, string> }).blacklist.refuse_wildcard!
    const translated = (zhTWMessages as { blacklist: Record<string, string> }).blacklist
      .refuse_wildcard!
    expect(placeholders(translated)).toEqual(placeholders(english))
    expect(translated).not.toBe(english)
  })
})

describe('Elasticsearch shell rendering in zh-TW', () => {
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

  test('the operator-written path is interpolated into the refusal, not appended', () => {
    const rendered = zhLoader().interpolate('shell.es.refuse_not_canonical', {
      path: '/orders/_search?x=1&x=2',
      canonical: '/orders/_search?x=1&x=2',
    })

    expect(rendered).toContain('/orders/_search?x=1&x=2')
    expect(rendered).not.toContain('{')
  })

  test('the field refusal names the field', () => {
    const rendered = zhLoader().interpolate('shell.es.blacklist_field', { field: 'password' })
    expect(rendered).toContain('password')
    expect(rendered).not.toContain('{')
  })
})
