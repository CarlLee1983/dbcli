import { test, expect } from 'bun:test'
import { runEsRequest, type EsRequest } from '@/commands/es-shell'

/**
 * These tests are about the blacklist and the search size cap, so they run at
 * `admin` — the tier gate is exercised in `es-shell-permission.test.ts`, and
 * leaving it to refuse things here would mean every assertion below passed for
 * the wrong reason.
 */
const run = (
  req: EsRequest,
  adapter: unknown,
  blacklistTables: string[],
  blacklistColumns: Record<string, string[]> = {}
): Promise<unknown> =>
  runEsRequest(req, adapter as never, blacklistTables, blacklistColumns, { permission: 'admin' })

function fakeAdapter(captured: { method?: string; path?: string; body?: unknown }) {
  return {
    request: async (method: string, path: string, body?: unknown) => {
      captured.method = method
      captured.path = path
      captured.body = body
      return { ok: true }
    },
  }
}

test('blocks blacklisted index', async () => {
  const captured: Record<string, unknown> = {}
  await expect(
    run({ method: 'GET', path: '/secrets/_search' }, fakeAdapter(captured) as never, ['secrets'])
  ).rejects.toThrow('blacklist')
  expect(captured.path).toBeUndefined()
})

test('injects size cap into a _search body lacking size', async () => {
  const captured: Record<string, unknown> = {}
  await run(
    { method: 'POST', path: '/users/_search', body: { query: { match_all: {} } } },
    fakeAdapter(captured) as never,
    []
  )
  expect((captured.body as { size?: number }).size).toBe(1000)
})

test('passes non-search requests through unchanged', async () => {
  const captured: Record<string, unknown> = {}
  const res = await run(
    { method: 'GET', path: '/_cat/indices' },
    fakeAdapter(captured) as never,
    []
  )
  expect(res).toEqual({ ok: true })
  expect(captured.body).toBeUndefined()
})

/**
 * `extractIndexFromPath` returns undefined for any `_`-leading segment, and the
 * guard only ran when it returned a name. `GET /_all/_search`, `/_search`,
 * `/_msearch`, `/_mget` and `/_sql` all read documents from every index, so a
 * request that cannot be scoped cannot be checked — it is refused instead.
 */
const unscopedDocumentPaths = [
  '/_all/_search',
  '/_search',
  '/_msearch',
  '/_mget',
  '/_sql',
  '/_reindex',
  '//secrets/_search',
]

for (const path of unscopedDocumentPaths) {
  test(`refuses ${path} when a blacklist exists`, async () => {
    const captured: Record<string, unknown> = {}
    await expect(
      run({ method: 'GET', path }, fakeAdapter(captured) as never, ['secrets'])
    ).rejects.toThrow(/blacklist|routes to/i)
    expect(captured.path).toBeUndefined()
  })
}

test('still allows cluster metadata endpoints', async () => {
  for (const path of ['/_cat/indices', '/_cluster/health', '/_nodes']) {
    const captured: Record<string, unknown> = {}
    await run({ method: 'GET', path }, fakeAdapter(captured) as never, ['secrets'])
    expect(captured.path).toBe(path)
  }
})

test('allows an unscoped path when nothing is blacklisted', async () => {
  const captured: Record<string, unknown> = {}
  await run({ method: 'GET', path: '/_search' }, fakeAdapter(captured) as never, [])
  expect(captured.path).toBe('/_search')
})

test('blocks a comma list, a wildcard and an encoded wildcard', async () => {
  for (const path of [
    '/secrets,orders/_search',
    '/sec*/_search',
    '/%2A/_search',
    '/cluster:secrets/_search',
  ]) {
    const captured: Record<string, unknown> = {}
    await expect(
      run({ method: 'GET', path }, fakeAdapter(captured) as never, ['secrets'])
    ).rejects.toThrow(/blacklist|routes to/i)
    expect(captured.path).toBeUndefined()
  }
})

test('still allows an unrelated index expression', async () => {
  const captured: Record<string, unknown> = {}
  await run({ method: 'GET', path: '/logs-*/_search' }, fakeAdapter(captured) as never, ['secrets'])
  expect(captured.path).toBe('/logs-*/_search')
})

/**
 * The guard read the raw path. Elasticsearch routes the *decoded, resolved*
 * one: `%5F` is `_`, `%2F` is `/`, and `..` pops a segment.
 */
const encodedPaths = [
  '/%5Fsearch',
  '/secrets%2F_search',
  '/_cat/../secrets/_search',
  '/_ALL/_search',
  '/_cat/indices/secrets',
]

for (const path of encodedPaths) {
  test(`refuses ${path} once the path is resolved`, async () => {
    const captured: Record<string, unknown> = {}
    await expect(
      run({ method: 'GET', path }, fakeAdapter(captured) as never, ['secrets'])
    ).rejects.toThrow(/blacklist|routes to/i)
    expect(captured.path).toBeUndefined()
  })
}

/**
 * The allow-list read the raw path while everything else read the resolved one,
 * so an allow-listed first segment plus `..` laundered any unscoped endpoint —
 * the HTTP client resolves dot segments, so `/_cat/../_search` is `/_search`.
 */
const launderedPaths = [
  '/_cat/../_search',
  '/_cat/%2e%2e/_search',
  '/_ingest/../_sql',
  '/_license/../_msearch',
  '/_tasks/../_mget',
  '/_cat/../../_search',
]

