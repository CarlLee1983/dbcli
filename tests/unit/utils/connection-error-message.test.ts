/**
 * `ConnectionError` 是 adapter 層所有錯誤的載體，只有一部分 code 真的是連線問題。
 * 命令端用 `instanceof` 判斷，於是把九種 code 全數冠上「無法連接到資料庫」——
 * 語句逾時、找不到資料表、SQL 語法錯誤都被說成連不上資料庫（issue #61）。
 *
 * 這裡釘的是「哪一種 code 配哪一個 message key」。斷言比對 t_vars 的實際輸出而
 * 非英文字面，否則整組測試會在 DBCLI_LANG=zh-TW 下失效。
 */

import { describe, test, expect } from 'bun:test'
import { ConnectionError, type ConnectionErrorCode } from '@/adapters/types'
import { presentConnectionError, IS_TRANSPORT_FAILURE } from '@/utils/connection-error-message'
import { formatCliError } from '@/utils/cli-error'
import { t_vars } from '@/i18n/message-loader'

const TRANSPORT_CODES = [
  'ECONNREFUSED',
  'ETIMEDOUT',
  'AUTH_FAILED',
  'ENOTFOUND',
  'EHOSTUNREACH',
  'CONNECTION_LOST',
  'TOO_MANY_CONNECTIONS',
  'TLS_ERROR',
  'SERVER_NOT_READY',
  'CONNECTION_REJECTED',
] as const satisfies readonly ConnectionErrorCode[]

const STATEMENT_CODES = [
  'STATEMENT_TIMEOUT',
  'SQL_SYNTAX_ERROR',
  'TABLE_NOT_FOUND',
  'COLUMN_NOT_FOUND',
  'UNKNOWN',
] as const satisfies readonly ConnectionErrorCode[]

describe('presentConnectionError', () => {
  test('兩份清單合起來就是原始碼那張表的全部 key', () => {
    // 比對 IS_TRANSPORT_FAILURE 本身，而不是另一份手寫清單——後者等於自己跟自己
    // 比對，union 新增 code 時測試照樣綠。
    const covered = [...TRANSPORT_CODES, ...STATEMENT_CODES]
    expect([...covered].sort()).toEqual(
      (Object.keys(IS_TRANSPORT_FAILURE) as ConnectionErrorCode[]).sort()
    )
  })

  test('分類與原始碼一致：清單擺錯邊會紅', () => {
    for (const code of TRANSPORT_CODES) expect(IS_TRANSPORT_FAILURE[code]).toBe(true)
    for (const code of STATEMENT_CODES) expect(IS_TRANSPORT_FAILURE[code]).toBe(false)
  })

  test('真正的連線失敗維持連線措辭', () => {
    for (const code of TRANSPORT_CODES) {
      const message = `boom ${code}`
      const out = presentConnectionError(new ConnectionError(code, message, []))
      expect(out.message).toBe(t_vars('errors.connection_failed', { message }))
    }
  })

  test('語句層級的錯誤不套連線措辭', () => {
    for (const code of STATEMENT_CODES) {
      const message = `boom ${code}`
      const out = presentConnectionError(new ConnectionError(code, message, []))
      expect(out.message).toBe(t_vars('errors.message', { message }))
      expect(out.message).not.toBe(t_vars('errors.connection_failed', { message }))
    }
  })

  test('code 與 hints 一起帶出——那才是可行動的部分', () => {
    const out = presentConnectionError(
      new ConnectionError('STATEMENT_TIMEOUT', 'Statement timed out (800ms)', [
        'Inspect the query plan: dbcli explain "<sql>"',
      ])
    )

    expect(out.code).toBe('STATEMENT_TIMEOUT')
    expect(out.hints).toEqual(['Inspect the query plan: dbcli explain "<sql>"'])
  })

  test('排版沿用 formatCliError，與 query 的集中路徑同一種長相', () => {
    const rendered = formatCliError(
      presentConnectionError(new ConnectionError('TABLE_NOT_FOUND', 'no such table', ['do this']))
    )

    expect(rendered).toContain('Code: TABLE_NOT_FOUND')
    expect(rendered).toContain('Hint: do this')
  })
})
