/**
 * 逾時語意：連線逾時與語句逾時是兩件事（#42）
 */

import { test, expect, describe } from 'bun:test'
import {
  DEFAULT_CONNECT_TIMEOUT_MS,
  resolveTimeoutPolicy,
  statementTimeoutSql,
} from 'src/adapters/timeout-policy'

describe('resolveTimeoutPolicy', () => {
  test('沒有任何設定時只有連線逾時，語句不設上限', () => {
    expect(resolveTimeoutPolicy({})).toEqual({
      connectMs: DEFAULT_CONNECT_TIMEOUT_MS,
      statementMs: undefined,
    })
  })

  test('--timeout 同時收緊連線與語句', () => {
    expect(resolveTimeoutPolicy({ timeout: 3000 })).toEqual({
      connectMs: 3000,
      statementMs: 3000,
    })
  })

  test('語句逾時可單獨放寬而不影響連線失敗的偵測時間', () => {
    expect(resolveTimeoutPolicy({ timeout: 2000, statementTimeout: 120_000 })).toEqual({
      connectMs: 2000,
      statementMs: 120_000,
    })
  })

  test('只給語句逾時時連線逾時維持內建預設', () => {
    expect(resolveTimeoutPolicy({ statementTimeout: 60_000 })).toEqual({
      connectMs: DEFAULT_CONNECT_TIMEOUT_MS,
      statementMs: 60_000,
    })
  })

  test('語句逾時 0 表示明確取消上限', () => {
    expect(resolveTimeoutPolicy({ timeout: 3000, statementTimeout: 0 })).toEqual({
      connectMs: 3000,
      statementMs: 0,
    })
  })
})

describe('statementTimeoutSql', () => {
  test('MySQL 用毫秒的 max_execution_time', () => {
    expect(statementTimeoutSql('mysql', 3000)).toBe('SET SESSION max_execution_time = 3000')
  })

  test('MariaDB 用秒的 max_statement_time', () => {
    expect(statementTimeoutSql('mariadb', 3000)).toBe('SET SESSION max_statement_time = 3')
  })

  test('MariaDB 的秒數保留小數，不把 500ms 無聲進位成 0 或 1 秒', () => {
    expect(statementTimeoutSql('mariadb', 500)).toBe('SET SESSION max_statement_time = 0.5')
  })

  test('0 表示取消上限，兩個方言都送得出去', () => {
    expect(statementTimeoutSql('mysql', 0)).toBe('SET SESSION max_execution_time = 0')
    expect(statementTimeoutSql('mariadb', 0)).toBe('SET SESSION max_statement_time = 0')
  })
})
