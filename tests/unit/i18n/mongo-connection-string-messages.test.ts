/**
 * `init --uri` 拆解連線字串所新增的使用者訊息走訊息目錄：
 * 兩種語言的鍵與佔位符一致，且中文版不是英文原樣。
 * 渲染結果由 tests/unit/commands/init-mongodb-fields.test.ts 經 init 驗證。
 */

import { describe, test, expect } from 'bun:test'
import en from '../../../resources/lang/en/messages.json'
import zhTW from '../../../resources/lang/zh-TW/messages.json'

const KEYS = [
  'mongo_uri_conflicts_fields',
  'mongo_uri_with_env_refs',
  'mongo_uri_fallback_warning',
  'mongo_uri_reason_multi_host',
  'mongo_uri_reason_secret_option',
  'mongo_uri_reason_duplicate_key',
  'mongo_uri_reason_non_scram',
  'mongo_string_invalid',
  'mongo_string_bad_host',
  'mongo_string_bad_credentials',
  'mongo_string_tls_conflict',
  'mongo_string_bad_tls',
  'mongo_string_empty_option',
] as const

const placeholders = (value: string): string[] =>
  [...value.matchAll(/{(\w+)}/g)].map((m) => m[1] as string).sort()

const initMessage = (messages: unknown, key: string): string => {
  const value = ((messages as { init: Record<string, unknown> }).init ?? {})[key]
  if (typeof value !== 'string') throw new Error(`missing key: init.${key}`)
  return value
}

describe('init --uri decomposition message keys', () => {
  test('every key exists in both English and Traditional Chinese', () => {
    for (const key of KEYS) {
      expect(() => initMessage(en, key)).not.toThrow()
      expect(() => initMessage(zhTW, key)).not.toThrow()
    }
  })

  test('a translation never drops or invents a placeholder', () => {
    for (const key of KEYS) {
      expect({ key, vars: placeholders(initMessage(zhTW, key)) }).toEqual({
        key,
        vars: placeholders(initMessage(en, key)),
      })
    }
  })

  test('no translation is left as the English string', () => {
    for (const key of KEYS) {
      expect(initMessage(zhTW, key)).not.toBe(initMessage(en, key))
    }
  })
})
