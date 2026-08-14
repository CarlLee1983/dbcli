/**
 * The three permission-guard refusals that used to be hardcoded English, plus
 * the "Permission denied: " prefix data-executor glues onto them, now go
 * through the message catalogue like every other refusal.
 *
 * Key and placeholder parity between the two `messages.json` files is checked
 * the way `ceremony-messages.test.ts` checks `ceremony.json`: a translation
 * that lost a placeholder, or was never written, would still pass every
 * English-locale test and only surface as an English sentence in front of a
 * Chinese-speaking user.
 */

import { describe, test, expect, afterAll } from 'bun:test'
import en from '../../../resources/lang/en/messages.json'
import zhTW from '../../../resources/lang/zh-TW/messages.json'
import { MessageLoader } from '@/i18n/message-loader'

const KEYS = [
  'errors.escalated_write_requires_admin',
  'errors.multiple_statements_refused',
  'errors.unknown_statement_query_only',
  'errors.permission_denied_reason',
  'errors.elasticsearch_requires_level',
] as const

const placeholders = (value: string): string[] =>
  [...value.matchAll(/{(\w+)}/g)].map((m) => m[1] as string).sort()

const getKey = (messages: Record<string, unknown>, key: string): string => {
  const value = key.split('.').reduce<unknown>((acc, part) => {
    if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[part]
    return undefined
  }, messages)
  if (typeof value !== 'string') throw new Error(`missing key: ${key}`)
  return value
}

describe('permission refusal keys', () => {
  test('every key exists in both English and Traditional Chinese', () => {
    for (const key of KEYS) {
      expect(() => getKey(en as Record<string, unknown>, key)).not.toThrow()
      expect(() => getKey(zhTW as Record<string, unknown>, key)).not.toThrow()
    }
  })

  test('a translation never drops or invents a placeholder', () => {
    for (const key of KEYS) {
      const english = getKey(en as Record<string, unknown>, key)
      const translated = getKey(zhTW as Record<string, unknown>, key)
      expect({ key, vars: placeholders(translated) }).toEqual({ key, vars: placeholders(english) })
    }
  })

  test('no translation is left as the English string', () => {
    for (const key of KEYS) {
      const english = getKey(en as Record<string, unknown>, key)
      const translated = getKey(zhTW as Record<string, unknown>, key)
      expect(translated).not.toBe(english)
    }
  })
})

describe('permission refusal rendering in zh-TW', () => {
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

  test('the escalated keyword and permission level are interpolated, not appended', () => {
    const rendered = zhLoader().interpolate('errors.escalated_write_requires_admin', {
      keyword: 'DELETE',
      permission: 'query-only',
    })

    expect(rendered).toContain('DELETE')
    expect(rendered).toContain('query-only')
    expect(rendered).not.toContain('{')
    expect(rendered).not.toBe('errors.escalated_write_requires_admin')
  })

  test('the multi-statement refusal is translated', () => {
    const rendered = zhLoader().t('errors.multiple_statements_refused')

    expect(rendered).not.toBe('errors.multiple_statements_refused')
    expect(rendered).not.toBe((en.errors as Record<string, string>).multiple_statements_refused)
  })

  test('the unknown-statement refusal is translated', () => {
    const rendered = zhLoader().t('errors.unknown_statement_query_only')

    expect(rendered).not.toBe('errors.unknown_statement_query_only')
    expect(rendered).not.toBe((en.errors as Record<string, string>).unknown_statement_query_only)
    expect(rendered).toContain('query-only')
  })

  test('the elasticsearch refusal names both levels in Chinese', () => {
    const rendered = zhLoader().interpolate('errors.elasticsearch_requires_level', {
      type: 'DELETE',
      minimum: 'data-admin',
      permission: 'read-write',
    })

    // The permission names stay Latin: they are the values a user writes into a
    // config file, so translating them would name a level nobody can set.
    expect(rendered).toContain('data-admin')
    expect(rendered).toContain('read-write')
    expect(rendered).not.toContain('{')
  })

  test('the permission-denied reason is interpolated, not prefixed in English', () => {
    const rendered = zhLoader().interpolate('errors.permission_denied_reason', {
      reason: 'DELETE 操作需要 data-admin 以上的權限（目前層級：query-only）',
    })

    expect(rendered).toContain('DELETE 操作需要 data-admin 以上的權限（目前層級：query-only）')
    expect(rendered).not.toBe(
      'Permission denied: DELETE 操作需要 data-admin 以上的權限（目前層級：query-only）'
    )
  })
})
