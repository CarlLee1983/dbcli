/**
 * A refusal names a level that would actually work.
 *
 * `PermissionError.requiredPermission` is what every command prints as
 * `required:` in the header above the reason. It used to be the level the
 * caller already had, so a query-only user was told INSERT was
 * `required: query-only` immediately above a sentence saying it requires
 * read-write — the same class of untrue advice this branch removed from the
 * reason itself.
 *
 * The assertion is deliberately self-checking rather than a table of expected
 * strings: whatever level the error names, granting exactly that level must
 * make the operation permitted. A table would have to be updated in lockstep
 * with TIER_GRANTS and could be updated wrongly.
 */

import { describe, test, expect } from 'bun:test'
import {
  PermissionError,
  enforcePermissionForType,
  permitsOperation,
} from '@/core/permission-guard'
import type { Permission } from '@/types'
import type { StatementType } from '@/types/permission'

const PERMISSIONS: Permission[] = ['query-only', 'read-write', 'data-admin', 'admin']
const TYPES: StatementType[] = ['INSERT', 'UPDATE', 'DELETE']

function refusalFor(type: StatementType, permission: Permission): PermissionError | undefined {
  try {
    enforcePermissionForType(type, permission)
    return undefined
  } catch (error) {
    return error as PermissionError
  }
}

describe('what a refusal says is required', () => {
  test('the named level is one that permits the operation', () => {
    for (const type of TYPES) {
      for (const permission of PERMISSIONS) {
        const refusal = refusalFor(type, permission)
        if (!refusal) continue

        expect(refusal).toBeInstanceOf(PermissionError)
        expect({ type, permission, works: permitsOperation(type, refusal.requiredPermission) }) //
          .toEqual({ type, permission, works: true })
      }
    }
  })

  test('the header and the reason agree with each other', () => {
    const refusal = refusalFor('INSERT', 'query-only')

    expect(refusal?.requiredPermission).toBe('read-write')
    // The reason is localised, so this asserts the level appears in it rather
    // than pinning a sentence.
    expect(refusal?.message).toContain('read-write')
    expect(refusal?.message).toContain('query-only')
  })

  test('delete names the tier that grants deletes, not the one above it', () => {
    expect(refusalFor('DELETE', 'query-only')?.requiredPermission).toBe('data-admin')
    expect(refusalFor('DELETE', 'read-write')?.requiredPermission).toBe('data-admin')
  })
})
