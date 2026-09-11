/**
 * ATTACH / DETACH 是連線邊界，不是權限階梯（DBCLI-034）
 */

import { describe, test, expect } from 'bun:test'
import {
  checkPermission,
  enforcePermission,
  ConnectionBoundaryError,
  PermissionError,
} from '@/core/permission-guard'

describe('SQLite 跨資料庫語句', () => {
  const forms = [
    "ATTACH DATABASE '/etc/passwd' AS leak",
    "attach '/tmp/other.sqlite' as other",
    'DETACH DATABASE main',
    "  ATTACH '/tmp/other.sqlite' AS other",
    "-- harmless\nATTACH DATABASE '/tmp/other.sqlite' AS other",
  ]

  for (const sql of forms) {
    test(`admin 也拒絕：${sql.replace(/\n/g, ' ')}`, () => {
      const result = checkPermission(sql, 'admin', 'sqlite')
      expect(result.allowed).toBe(false)
      expect(result.boundary).toBe(true)
      expect(result.reason).toMatch(/ATTACH and DETACH are refused/)
      // 不得暗示提高權限就能通過。
      expect(result.requiredPermission).toBeUndefined()
    })
  }

  test('每個權限等級都拒絕', () => {
    for (const permission of ['query-only', 'read-write', 'data-admin', 'admin'] as const) {
      const result = checkPermission("ATTACH DATABASE '/tmp/x.sqlite' AS x", permission, 'sqlite')
      expect(result.allowed).toBe(false)
      expect(result.boundary).toBe(true)
    }
  })

  test('admin 可以堆疊語句，但尾端的 ATTACH 仍被抓到', () => {
    const result = checkPermission(
      "SELECT 1; ATTACH DATABASE '/tmp/x.sqlite' AS x",
      'admin',
      'sqlite'
    )
    expect(result.allowed).toBe(false)
    expect(result.boundary).toBe(true)
  })

  test('enforcePermission 丟出 ConnectionBoundaryError 而非 PermissionError', () => {
    let thrown: unknown
    try {
      enforcePermission("ATTACH DATABASE '/tmp/x.sqlite' AS x", 'admin', 'sqlite')
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(ConnectionBoundaryError)
    expect(thrown).not.toBeInstanceOf(PermissionError)
  })

  test('字串裡的 ATTACH 字樣不算', () => {
    const result = checkPermission("SELECT 'ATTACH DATABASE' AS note", 'query-only', 'sqlite')
    expect(result.allowed).toBe(true)
    expect(result.boundary).toBeUndefined()
  })

  test('欄位名叫 attach 不算', () => {
    const result = checkPermission('SELECT attach FROM notes', 'query-only', 'sqlite')
    expect(result.allowed).toBe(true)
  })

  test('其他引擎的判定不受影響', () => {
    for (const dialect of ['postgresql', 'mysql', 'mariadb'] as const) {
      const result = checkPermission("ATTACH DATABASE '/tmp/x.sqlite' AS x", 'admin', dialect)
      expect(result.boundary).toBeUndefined()
      expect(result.allowed).toBe(true)
    }
  })

  test('沒有方言時不套用——這條規則屬於 SQLite 連線', () => {
    const result = checkPermission("ATTACH DATABASE '/tmp/x.sqlite' AS x", 'admin')
    expect(result.boundary).toBeUndefined()
  })
})
