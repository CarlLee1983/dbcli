/**
 * The Elasticsearch shell enforces the configured permission tier.
 *
 * It did not. `dbcli shell` against an Elasticsearch connection forked away
 * before the gate that covers the SQL and Redis branches, so a `query-only`
 * credential could delete every document in an index, drop the index, or
 * rewrite its mapping — all of them refused when the same request goes through
 * `dbcli query`.
 *
 * These assertions run at the shell's request runner, which is the single
 * function every shell request passes through. That covers the Elasticsearch
 * request classifier transitively, on purpose: a misclassification only matters
 * here if the shell would act on it, and "the fake adapter received a request it
 * should not have" is the observable that says so.
 *
 * Each shape is pinned twice — refused at `query-only`, permitted at a tier that
 * allows it — because a test that only asserts refusal passes equally well
 * against a runner that refuses everything.
 */

import { describe, expect, test } from 'bun:test'
import { resolveEsShellPermission, runEsRequest, type EsRequest } from '@/commands/es-shell'
import type { Permission } from '@/types'

interface Captured {
  method?: string
  path?: string
  body?: unknown
  calls: number
}

function fakeAdapter(captured: Captured) {
  return {
    request: async (method: string, path: string, body?: unknown) => {
      captured.method = method
      captured.path = path
      captured.body = body
      captured.calls += 1
      return { ok: true }
    },
  }
}

const captured = (): Captured => ({ calls: 0 })

function run(
  req: EsRequest,
  permission: Permission,
  target: Captured,
  blacklistTables: string[] = []
): Promise<unknown> {
  return runEsRequest(req, fakeAdapter(target) as never, blacklistTables, {}, { permission })
}

/**
 * Shapes the shell can express that `dbcli query` cannot.
 *
 * `query` synthesises one request shape — a search against a named index — so
 * everything below has never been exercised against the classifier. A prior fix
 * was needed because alias, mapping and settings paths each matched their own
 * read rule; assuming the classifier's fail-closed default covers this surface
 * is how that would happen again.
 */
const DESTRUCTIVE_SHAPES: ReadonlyArray<{
  name: string
  req: EsRequest
  permitted: Permission
}> = [
  {
    name: 'delete by query empties an index',
    req: { method: 'POST', path: '/orders/_delete_by_query', body: { query: { match_all: {} } } },
    permitted: 'admin',
  },
  {
    name: 'index deletion drops the index',
    req: { method: 'DELETE', path: '/orders' },
    permitted: 'admin',
  },
  {
    name: 'wildcard deletion drops every matching index',
    req: { method: 'DELETE', path: '/logs-*' },
    permitted: 'admin',
  },
  {
    name: 'mapping write changes the schema',
    req: { method: 'PUT', path: '/orders/_mapping', body: { properties: {} } },
    permitted: 'admin',
  },
  {
    name: 'settings write changes index configuration',
    req: { method: 'PUT', path: '/orders/_settings', body: { number_of_replicas: 0 } },
    permitted: 'admin',
  },
  {
    name: 'alias mutation repoints an alias',
    req: { method: 'POST', path: '/orders/_aliases/live' },
    permitted: 'admin',
  },
  {
    name: 'update by query rewrites every document',
    req: { method: 'POST', path: '/orders/_update_by_query', body: { script: { source: '' } } },
    permitted: 'read-write',
  },
]

describe('the Elasticsearch shell refuses what the tier does not permit', () => {
  test.each(DESTRUCTIVE_SHAPES.map((shape) => [shape.name, shape] as const))(
    '%s is refused at query-only',
    async (_name, shape) => {
      const target = captured()
      await expect(run(shape.req, 'query-only', target)).rejects.toThrow()
      // The refusal has to happen before the request leaves: a permission error
      // raised after the adapter was called is a report, not a gate.
      expect(target.calls).toBe(0)
    }
  )

  test.each(DESTRUCTIVE_SHAPES.map((shape) => [shape.name, shape] as const))(
    '%s is permitted at the tier that allows it',
    async (_name, shape) => {
      const target = captured()
      await run(shape.req, shape.permitted, target)
      expect(target.calls).toBe(1)
    }
  )

  test('a document delete is the delete tier, not the drop tier', async () => {
    const target = captured()
    await expect(
      run({ method: 'DELETE', path: '/orders/_doc/1' }, 'query-only', target)
    ).rejects.toThrow()
    expect(target.calls).toBe(0)

    const permitted = captured()
    await run({ method: 'DELETE', path: '/orders/_doc/1' }, 'data-admin', permitted)
    expect(permitted.calls).toBe(1)
  })

  test('a refusal names the permission that would work', async () => {
    const target = captured()
    await expect(run({ method: 'DELETE', path: '/orders' }, 'query-only', target)).rejects.toThrow(
      /admin/
    )
  })
})

describe('the Elasticsearch shell still permits reads at query-only', () => {
  // The point of the shell is inspection. A fix that gates writes and takes
  // reads with them has broken the feature rather than secured it.
  const READS: ReadonlyArray<[string, EsRequest]> = [
    ['a scoped search', { method: 'GET', path: '/orders/_search' }],
    ['a search with a body', { method: 'POST', path: '/orders/_search', body: { query: {} } }],
    ['a document read', { method: 'GET', path: '/orders/_doc/1' }],
    ['a mapping read', { method: 'GET', path: '/orders/_mapping' }],
    ['a settings read', { method: 'GET', path: '/orders/_settings' }],
    ['index metadata', { method: 'GET', path: '/orders' }],
    ['a document count', { method: 'GET', path: '/orders/_count' }],
    // The shell's own banner tells a new user to try this one.
    ['the cat indices listing', { method: 'GET', path: '/_cat/indices' }],
    ['cluster health', { method: 'GET', path: '/_cluster/health' }],
    ['an existence check', { method: 'HEAD', path: '/orders' }],
  ]

  test.each(READS)('%s is permitted at query-only', async (_name, req) => {
    const target = captured()
    await run(req, 'query-only', target)
    expect(target.calls).toBe(1)
  })
})

