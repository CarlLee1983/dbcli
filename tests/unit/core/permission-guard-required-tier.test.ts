/**
 * DBCLI-037: a refusal names a tier that works.
 *
 * `permission-refusal-level.test.ts` pins this for `enforcePermissionForType`,
 * the path that already passed `minimumPermissionFor(type)`. This file pins the
 * other path — `checkPermission`, which classifies a statement a user typed.
 * There an unrecognised statement under `query-only` named `read-write`, which
 * refuses it again; every other tier already named `admin`.
 *
 * The tier assertions are self-checking rather than a table of strings: what
 * makes the message true is that granting exactly the tier it names permits the
 * statement, and a table would have to be kept in step with TIER_GRANTS by hand.
 */

import { describe, test, expect } from 'bun:test'
import {
  checkPermission,
  checkPermissionForClassification,
  classificationForType,
  permitsOperation,
  type StatementType,
} from '@/core/permission-guard'
import type { Permission } from '@/types'

const PERMISSIONS: Permission[] = ['query-only', 'read-write', 'data-admin', 'admin']

const TYPES: StatementType[] = [
  'SELECT',
  'INSERT',
  'UPDATE',
  'DELETE',
  'REPLACE',
  'ALTER',
  'DROP',
  'CREATE',
  'TRUNCATE',
  'SHOW',
  'DESCRIBE',
  'EXPLAIN',
  'UNKNOWN',
]

describe('DBCLI-037 refusal names a tier that grants the statement', () => {
  test('AC-001: REPLACE INTO under query-only names admin', () => {
    const result = checkPermission('REPLACE INTO users VALUES (1)', 'query-only')
    expect(result.allowed).toBe(false)
    expect(result.requiredPermission).toBe('admin')
  })

  test('AC-002: INSERT under query-only still names read-write', () => {
    const result = checkPermission('INSERT INTO users (id) VALUES (1)', 'query-only')
    expect(result.allowed).toBe(false)
    expect(result.requiredPermission).toBe('read-write')
  })

  test('AC-003/AC-005: the named tier permits the statement, for every type and tier', () => {
    for (const type of TYPES) {
      for (const permission of PERMISSIONS) {
        const result = checkPermissionForClassification(classificationForType(type), permission)
        if (result.allowed) continue
        const named = result.requiredPermission
        expect(named).toBeDefined()
        // AC-005 from the other side: obtaining the named tier and retrying works.
        expect(permitsOperation(type, named!)).toBe(true)
      }
    }
  })

  test('AC-004: a type no tier grants names admin', () => {
    for (const permission of PERMISSIONS) {
      const result = checkPermissionForClassification(classificationForType('UNKNOWN'), permission)
      if (result.allowed) {
        expect(permission).toBe('admin')
        continue
      }
      expect(result.requiredPermission).toBe('admin')
    }
  })

  test('the unrecognised-statement message does not promise a tier that refuses it', () => {
    const result = checkPermission('PRAGMA journal_mode', 'query-only')
    expect(result.allowed).toBe(false)
    expect(result.requiredPermission).toBe('admin')
    expect(result.reason).not.toContain('read-write')
  })
})
