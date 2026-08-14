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
  enforcePermission,
  enforcePermissionForType,
  permitsOperation,
} from '@/core/permission-guard'
import { enforceElasticsearchPermission } from '@/core/permission/elasticsearch'
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

describe('the same rule applies to statements nobody assembled', () => {
  // enforcePermission classifies free-form SQL — what `q` and `query` run — and
  // passed the caller's own level for as long as enforcePermissionForType did.
  function refusalForSql(sql: string, permission: Permission): PermissionError | undefined {
    try {
      enforcePermission(sql, permission)
      return undefined
    } catch (error) {
      return error as PermissionError
    }
  }

  test('an ordinary refusal names the tier that grants the type', () => {
    expect(refusalForSql('DELETE FROM users', 'query-only')?.requiredPermission).toBe('data-admin')
    expect(refusalForSql('INSERT INTO users VALUES (1)', 'query-only')?.requiredPermission).toBe(
      'read-write'
    )
  })

  test('a write hidden in a read names admin, whatever its leading keyword says', () => {
    // The type here classifies as SELECT, which query-only permits — so a
    // refusal derived from the type alone would have named query-only.
    const refusal = refusalForSql(
      'WITH x AS (DELETE FROM users RETURNING *) SELECT * FROM x',
      'data-admin'
    )

    expect(refusal?.requiredPermission).toBe('admin')
    expect(refusal?.message).toContain('admin')
  })

  test('a multi-statement refusal names admin', () => {
    expect(refusalForSql('SELECT 1; DELETE FROM users', 'data-admin')?.requiredPermission).toBe(
      'admin'
    )
  })

  test('an unrecognised statement names the level its own sentence promises', () => {
    // The message says read-write+ is required; the header above it has to
    // agree, or one of the two is telling the user to do something useless.
    const refusal = refusalForSql('VACUUM ANALYZE', 'query-only')

    expect(refusal?.requiredPermission).toBe('read-write')
    expect(refusal?.message).toContain('read-write')
  })
})

describe('elasticsearch refusals answer the same question', () => {
  const ES_CASES = [
    { request: { method: 'POST', apiPath: '/users/_doc' }, permission: 'query-only' as const },
    { request: { method: 'DELETE', apiPath: '/users/_doc/1' }, permission: 'read-write' as const },
    // A request the classifier cannot place lands on DROP, which no tier below
    // admin grants.
    {
      request: { method: 'PUT', apiPath: '/_cluster/settings' },
      permission: 'data-admin' as const,
    },
  ]

  test('each names a level that would actually permit the request', () => {
    for (const { request, permission } of ES_CASES) {
      let refusal: PermissionError | undefined
      try {
        enforceElasticsearchPermission(request, permission)
      } catch (error) {
        refusal = error as PermissionError
      }

      expect(refusal).toBeInstanceOf(PermissionError)
      // Granting exactly what the refusal named must let the same request through.
      expect(() =>
        enforceElasticsearchPermission(request, refusal!.requiredPermission)
      ).not.toThrow()
    }
  })

  test('the refusal names the level rather than "a higher tier"', () => {
    let message = ''
    try {
      enforceElasticsearchPermission({ method: 'DELETE', apiPath: '/users/_doc/1' }, 'read-write')
    } catch (error) {
      message = (error as PermissionError).message
    }

    expect(message).toContain('data-admin')
    expect(message).toContain('read-write')
  })
})