for (const path of launderedPaths) {
  test(`refuses ${path}`, async () => {
    const captured: Record<string, unknown> = {}
    await expect(
      run({ method: 'GET', path }, fakeAdapter(captured) as never, ['secrets'])
    ).rejects.toThrow(/blacklist|routes to/i)
    expect(captured.path).toBeUndefined()
  })
}

/**
 * The body names indices too. Scoping the path to a harmless index is exactly
 * what re-opened `_mget`, `_bulk` and the `terms` lookup.
 */
const bodiesNamingSecrets: [string, unknown][] = [
  ['/orders/_mget', { docs: [{ _index: 'secrets', _id: '1' }] }],
  ['/orders/_bulk', { delete: { _index: 'secrets', _id: '1' } }],
  ['/orders/_search', { query: { terms: { a: { index: 'secrets', id: '1', path: 'x' } } } }],
]

for (const [path, body] of bodiesNamingSecrets) {
  test(`refuses a body naming a blacklisted index on ${path}`, async () => {
    const captured: Record<string, unknown> = {}
    await expect(
      run({ method: 'POST', path, body }, fakeAdapter(captured) as never, ['secrets'])
    ).rejects.toThrow(/blacklist|routes to/i)
    expect(captured.path).toBeUndefined()
  })
}

test('still allows a body naming only permitted indices', async () => {
  const captured: Record<string, unknown> = {}
  await run(
    { method: 'POST', path: '/orders/_mget', body: { docs: [{ _index: 'orders', _id: '1' }] } },
    fakeAdapter(captured) as never,
    ['secrets']
  )
  expect(captured.path).toBe('/orders/_mget')
})

/**
 * `dbcli query --index users` hides these fields; the shell never consulted
 * `blacklist.columns` at all.
 */
test('redacts blacklisted fields from the response', async () => {
  const adapter = {
    request: async () => ({
      hits: { hits: [{ _index: 'users', _source: { id: 1, password_hash: 'SECRET' } }] },
    }),
  }
  const res = await run({ method: 'GET', path: '/users/_search' }, adapter as never, [], {
    users: ['password_hash'],
  })

  expect(JSON.stringify(res)).not.toContain('SECRET')
  expect(JSON.stringify(res)).not.toContain('password_hash')
  expect(JSON.stringify(res)).toContain('"id":1')
})

test('leaves the response alone when no column rules exist', async () => {
  const adapter = { request: async () => ({ hits: { hits: [{ _source: { a: 1 } }] } }) }
  const res = await run({ method: 'GET', path: '/users/_search' }, adapter as never, [], {})
  expect(JSON.stringify(res)).toContain('"a":1')
})

/**
 * Removing protected keys from the *response* is not enough: Elasticsearch
 * returns a field's value under a key the request chooses. `{"sort":["password"]}`
 * exfiltrates the whole column, ordered, with no scripting permission.
 */
const requestsNamingAProtectedField: unknown[] = [
  { sort: ['password'] },
  { aggs: { a: { terms: { field: 'password' } } } },
  { script_fields: { leak: { script: "doc['password'].value" } } },
  { docvalue_fields: ['password'] },
]

for (const body of requestsNamingAProtectedField) {
  test(`refuses a request naming a protected field: ${JSON.stringify(body).slice(0, 40)}`, async () => {
    const captured: Record<string, unknown> = {}
    await expect(
      run({ method: 'POST', path: '/users/_search', body }, fakeAdapter(captured) as never, [], {
        users: ['password'],
      })
    ).rejects.toThrow(/blacklist|routes to/i)
    expect(captured.path).toBeUndefined()
  })
}

test('still allows a request that names no protected field', async () => {
  const captured: Record<string, unknown> = {}
  await run(
    { method: 'POST', path: '/users/_search', body: { query: { match_all: {} } } },
    fakeAdapter(captured) as never,
    [],
    { users: ['password'] }
  )
  expect(captured.path).toBe('/users/_search')
})

test('refuses an array-valued index naming a blacklisted index', async () => {
  for (const body of [
    { index: ['public', 'secrets'] },
    { _index: ['secrets'] },
    { source: { index: ['secrets'] } },
  ]) {
    const captured: Record<string, unknown> = {}
    await expect(
      run({ method: 'POST', path: '/public/_search', body }, fakeAdapter(captured) as never, [
        'secrets',
      ])
    ).rejects.toThrow(/blacklist|routes to/i)
    expect(captured.path).toBeUndefined()
  }
})

test('refuses a data-stream backing index and a rollover index', async () => {
  for (const path of ['/.ds-secrets-2026.08.05-000001/_search', '/secrets-000001/_search']) {
    const captured: Record<string, unknown> = {}
    await expect(
      run({ method: 'GET', path }, fakeAdapter(captured) as never, ['secrets'])
    ).rejects.toThrow(/blacklist|routes to/i)
    expect(captured.path).toBeUndefined()
  }
})

test('does not refuse an unrelated index that merely shares a prefix', async () => {
  const captured: Record<string, unknown> = {}
  await run({ method: 'GET', path: '/secrets-archive/_search' }, fakeAdapter(captured) as never, [
    'secrets',
  ])
  expect(captured.path).toBe('/secrets-archive/_search')
})
