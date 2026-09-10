/**
 * blacklist 在 SQLite 上與其他 SQL 引擎走同一條規則（DBCLI-034 / AC-005）
 *
 * 這裡分兩段：table 名稱是不是被 SQLite 方言的掃描器找出來，以及找出來之後
 * 拒絕與遮蔽是不是照舊。第一段才是 SQLite 特有的——`[users]` 這種方括號識別字
 * 只有 SQLite 接受，掃描器漏掉它就等於漏掉一張該被擋下的表。
 */

import { describe, test, expect } from 'bun:test'
import { BlacklistManager } from '@/core/blacklist-manager'
import { BlacklistValidator } from '@/core/blacklist-validator'
import { BlacklistError } from '@/types/blacklist'
import { extractTableReferences } from '@/utils/sql-tables'
import type { DbcliConfig } from '@/types'

function makeValidator(blacklist: unknown): BlacklistValidator {
  const config = {
    connection: {
      system: 'sqlite',
      file: '/tmp/app.sqlite',
      host: '',
      port: 0,
      user: '',
      password: '',
      database: '',
    },
    permission: 'query-only',
    blacklist,
  } as unknown as DbcliConfig
  return new BlacklistValidator(new BlacklistManager(config))
}

describe('SQLite 方言的 table 掃描', () => {
  test('找出一般名稱', () => {
    expect(extractTableReferences('SELECT * FROM users', { dialect: 'sqlite' })).toContain('users')
  })

  test('找出雙引號識別字', () => {
    expect(extractTableReferences('SELECT * FROM "users"', { dialect: 'sqlite' })).toContain(
      'users'
    )
  })

  test('找出反引號識別字（SQLite 為相容而接受）', () => {
    expect(extractTableReferences('SELECT * FROM `users`', { dialect: 'sqlite' })).toContain(
      'users'
    )
  })

  test('找出方括號識別字——漏掉它就是漏掉一張該擋的表', () => {
    expect(extractTableReferences('SELECT * FROM [users]', { dialect: 'sqlite' })).toContain(
      'users'
    )
  })

  test('JOIN 的每一張表都被找出來', () => {
    const tables = extractTableReferences(
      'SELECT * FROM orders o JOIN [secrets] s ON s.id = o.secret_id',
      { dialect: 'sqlite' }
    )
    expect(tables).toContain('orders')
    expect(tables).toContain('secrets')
  })
})

describe('SQLite 連線上的 blacklist', () => {
  test('拒絕被列入黑名單的 table', () => {
    const validator = makeValidator({ tables: ['secrets'], columns: {} })
    expect(() => validator.checkTablesBlacklist('SELECT', ['secrets'])).toThrow(BlacklistError)
  })

  test('方括號寫法的黑名單表同樣擋得住', () => {
    const validator = makeValidator({ tables: ['secrets'], columns: {} })
    const tables = extractTableReferences('SELECT * FROM [secrets]', { dialect: 'sqlite' })
    expect(() => validator.checkTablesBlacklist('SELECT', tables)).toThrow(BlacklistError)
  })

  test('未列入黑名單的表照常通過', () => {
    const validator = makeValidator({ tables: ['secrets'], columns: {} })
    expect(() => validator.checkTablesBlacklist('SELECT', ['users'])).not.toThrow()
  })

  test('欄位規則從結果中遮蔽該欄', () => {
    const validator = makeValidator({ tables: [], columns: { users: ['email'] } })
    const rows = [{ id: 1, email: 'a@example.com', nickname: 'a' }]
    const filtered = validator.filterColumnsForTables(['users'], rows, ['id', 'email', 'nickname'])

    expect(filtered.filteredRows[0]).not.toHaveProperty('email')
    expect(filtered.filteredRows[0]).toHaveProperty('id')
    expect(filtered.filteredRows[0]).toHaveProperty('nickname')
    expect(filtered.omittedColumns).toContain('email')
  })
})
