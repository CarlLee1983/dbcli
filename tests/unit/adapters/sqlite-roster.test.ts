/**
 * SQLite 在各份名冊裡的位置（DBCLI-034 / AC-007）
 *
 * 這張 Story 最大的風險是「加了引擎但漏了一份名冊」。名冊有六份以上，彼此
 * 獨立宣告，漏掉任何一份都不會編譯失敗——`Record<SqlDatabaseSystem, X>` 那幾份
 * 會，逐字面量列舉的那幾份不會。
 */

import { describe, test, expect } from 'bun:test'
import { DATABASE_SYSTEMS } from '@/adapters/types'
import { ENGINE_CAPABILITIES, COMMAND_CAPABILITY_KEYS } from '@/adapters/capabilities'
import { SQL_DIALECTS } from '@/core/permission-guard'
import { AdapterFactory } from '@/adapters/factory'
import { SQLiteAdapter } from '@/adapters/sqlite-adapter'

/** DBCLI-034 認領的格子；其餘 engine-facing 的一律 unsupported。 */
const SUPPORTED_IN_THIS_STORY = new Set([
  'list',
  'schema',
  'schemaSingle',
  'query',
  'q',
  'queryOutput',
  'blacklist',
  'status',
  // DBCLI-035
  'insert',
  'update',
  'delete',
])

/**
 * 與引擎無關的能力保留其他引擎給的狀態。若在這裡寫 unsupported，ADR-0022 的
 * `engineIndependent`（每個引擎都是 not-applicable）就會停止成立——那是用一個
 * 假宣告改壞了目錄，不是誠實地少認領一格。
 */
const ENGINE_INDEPENDENT_KEYS = [
  'completion',
  'upgrade',
  'recover',
  'skill',
  'auditTail',
  'auditShow',
  'auditClear',
  'auditHealth',
  'capabilityDiscover',
  'capabilityCheck',
] as const

describe('SQLite 名冊', () => {
  test('在 DATABASE_SYSTEMS 裡', () => {
    expect(DATABASE_SYSTEMS).toContain('sqlite')
  })

  test('在權限分類器的方言名冊裡', () => {
    expect(SQL_DIALECTS).toContain('sqlite')
  })

  test('在能力矩陣裡，且鍵集合與其他引擎一致', () => {
    expect(ENGINE_CAPABILITIES.sqlite).toBeDefined()
    expect(Object.keys(ENGINE_CAPABILITIES.sqlite).sort()).toEqual(
      [...COMMAND_CAPABILITY_KEYS].sort()
    )
  })

  test('proxy 是 not-applicable 而非 unsupported——SQLite 沒有網路協定可代理', () => {
    expect(ENGINE_CAPABILITIES.sqlite.proxy.status).toBe('not-applicable')
    expect(ENGINE_CAPABILITIES.sqlite.proxyAnalyze.status).toBe('not-applicable')
  })

  test('password 是 not-applicable——沒有憑證可輪替', () => {
    expect(ENGINE_CAPABILITIES.sqlite.password.status).toBe('not-applicable')
  })

  test('這張 Story 認領的格子是 supported 或 limited', () => {
    for (const key of SUPPORTED_IN_THIS_STORY) {
      const status =
        ENGINE_CAPABILITIES.sqlite[key as keyof typeof ENGINE_CAPABILITIES.sqlite].status
      expect([key, status]).toEqual([key, expect.stringMatching(/^(supported|limited)$/) as never])
    }
  })

  test('queryLimitGuard 是 limited，且 note 說出唯讀開檔的限制', () => {
    const guard = ENGINE_CAPABILITIES.sqlite.queryLimitGuard
    expect(guard.status).toBe('limited')
    expect(guard.note).toMatch(/write-ahead log|read-only/i)
  })

  /**
   * 這條刻意用推導而非清單。手寫清單漏掉 `recovery` 一格，就讓
   * `recovery.codes` 從 engine-independent 掉成 unavailable——同一類錯誤在
   * 53 個鍵裡還有五格，全都是清單沒列到的。凡是其他引擎標 not-applicable 的，
   * SQLite 就必須一樣，否則那個能力會停止被推導為 engine-independent。
   */
  test('每個 engine-independent 的格子，SQLite 都與其他引擎一致', () => {
    for (const key of COMMAND_CAPABILITY_KEYS) {
      if (ENGINE_CAPABILITIES.postgresql[key].status !== 'not-applicable') continue
      expect([key, ENGINE_CAPABILITIES.sqlite[key].status]).toEqual([key, 'not-applicable'])
    }
  })

  test('未認領的 engine-facing 能力都是 unsupported', () => {
    const claimed = new Set<string>([
      ...SUPPORTED_IN_THIS_STORY,
      ...ENGINE_INDEPENDENT_KEYS,
      'queryLimitGuard',
      'proxy',
      'proxyAnalyze',
      'password',
    ])

    for (const key of COMMAND_CAPABILITY_KEYS) {
      if (claimed.has(key)) continue
      if (ENGINE_CAPABILITIES.postgresql[key].status === 'not-applicable') continue
      expect([key, ENGINE_CAPABILITIES.sqlite[key].status]).toEqual([key, 'unsupported'])
    }
  })
})

describe('AdapterFactory', () => {
  const options = {
    system: 'sqlite' as const,
    file: '/tmp/does-not-need-to-exist.sqlite',
    host: '',
    port: 0,
    user: '',
    password: '',
    database: '',
  }

  test('createSqlAdapter 產生 SQLiteAdapter', () => {
    expect(AdapterFactory.createSqlAdapter(options)).toBeInstanceOf(SQLiteAdapter)
  })

  test('createAdapterWithoutRules 產生 SQLiteAdapter', () => {
    expect(AdapterFactory.createAdapterWithoutRules(options)).toBeInstanceOf(SQLiteAdapter)
  })

  test('沒有 file 時建構就失敗', () => {
    expect(() =>
      AdapterFactory.createSqlAdapter({ ...options, file: undefined } as never)
    ).toThrow()
  })
})
