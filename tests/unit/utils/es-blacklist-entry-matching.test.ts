/**
 * 黑名單條目本身可以是萬用字元、逗號清單、帶空白——設定端與請求端要走同一套
 * 正規化。
 *
 * 第八輪 CRITICAL：`indexExpressionReaches` 把**請求端**的表達式完整展開
 * （逗號、萬用字元、date math、CCS、百分號編碼），卻把黑名單條目當成純字面
 * 字串比對。於是 `blacklist.tables: ["secrets*"]` 對 Elasticsearch 完全無效，
 * 而 `["*"]`——看起來最像「全面封鎖」的寫法——是零保護。
 *
 * 這與第七輪 `namesProtectedField` 是同一個形狀：一個比對函式的語意悄悄排除
 * 掉某種自然的設定寫法，而它沒被發現是因為每個測試都用最單純的那種寫法。
 *
 * 這裡的「自然」有具體來源：**同一個 `blacklist.tables` 陣列在 Redis 連線上
 * 就是以 glob 執行的**，而使用者文件明文教 `dbcli blacklist table add
 * 'secrets:*'`。依文件寫下的設定，在 Redis 擋、在 Elasticsearch 靜默放行。
 */

import { describe, test, expect } from 'bun:test'
import { indexExpressionReaches } from '@/utils/es-index-target'

describe('黑名單條目是萬用字元時', () => {
  test.each([
    ['secrets-2026', ['secrets*']],
    ['secrets', ['secrets*']],
    ['mysecret', ['*secret*']],
    ['secrets', ['sec?ets']],
    ['secrets', ['*']],
    ['secrets', ['_all']],
    ['orders', ['*']],
  ])('請求 %s 對上黑名單 %s 要被擋', (expression, blacklisted) => {
    expect(indexExpressionReaches(expression, blacklisted)).toBe(true)
  })

  test('萬用字元不會擴張到不該擋的名稱', () => {
    expect(indexExpressionReaches('public', ['secrets*'])).toBe(false)
    expect(indexExpressionReaches('orders', ['sec?ets'])).toBe(false)
  })
})

describe('黑名單條目的其他自然寫法', () => {
  test.each([
    ['secrets', ['secrets,orders']],
    ['orders', ['secrets,orders']],
    ['secrets', [' secrets']],
    ['secrets', ['secrets ']],
    ['secrets', ['SECRETS']],
  ])('請求 %s 對上黑名單 %s 要被擋', (expression, blacklisted) => {
    expect(indexExpressionReaches(expression, blacklisted)).toBe(true)
  })
})

describe('既有行為不變', () => {
  test('字面相等仍然成立', () => {
    expect(indexExpressionReaches('secrets', ['secrets'])).toBe(true)
    expect(indexExpressionReaches('public', ['secrets'])).toBe(false)
  })

  test('慣例名（data stream backing index、rollover）仍然成立', () => {
    expect(indexExpressionReaches('.ds-secrets-2026.08.30-000001', ['secrets'])).toBe(true)
    expect(indexExpressionReaches('secrets-000001', ['secrets'])).toBe(true)
  })

  test('請求端的萬用字元仍然成立', () => {
    expect(indexExpressionReaches('sec*', ['secrets'])).toBe(true)
    expect(indexExpressionReaches('*', ['secrets'])).toBe(true)
  })

  test('空黑名單不擋任何東西', () => {
    expect(indexExpressionReaches('secrets', [])).toBe(false)
  })
})