describe('the blacklist checks are scoped to a configured blacklist, and the tier gate is not', () => {
  // An earlier draft of this fix made these refusals unconditional. That was
  // wrong: every one of them answers a question *about the blacklist* — a path
  // that cannot be attributed to an index cannot be checked against one — so
  // with nothing configured they refuse ordinary queries and protect nothing.
  // The danger that made them look unconditional, `DELETE /_all` under
  // `query-only`, is refused by the tier gate instead, which is the assertion
  // at the bottom of this block.
  test('an unscoped document path is permitted when no blacklist is configured', async () => {
    const target = captured()
    await run({ method: 'GET', path: '/_search' }, 'query-only', target)
    expect(target.calls).toBe(1)
  })

  test('an unscoped document path is refused when a blacklist is configured', async () => {
    const target = captured()
    await expect(
      run({ method: 'GET', path: '/_search' }, 'query-only', target, ['secrets'])
    ).rejects.toThrow(/names no index/)
    expect(target.calls).toBe(0)
  })

  test('a path that does not route where it spells is refused when a blacklist is configured', async () => {
    const target = captured()
    await expect(
      run({ method: 'GET', path: '/_cat/../orders/_search' }, 'query-only', target, ['secrets'])
    ).rejects.toThrow(/routes to/)
    expect(target.calls).toBe(0)
  })

  test('blacklist refusals are unchanged when a blacklist is configured', async () => {
    const target = captured()
    await expect(
      run({ method: 'GET', path: '/secrets/_search' }, 'admin', target, ['secrets'])
    ).rejects.toThrow(/blacklist/)
    expect(target.calls).toBe(0)
  })

  // The reason the block above can stay conditional.
  test('deletion across all indices is refused at query-only with no blacklist configured', async () => {
    const target = captured()
    await expect(run({ method: 'DELETE', path: '/_all' }, 'query-only', target)).rejects.toThrow()
    expect(target.calls).toBe(0)
  })
})

describe('permission is checked before the blacklist decides nothing is wrong', () => {
  test('a destructive request to a non-blacklisted index is still refused', async () => {
    const target = captured()
    await expect(
      run({ method: 'DELETE', path: '/orders' }, 'query-only', target, ['secrets'])
    ).rejects.toThrow()
    expect(target.calls).toBe(0)
  })
})

describe('the session runs under the configured tier', () => {
  test('the configured permission is the one used', () => {
    expect(resolveEsShellPermission({ permission: 'admin' })).toBe('admin')
    expect(resolveEsShellPermission({ permission: 'read-write' })).toBe('read-write')
  })

  // A connection that never said what it may do has not said it may write.
  test('an absent permission resolves to the most restrictive tier', () => {
    expect(resolveEsShellPermission({})).toBe('query-only')
    expect(resolveEsShellPermission({ permission: undefined })).toBe('query-only')
  })
})

describe('every request is recorded, executed or refused', () => {
  // The path wrote no audit entry at all, so an operator who was affected by
  // the bypass would have had nothing to find afterwards.
  interface Recorded {
    success: boolean
    target?: string
    tierOverride?: 'db-write'
  }

  function withAudit(req: EsRequest, permission: Permission, log: Recorded[]): Promise<unknown> {
    return runEsRequest(
      req,
      fakeAdapter(captured()) as never,
      [],
      {},
      {
        permission,
        audit: async (record) => {
          log.push({
            success: record.success,
            target: record.target,
            tierOverride: record.tierOverride,
          })
        },
      }
    )
  }

  test('an executed read is recorded without a write tier override', async () => {
    const log: Recorded[] = []
    await withAudit({ method: 'GET', path: '/orders/_search' }, 'query-only', log)
    expect(log).toEqual([{ success: true, target: 'orders', tierOverride: undefined }])
  })

  test('an executed write is recorded and overrides the tier to db-write', async () => {
    const log: Recorded[] = []
    await withAudit({ method: 'DELETE', path: '/orders' }, 'admin', log)
    expect(log).toEqual([{ success: true, target: 'orders', tierOverride: 'db-write' }])
  })

  // A refused write is still a db-write attempt: the field states what the
  // request would do, and `success` says what became of it.
  test('a refused write is recorded as a failure, still tiered as a write', async () => {
    const log: Recorded[] = []
    await expect(
      withAudit({ method: 'DELETE', path: '/orders' }, 'query-only', log)
    ).rejects.toThrow()
    expect(log).toEqual([{ success: false, target: 'orders', tierOverride: 'db-write' }])
  })

  test('a blacklist refusal is recorded too', async () => {
    const log: Recorded[] = []
    await expect(
      runEsRequest(
        { method: 'GET', path: '/secrets/_search' },
        fakeAdapter(captured()) as never,
        ['secrets'],
        {},
        {
          permission: 'admin',
          audit: async (record) => {
            log.push({ success: record.success, target: record.target })
          },
        }
      )
    ).rejects.toThrow(/blacklist/)
    expect(log).toEqual([{ success: false, target: 'secrets' }])
  })
})
