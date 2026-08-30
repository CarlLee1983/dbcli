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
import { pinEnglishMessages } from '../../helpers/pin-english-messages'

pinEnglishMessages()

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
    // `_update_by_query` is its own segment, distinct from `_update`, so exact
    // segment matching drops it through to the destructive default. That is
    // stricter than before and correct: it rewrites every document in an index.
    name: 'update by query rewrites every document',
    req: { method: 'POST', path: '/orders/_update_by_query', body: { script: { source: '' } } },
    permitted: 'admin',
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
    ).rejects.toThrow(/not the request the server would receive/)
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

describe('every request that reaches the runner is recorded, executed or refused', () => {
  // The path wrote no audit entry at all, so an operator who was affected by
  // the bypass would have had nothing to find afterwards.
  //
  // The title is bounded on purpose. A block that fails `parseEsRequest` never
  // reaches this function and is not audited: it produced no method, no path
  // and no target, so there is no database operation to record — only
  // keystrokes. That boundary is stated rather than papered over.
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
    // 兩列：送出前的 attempt（尚未成功）與回應後的 outcome。
    expect(log).toEqual([
      { success: false, target: 'orders', tierOverride: undefined },
      { success: true, target: 'orders', tierOverride: undefined },
    ])
  })

  // An entry naming neither the operation nor the object is not a record. Every
  // `_`-leading path used to audit with no target at all.
  test('a request naming no index is recorded against its routed path', async () => {
    const log: Recorded[] = []
    await withAudit({ method: 'GET', path: '/_cat/indices' }, 'query-only', log)
    expect(log).toEqual([
      { success: false, target: '/_cat/indices', tierOverride: undefined },
      { success: true, target: '/_cat/indices', tierOverride: undefined },
    ])
  })

  test('a refused unscoped write is recorded against its routed path', async () => {
    const log: Recorded[] = []
    await expect(
      withAudit({ method: 'POST', path: '/_reindex' }, 'query-only', log)
    ).rejects.toThrow()
    expect(log).toEqual([{ success: false, target: '/_reindex', tierOverride: 'db-write' }])
  })

  test('an executed write is recorded and overrides the tier to db-write', async () => {
    const log: Recorded[] = []
    await withAudit({ method: 'DELETE', path: '/orders' }, 'admin', log)
    expect(log).toEqual([
      { success: false, target: 'orders', tierOverride: 'db-write' },
      { success: true, target: 'orders', tierOverride: 'db-write' },
    ])
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

describe('the two bypasses found in review stay closed', () => {
  // CRITICAL-1: the classifier read the raw path while the blacklist read the
  // routed one, so `filter_path` — a parameter every Elasticsearch endpoint
  // accepts, taking an arbitrary string — decided the tier. Verified executed
  // at query-only before the fix.
  const SMUGGLED: ReadonlyArray<[string, EsRequest]> = [
    [
      'delete by query disguised as a count',
      { method: 'POST', path: '/orders/_delete_by_query?filter_path=_count', body: { query: {} } },
    ],
    ['index deletion disguised as a bulk', { method: 'DELETE', path: '/orders?filter_path=_bulk' }],
    [
      'a mapping rewrite disguised as a bulk',
      { method: 'PUT', path: '/orders/_mapping?filter_path=_bulk', body: { properties: {} } },
    ],
    [
      'a dot segment spelling a read that routes to a delete',
      { method: 'POST', path: '/orders/_search/../_delete_by_query', body: { query: {} } },
    ],
  ]

  test.each(SMUGGLED)('%s is refused at query-only', async (_name, req) => {
    const target = captured()
    await expect(run(req, 'query-only', target)).rejects.toThrow()
    expect(target.calls).toBe(0)
  })

  // CRITICAL-2: a JSON string literal is a legal body that carries NDJSON, and
  // it was never walked by the body index scan, so a bulk delete reached a
  // blacklisted index from a path naming an innocuous one.
  test('a quoted string body is refused outright', async () => {
    const target = captured()
    await expect(
      runEsRequest(
        {
          method: 'POST',
          path: '/public/_bulk',
          body: '{"delete":{"_index":"secrets","_id":"1"}}\n',
        },
        fakeAdapter(target) as never,
        ['secrets'],
        {},
        { permission: 'admin' }
      )
    ).rejects.toThrow(/quoted string request body/)
    expect(target.calls).toBe(0)
  })

  test('a string body is refused even with no blacklist configured', async () => {
    const target = captured()
    await expect(
      run(
        { method: 'POST', path: '/public/_bulk', body: '{"index":{"_index":"a"}}\n' },
        'admin',
        target
      )
    ).rejects.toThrow(/quoted string request body/)
    expect(target.calls).toBe(0)
  })

  // `%2F` used to manufacture a segment the server never sees, because the
  // classifier decoded the path and the server does not. It no longer does:
  // the classifier reads what the URL parser produces, so this is one index
  // named `a%2F_search` and a `_delete_by_query` endpoint — which is what
  // Elasticsearch routes, and which needs admin.
  test('an encoded separator is one segment, not two, and is tiered accordingly', async () => {
    const refused = captured()
    await expect(
      run({ method: 'POST', path: '/a%2F_search/_delete_by_query' }, 'query-only', refused)
    ).rejects.toThrow()
    expect(refused.calls).toBe(0)

    const permitted = captured()
    await run({ method: 'POST', path: '/a%2F_search/_delete_by_query' }, 'admin', permitted)
    expect(permitted.calls).toBe(1)
  })

  // CRITICAL-3: `fetch` discards everything from the first `#`, so the shell
  // read a longer path than the server received. `POST /_reindex#/_count`
  // classified as a two-segment count and executed at query-only, which is an
  // arbitrary index-to-index copy and therefore also a blacklist bypass.
  test.each([
    ['/_reindex#/_count'],
    ['/_aliases#/_count'],
    ['/_sql#/_search'],
    ['/_bulk#/_count'],
    ['/_msearch#/_count'],
  ])('%s is refused: the server would not receive that path', async (path) => {
    const target = captured()
    await expect(run({ method: 'POST', path }, 'query-only', target)).rejects.toThrow(
      /not the request the server would receive/
    )
    expect(target.calls).toBe(0)
  })

  test.each([['/orders/_del\tete_by_query'], ['/a\\..\\_reindex']])(
    'a path the URL parser rewrites is refused: %s',
    async (path) => {
      const target = captured()
      await expect(run({ method: 'POST', path }, 'admin', target)).rejects.toThrow(
        /not the request the server would receive/
      )
      expect(target.calls).toBe(0)
    }
  )

  test('the refusal hands back the spelling the server would receive', async () => {
    const target = captured()
    await expect(run({ method: 'GET', path: '/idx/_doc/a b' }, 'admin', target)).rejects.toThrow(
      /Write it as '\/idx\/_doc\/a%20b'/
    )
    expect(target.calls).toBe(0)
  })

  // HIGH: Elasticsearch accepts `source=<json>` in place of a body, where every
  // body-side check is blind.
  test('a body smuggled through the query string is refused', async () => {
    const target = captured()
    await expect(
      run(
        {
          method: 'GET',
          path: '/public/_search?source=%7B%22sort%22%3A%5B%7B%22password%22%3A%22asc%22%7D%5D%7D&source_content_type=application/json',
        },
        'query-only',
        target
      )
    ).rejects.toThrow(/`source` in the query string/)
    expect(target.calls).toBe(0)
  })

  // The unencoded spelling never reaches the `source` check: a `"` is not
  // byte-identical to what the parser produces, so it is refused one step
  // earlier. Both spellings are refused; only the reason differs.
  test('an unencoded smuggled body is refused by byte-identity first', async () => {
    const target = captured()
    await expect(
      run(
        { method: 'GET', path: '/public/_search?source={"sort":[{"password":"asc"}]}' },
        'query-only',
        target
      )
    ).rejects.toThrow(/not the request the server would receive/)
    expect(target.calls).toBe(0)
  })

  // CRITICAL-4: `String.split('?')` splits at every `?` and the destructuring
  // took only the second element, so everything after a second `?` vanished
  // from the query these checks read while the adapter was handed the path
  // whole. Verified executed before the fix.
  test.each([
    ['/orders/_search?filter_path=x?&source=%7B%22a%22%3A1%7D'],
    ['/orders/_search?a=1?b=2&source=%7B%22a%22%3A1%7D'],
  ])('a second question mark cannot hide a smuggled body: %s', async (path) => {
    const target = captured()
    await expect(run({ method: 'GET', path }, 'query-only', target)).rejects.toThrow(
      /`source` in the query string/
    )
    expect(target.calls).toBe(0)
  })

  test.each([
    ['/orders/_search?filter_path=x?&q=password:secret'],
    ['/orders/_search?filter_path=x?&sort=password:asc'],
  ])('a second question mark cannot hide a protected field: %s', async (path) => {
    const target = captured()
    await expect(
      runEsRequest(
        { method: 'GET', path },
        fakeAdapter(target) as never,
        [],
        { orders: ['password'] },
        { permission: 'query-only' }
      )
    ).rejects.toThrow(/blacklist-protected/)
    expect(target.calls).toBe(0)
  })

  // A dotted subfield is a path into the same field. `password.keyword` is the
  // multi-field the standard dynamic mapping creates for every `text` field, so
  // exact matching let it through with no unusual configuration.
  test.each([
    ['/orders/_search?docvalue_fields=password.keyword'],
    ['/orders/_search?stored_fields=password.keyword'],
    ['/orders/_search?sort=password.keyword:asc'],
  ])('a subfield of a protected field is refused: %s', async (path) => {
    const target = captured()
    await expect(
      runEsRequest(
        { method: 'GET', path },
        fakeAdapter(target) as never,
        [],
        { orders: ['password'] },
        { permission: 'query-only' }
      )
    ).rejects.toThrow(/blacklist-protected/)
    expect(target.calls).toBe(0)
  })

  // A Painless script reads a field as `params._source.password`, putting the
  // protected name at the end of a dotted term where a prefix rule misses it.
  test.each([
    [
      'a script field reading _source',
      { script_fields: { leak: { script: 'params._source.password' } } },
    ],
    [
      'a runtime field under an innocuous name',
      { runtime_mappings: { x: { type: 'keyword', script: "emit(doc['password'].value)" } } },
    ],
  ])('%s is refused', async (_name, body) => {
    const target = captured()
    await expect(
      runEsRequest(
        { method: 'POST', path: '/orders/_search', body },
        fakeAdapter(target) as never,
        [],
        { orders: ['password'] },
        { permission: 'query-only' }
      )
    ).rejects.toThrow(/blacklist-protected/)
    expect(target.calls).toBe(0)
  })

  test('a subfield named in the body is refused too', async () => {
    const target = captured()
    await expect(
      runEsRequest(
        {
          method: 'POST',
          path: '/orders/_search',
          body: { aggs: { leak: { terms: { field: 'password.keyword' } } } },
        },
        fakeAdapter(target) as never,
        [],
        { orders: ['password'] },
        { permission: 'query-only' }
      )
    ).rejects.toThrow(/blacklist-protected/)
    expect(target.calls).toBe(0)
  })

  // An unrelated field that merely starts with the same letters is not a
  // subfield and must still be allowed.
  test('a distinct field sharing a prefix is not refused', async () => {
    const target = captured()
    await runEsRequest(
      { method: 'GET', path: '/orders/_search?docvalue_fields=password_hash' },
      fakeAdapter(target) as never,
      [],
      { orders: ['password'] },
      { permission: 'query-only' }
    )
    expect(target.calls).toBe(1)
  })

  // The parameter is matched as an exact key. `_source`, `_source_includes`
  // and `_source_excludes` are legitimate and a substring test would catch them
  // — this repo has shipped that bug before.
  test('_source and its relatives are not caught by the source refusal', async () => {
    const target = captured()
    await run(
      { method: 'GET', path: '/orders/_search?_source_includes=name' },
      'query-only',
      target
    )
    expect(target.calls).toBe(1)
  })

  // The URI-search form names fields in the query string, bypassing the body
  // check that exists to stop exactly this disclosure.
  test.each([
    ['/orders/_search?q=password:*'],
    ['/orders/_search?sort=password:asc'],
    ['/orders/_search?docvalue_fields=password'],
    ['/orders/_search?_source_includes=password'],
  ])('a protected field named in the query string is refused: %s', async (path) => {
    const target = captured()
    await expect(
      runEsRequest(
        { method: 'GET', path },
        fakeAdapter(target) as never,
        [],
        { orders: ['password'] },
        { permission: 'query-only' }
      )
    ).rejects.toThrow(/blacklist-protected/)
    expect(target.calls).toBe(0)
  })
})

describe('the classifier and the scoping allowlist agree about unscoped paths', () => {
  // A conjunctive pair: a request must satisfy the tier classifier AND, when a
  // blacklist is configured, `isUnscopedMetadataPath`. They answer different
  // questions, so listing a prefix in both is correct — but a path the
  // classifier admits while unscoped and the scoping list does not know about
  // would be permitted on a default config and refused on a configured one.
  const CLASSIFIER_ADMITTED_UNSCOPED = ['/_cat/indices', '/_cluster/health']

  test.each(CLASSIFIER_ADMITTED_UNSCOPED)(
    '%s is permitted with and without a blacklist configured',
    async (path) => {
      const bare = captured()
      await run({ method: 'GET', path }, 'query-only', bare)
      expect(bare.calls).toBe(1)

      const configured = captured()
      await run({ method: 'GET', path }, 'query-only', configured, ['secrets'])
      expect(configured.calls).toBe(1)
    }
  )

  // Removed from the scoping allowlist: pipeline definitions embed credentials
  // and detailed task listings carry running search bodies. Both also fail the
  // classifier, so this asserts the pair rather than either alone.
  test.each([['/_ingest/pipeline'], ['/_tasks']])('%s is refused', async (path) => {
    const target = captured()
    await expect(run({ method: 'GET', path }, 'query-only', target)).rejects.toThrow()
    expect(target.calls).toBe(0)
  })
})

/**
 * 第五輪：一列 audit 要說得出「對誰做了什麼」。
 *
 * 上一輪補上了「誰」——`_`-開頭的路徑不再以空 target 入帳。但「什麼」還是缺的：
 * `DELETE /orders`、`POST /orders/_update_by_query`、`PUT /orders/_mapping`、
 * `POST /orders/_close` 產生的是**完全相同**的一列，method 與 endpoint 都不在
 * 紀錄裡。SQL 那條線早就在傳 statement（`write-gate-guard` 傳 `sql`，`q` 傳
 * `prepared.driver.sql`），ES 這條沒有。
 *
 * 另一半是時序。audit 只在回應之後寫，所以 client 端逾時（`_delete_by_query`
 * 跑完而 dbcli 早已 abort）與執行中被 SIGTERM，都會讓一次真的發生過的破壞性
 * 操作留下錯的紀錄或不留紀錄。SQL shell 的 `recordGateDecision` 是**執行前**
 * 無條件寫的，理由就寫在那個函式的 docstring 裡。
 */
describe('audit 說得出操作，而且在送出之前就先記一筆', () => {
  interface Recorded {
    phase: 'attempt' | 'outcome'
    success: boolean
    target?: string
    statement?: string
  }

  function withAudit(
    req: EsRequest,
    permission: Permission,
    log: Recorded[],
    adapter?: unknown
  ): Promise<unknown> {
    return runEsRequest(
      req,
      (adapter ?? fakeAdapter(captured())) as never,
      [],
      {},
      {
        permission,
        audit: async (record) => {
          log.push({
            phase: record.phase,
            success: record.success,
            target: record.target,
            statement: record.statement,
          })
        },
      }
    )
  }

  test('四種破壞性操作不再產生同一列', async () => {
    const statements: (string | undefined)[] = []
    for (const req of [
      { method: 'DELETE', path: '/orders' },
      { method: 'POST', path: '/orders/_update_by_query' },
      { method: 'PUT', path: '/orders/_mapping' },
      { method: 'POST', path: '/orders/_close' },
    ] as EsRequest[]) {
      const log: Recorded[] = []
      await withAudit(req, 'admin', log)
      statements.push(log.at(-1)?.statement)
    }
    expect(new Set(statements).size).toBe(4)
    expect(statements).toContain('DELETE /orders')
    expect(statements).toContain('PUT /orders/_mapping')
  })

  /**
   * 第六輪 HIGH：`attempt` 列原本硬寫 `success: true`，於是「還沒送出」與
   * 「送出並成功」在紀錄裡長得一樣。任何以 `success` 統計成功寫入的讀者都會
   * 把每個操作算兩次，包含**被擋下來從未送出**的那些。
   *
   * `attempt` 列現在一律 `success: false`：那一刻這個操作尚未成功，而這是唯一
   * 安全的方向。真相由 `outcome` 那一列說，所以一個操作至多貢獻一次 success。
   */
  test('attempt 列不宣稱成功', async () => {
    const log: Recorded[] = []
    await withAudit({ method: 'DELETE', path: '/orders' }, 'admin', log)
    expect(log[0]).toMatchObject({ phase: 'attempt', success: false })
    expect(log[1]).toMatchObject({ phase: 'outcome', success: true })
    expect(log.filter((entry) => entry.success)).toHaveLength(1)
  })

  test('被 adapter 擋下、從未離開行程的請求不會留下一列成功', async () => {
    const log: Recorded[] = []
    const adapter = {
      request: async () => {
        throw new Error('ServerSideScriptRejection: script executes code on the cluster')
      },
    }
    await expect(
      withAudit({ method: 'POST', path: '/orders/_search' }, 'query-only', log, adapter)
    ).rejects.toThrow(/ServerSideScriptRejection/)
    expect(log.filter((entry) => entry.success)).toHaveLength(0)
  })

  test('送出之前先寫一筆 attempt，回應之後再寫 outcome', async () => {
    const log: Recorded[] = []
    await withAudit({ method: 'DELETE', path: '/orders' }, 'admin', log)
    expect(log.map((entry) => entry.phase)).toEqual(['attempt', 'outcome'])
    expect(log[0]).toMatchObject({
      phase: 'attempt',
      target: 'orders',
      statement: 'DELETE /orders',
    })
    expect(log[1]).toMatchObject({ phase: 'outcome', success: true })
  })

  test('attempt 那一筆在 adapter 被呼叫之前就寫完——逾時或被殺都還留得下它', async () => {
    const log: Recorded[] = []
    const seenAtRequestTime: string[] = []
    const adapter = {
      request: async () => {
        seenAtRequestTime.push(...log.map((entry) => entry.phase))
        return { ok: true }
      },
    }
    await withAudit({ method: 'DELETE', path: '/orders' }, 'admin', log, adapter)
    expect(seenAtRequestTime).toEqual(['attempt'])
  })

  test('請求丟出例外時，attempt 仍在，outcome 記為失敗', async () => {
    const log: Recorded[] = []
    const adapter = {
      request: async () => {
        throw new Error('ETIMEDOUT')
      },
    }
    await expect(
      withAudit({ method: 'DELETE', path: '/orders' }, 'admin', log, adapter)
    ).rejects.toThrow(/ETIMEDOUT/)
    expect(log.map((entry) => entry.phase)).toEqual(['attempt', 'outcome'])
    expect(log[1]?.success).toBe(false)
  })

  test('被權限擋下的請求不寫 attempt——它從來沒有被嘗試送出', async () => {
    const log: Recorded[] = []
    await expect(
      withAudit({ method: 'DELETE', path: '/orders' }, 'query-only', log)
    ).rejects.toThrow()
    expect(log.map((entry) => entry.phase)).toEqual(['outcome'])
    expect(log[0]).toMatchObject({ success: false, statement: 'DELETE /orders' })
  })

  // `..` 這種寫法在更前面就被 byte-identity 檢查拒了，走不到 audit——所以這裡
  // 用真的通得過的兩種形狀：query string 不屬於操作本身，而百分號編碼的路徑
  // 要以伺服器實際路由到的樣子入帳。
  test('statement 不含 query string', async () => {
    const log: Recorded[] = []
    await withAudit({ method: 'GET', path: '/orders/_search?size=5' }, 'query-only', log)
    expect(log.at(-1)?.statement).toBe('GET /orders/_search')
  })

  test('statement 用伺服器路由到的路徑，不是使用者打的編碼原文', async () => {
    const log: Recorded[] = []
    await withAudit({ method: 'GET', path: '/%5Fsearch' }, 'query-only', log)
    expect(log.at(-1)?.statement).toBe('GET /_search')
  })
})

/**
 * 第六輪 HIGH：audit 寫不出去時請求照送，而且這件事連表達都表達不了。
 *
 * `AuditLockManager` 的 lock budget 耗盡、目錄不可寫、磁碟滿——三者都讓
 * `writeAuditEntry` 靜靜回 null，`runEsRequest` 連看都不看，於是 `DELETE /orders`
 * 照送、零紀錄，只有一行 stderr 警告（一個 process 只印一次，管線模式通常
 * 被丟掉）。lock budget 那條尤其糟：它可以被刻意耗盡。
 *
 * `attempt` 那一列的整個理由建立在「它一定寫得出來」上，而它是 best-effort。
 * `config.audit.strict` 讓「稽核寫不出來就別動叢集」變成可以表達的取捨；
 * 預設關閉，因為這改的是既有行為。
 */
describe('audit.strict 讓稽核失敗擋下請求', () => {
  function withFailingAudit(
    req: EsRequest,
    permission: Permission,
    strict: boolean,
    target: Captured
  ): Promise<unknown> {
    return runEsRequest(
      req,
      fakeAdapter(target) as never,
      [],
      {},
      {
        permission,
        strictAudit: strict,
        // 寫失敗回報成 skipped，與 writeAuditEntryResult 的形狀一致。
        audit: async () => ({ skipped: 'lock-budget-exhausted' }) as const,
      }
    )
  }

  test('strict 開啟時，attempt 寫不出去就不送出請求', async () => {
    const captured = { calls: 0 } as Captured
    await expect(
      withFailingAudit({ method: 'DELETE', path: '/orders' }, 'admin', true, captured)
    ).rejects.toThrow(/audit/i)
    expect(captured.calls).toBe(0)
  })

  test('strict 關閉時維持現行行為——請求照送', async () => {
    const captured = { calls: 0 } as Captured
    await withFailingAudit({ method: 'DELETE', path: '/orders' }, 'admin', false, captured)
    expect(captured.calls).toBe(1)
  })

  test('audit 關閉（disabled）不算失敗，strict 開著也照送', async () => {
    const captured = { calls: 0 } as Captured
    await runEsRequest(
      { method: 'DELETE', path: '/orders' },
      fakeAdapter(captured) as never,
      [],
      {},
      {
        permission: 'admin',
        strictAudit: true,
        audit: async () => ({ skipped: 'disabled' }) as const,
      }
    )
    expect(captured.calls).toBe(1)
  })

  test('audit 寫成功時 strict 不影響任何事', async () => {
    const captured = { calls: 0 } as Captured
    await runEsRequest(
      { method: 'DELETE', path: '/orders' },
      fakeAdapter(captured) as never,
      [],
      {},
      {
        permission: 'admin',
        strictAudit: true,
        audit: async () => ({ success: true, rotated: false, id: 'x' }) as const,
      }
    )
    expect(captured.calls).toBe(1)
  })
})

/**
 * 第七輪 HIGH：strict 之下「沒有 sink」與「sink 回 null」都必須算失敗。
 *
 * `AuditSinkResult` 的型別接受 `void | string | null`，而 `writeAuditEntry`
 * （舊版、仍被十幾個檔案使用）失敗時正是回 `null`。先前這兩種都被當成成功，
 * 所以把 sink 接成舊版 helper、或根本不接，都會讓 fail-closed 靜默失效——
 * 型別本身在邀請這個錯誤。沒有稽核與稽核寫失敗，對 strict 是同一件事。
 */
describe('strict 之下沒有稽核就等於稽核失敗', () => {
  test('完全沒有 sink 時，strict 擋下請求', async () => {
    const captured = { calls: 0 } as Captured
    await expect(
      runEsRequest(
        { method: 'DELETE', path: '/orders' },
        fakeAdapter(captured) as never,
        [],
        {},
        {
          permission: 'admin',
          strictAudit: true,
        }
      )
    ).rejects.toThrow(/audit/i)
    expect(captured.calls).toBe(0)
  })

  test('sink 回 null（舊版 writeAuditEntry 的失敗形狀）時，strict 擋下請求', async () => {
    const captured = { calls: 0 } as Captured
    await expect(
      runEsRequest(
        { method: 'DELETE', path: '/orders' },
        fakeAdapter(captured) as never,
        [],
        {},
        {
          permission: 'admin',
          strictAudit: true,
          audit: async () => null,
        }
      )
    ).rejects.toThrow(/audit/i)
    expect(captured.calls).toBe(0)
  })

  test('沒開 strict 時，沒有 sink 仍然照常執行', async () => {
    const captured = { calls: 0 } as Captured
    await runEsRequest(
      { method: 'DELETE', path: '/orders' },
      fakeAdapter(captured) as never,
      [],
      {},
      {
        permission: 'admin',
      }
    )
    expect(captured.calls).toBe(1)
  })
})
