/**
 * SQLite 專屬語句的分類與階梯（DBCLI-035）
 *
 * 這裡有兩件事要分清楚：一個語句被拒絕，和它「因為被宣告成危險而被拒絕」，
 * 在現況下會給出同樣的 allowed=false。VACUUM 今天就已經因為認不得而落到
 * UNKNOWN、只有 admin 能過——只斷言「低於 admin 被拒」的測試，在寫任何程式碼
 * 之前就會通過，什麼也沒證明。所以斷言下在宣告本身：isDangerous。
 */

import { describe, test, expect } from 'bun:test'
import { classifyStatement, checkPermission } from '@/core/permission-guard'
import type { Permission } from '@/types'

const TIERS: Permission[] = ['query-only', 'read-write', 'data-admin', 'admin']

function allowedAt(sql: string, dialect: 'sqlite' | 'mysql' | 'postgresql'): Permission[] {
  return TIERS.filter((p) => checkPermission(sql, p, dialect).allowed)
}

describe('REPLACE', () => {
  test('REPLACE INTO 在 SQLite 上有自己的型別，不再是 UNKNOWN', () => {
    const classification = classifyStatement('REPLACE INTO users VALUES (1)', 'sqlite')
    expect(classification.type).toBe('REPLACE')
  })

  test('REPLACE 會刪資料，所以與 DELETE 同階：data-admin 起跳', () => {
    expect(allowedAt('REPLACE INTO users VALUES (1)', 'sqlite')).toEqual(['data-admin', 'admin'])
  })

  test('INSERT OR REPLACE 維持既有判定（INSERT / read-write 起跳）', () => {
    expect(classifyStatement('INSERT OR REPLACE INTO users VALUES (1)', 'sqlite').type).toBe(
      'INSERT'
    )
    expect(allowedAt('INSERT OR REPLACE INTO users VALUES (1)', 'sqlite')).toEqual([
      'read-write',
      'data-admin',
      'admin',
    ])
  })

  test('SELECT REPLACE(...) 是讀取，不受影響', () => {
    expect(classifyStatement("SELECT REPLACE(name, 'a', 'b') FROM t", 'sqlite').type).toBe('SELECT')
    expect(allowedAt("SELECT REPLACE(name, 'a', 'b') FROM t", 'sqlite')).toEqual(TIERS)
  })

  // R5：型別對照若不限方言，MySQL 的 REPLACE INTO 會從 admin-only 降到
  // data-admin。那是 re-tier，必須被決定而不是順手發生。
  test('MySQL 與 PostgreSQL 的 REPLACE INTO 判定不變', () => {
    for (const dialect of ['mysql', 'postgresql'] as const) {
      expect(classifyStatement('REPLACE INTO users VALUES (1)', dialect).type).toBe('UNKNOWN')
      expect(allowedAt('REPLACE INTO users VALUES (1)', dialect)).toEqual(['admin'])
    }
  })

  test('沒有方言時也維持 UNKNOWN', () => {
    expect(classifyStatement('REPLACE INTO users VALUES (1)').type).toBe('UNKNOWN')
  })
})

describe('PRAGMA', () => {
  const forms = [
    'PRAGMA table_info(users)',
    'PRAGMA journal_mode=WAL',
    'pragma foreign_keys = on',
    'PRAGMA main.page_size',
  ]

  for (const sql of forms) {
    test(`${sql} 是 admin-only 且被宣告為危險`, () => {
      const classification = classifyStatement(sql, 'sqlite')
      expect(classification.type).toBe('UNKNOWN')
      // 宣告，而不是「認不得」——後者今天就給 isDangerous: false。
      expect(classification.isDangerous).toBe(true)
      expect(allowedAt(sql, 'sqlite')).toEqual(['admin'])
    })
  }

  test('讀與寫兩種形式不區分——區分需要讀參數，那正是不信任的分析', () => {
    const read = classifyStatement('PRAGMA table_info(users)', 'sqlite')
    const write = classifyStatement('PRAGMA journal_mode=WAL', 'sqlite')
    expect(read.type).toBe(write.type)
    expect(read.isDangerous).toBe(write.isDangerous)
  })
})

describe('VACUUM 與 REINDEX', () => {
  for (const sql of ['VACUUM', 'vacuum', 'REINDEX users', 'REINDEX']) {
    test(`${sql} 因為被宣告而 admin-only，不是因為認不得`, () => {
      const classification = classifyStatement(sql, 'sqlite')
      expect(classification.isDangerous).toBe(true)
      expect(allowedAt(sql, 'sqlite')).toEqual(['admin'])
    })
  }

  // VACUUM / REINDEX 在 PostgreSQL 也存在，今天同樣是 admin-only。宣告它們
  // 不得改變那個結果——只是讓結果有理由。
  test('PostgreSQL 的 VACUUM 判定不變', () => {
    expect(allowedAt('VACUUM', 'postgresql')).toEqual(['admin'])
  })
})

describe('SQLite 詞法形式', () => {
  test('帶註解、字串與各種識別字引號的語句仍以真正的首關鍵字分類', () => {
    const sql = [
      '-- 這行是註解',
      '/* 這段也是 */ REPLACE INTO [users] (`name`, "email")',
      "VALUES ('O''Brien', 'a@example.com')",
    ].join('\n')

    expect(classifyStatement(sql, 'sqlite').type).toBe('REPLACE')
  })

  test('字串裡的 REPLACE INTO 不算', () => {
    expect(classifyStatement("SELECT 'REPLACE INTO users' AS note", 'sqlite').type).toBe('SELECT')
  })

  test('字串裡的 PRAGMA 不算', () => {
    const result = checkPermission("SELECT 'PRAGMA journal_mode' AS note", 'query-only', 'sqlite')
    expect(result.allowed).toBe(true)
  })
})
