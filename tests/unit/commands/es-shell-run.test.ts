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
    ).rejects.toThrow(/blacklist|not the request the server would receive/i)
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
    ).rejects.toThrow(/blacklist|not the request the server would receive/i)
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
    ).rejects.toThrow(/blacklist|not the request the server would receive/i)
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
    ).rejects.toThrow(/blacklist|not the request the server would receive/i)
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
    ).rejects.toThrow(/blacklist|not the request the server would receive/i)
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
    ).rejects.toThrow(/blacklist|not the request the server would receive/i)
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
    ).rejects.toThrow(/blacklist|not the request the server would receive/i)
    expect(captured.path).toBeUndefined()
  }
})

test('refuses a data-stream backing index and a rollover index', async () => {
  for (const path of ['/.ds-secrets-2026.08.05-000001/_search', '/secrets-000001/_search']) {
    const captured: Record<string, unknown> = {}
    await expect(
      run({ method: 'GET', path }, fakeAdapter(captured) as never, ['secrets'])
    ).rejects.toThrow(/blacklist|not the request the server would receive/i)
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

/**
 * 第五輪：`blacklistTables` 空的時候，整段 blacklist 檢查一起被跳過——包括
 * 「路徑指不出 index 就拒絕」那一道。而那一道才是把 `_sql`、`_mget`、
 * `_search/scroll` 擋在外面的東西。
 *
 * `_sql` 是唯一 redaction 結構上救不回來的出口：值放在 `rows` 陣列裡，欄位名
 * 只出現在 `columns[].name` 的 value 而不是 key，所以 `redactFields` 摸不到。
 * 諷刺的是 `SELECT "password" FROM users` 會被欄位檢查擋下，`SELECT *` 不會。
 */
test('只設 columns、不設 tables 時，指不出 index 的路徑仍然要被擋', async () => {
  const captured: Record<string, unknown> = {}
  await expect(
    run(
      { method: 'POST', path: '/_sql', body: { query: 'SELECT * FROM users' } },
      fakeAdapter(captured),
      [],
      { users: ['password'] }
    )
  ).rejects.toThrow(/names no index/)
  expect(captured.path).toBeUndefined()
})

test('同一道守門員也管 _mget 與 _search/scroll', async () => {
  for (const req of [
    { method: 'GET', path: '/_mget', body: { docs: [{ _index: 'users', _id: '1' }] } },
    { method: 'POST', path: '/_search/scroll', body: { scroll_id: 'abc' } },
  ] as EsRequest[]) {
    const captured: Record<string, unknown> = {}
    await expect(run(req, fakeAdapter(captured), [], { users: ['password'] })).rejects.toThrow(
      /names no index/
    )
    expect(captured.path).toBeUndefined()
  }
})

test('兩個黑名單都空的時候不受影響——沒有東西要保護就不該花掉一個查詢', async () => {
  const captured: Record<string, unknown> = {}
  await run(
    { method: 'POST', path: '/_sql', body: { query: 'SELECT * FROM users' } },
    fakeAdapter(captured),
    [],
    {}
  )
  expect(captured.path).toBe('/_sql')
})

test('scoped 的路徑在只設 columns 時照常放行', async () => {
  const captured: Record<string, unknown> = {}
  await run(
    { method: 'POST', path: '/orders/_search', body: { query: { match_all: {} } } },
    fakeAdapter(captured),
    [],
    { users: ['password'] }
  )
  expect(captured.path).toBe('/orders/_search')
})

test('cluster metadata 路徑不受這道守門員影響', async () => {
  const captured: Record<string, unknown> = {}
  await run({ method: 'GET', path: '/_cat/indices' }, fakeAdapter(captured), [], {
    users: ['password'],
  })
  expect(captured.path).toBe('/_cat/indices')
})

/**
 * 第五輪：size cap 用原始路徑做子字串比對，是這個檔案裡唯一還在對原始路徑做
 * 這種判斷的地方——第三、四輪把路徑判斷全交給 `new URL` 之後漏掉了這一行。
 * 分類器（走 routed segments）正確判定這是 `_doc` 寫入、id 為 `_search`，
 * `send()` 卻認為它是搜尋，於是把一個使用者從未輸入的欄位寫進文件。
 *
 * 目前只是加欄位、沒有降權，所以這是完整性問題不是權限繞過；但「檢查一份
 * bytes、送出另一份」的結構就在這裡，而那正是前兩輪 CRITICAL 的形狀。
 */
test('id 剛好叫 _search 的寫入，body 不得被注入 size', async () => {
  const captured: Record<string, unknown> = {}
  await run(
    { method: 'PUT', path: '/orders/_doc/_search', body: { title: 'hello' } },
    fakeAdapter(captured),
    []
  )
  expect(captured.body).toEqual({ title: 'hello' })
})

test('query string 裡出現 _search 也不算搜尋', async () => {
  const captured: Record<string, unknown> = {}
  await run(
    { method: 'PUT', path: '/orders/_doc/1?routing=_search', body: { title: 'hi' } },
    fakeAdapter(captured),
    []
  )
  expect(captured.body).toEqual({ title: 'hi' })
})

test('真正的搜尋照樣拿到 size cap', async () => {
  const captured: Record<string, unknown> = {}
  await run(
    { method: 'POST', path: '/orders/_search', body: { query: { match_all: {} } } },
    fakeAdapter(captured),
    []
  )
  expect((captured.body as { size?: number }).size).toBe(1000)
})

test('_count 之類的其他 routed 端點不會被誤判成搜尋', async () => {
  const captured: Record<string, unknown> = {}
  await run(
    { method: 'POST', path: '/orders/_count', body: { query: { match_all: {} } } },
    fakeAdapter(captured),
    []
  )
  expect(captured.body).toEqual({ query: { match_all: {} } })
})

/**
 * 第五輪：query string 的切詞器只切 `[\s,:()"'[\]{}]`，於是欄位名前面加一個
 * `+` 就整個檢查看不到——`?q=%2Bpassword:hunter2` 通過而 `?q=password:hunter2`
 * 被拒。缺口不在 wildcard 語意，而在切詞器本身：Lucene 的 query syntax 還有
 * `-`、`*`、`!`、`^`、`~`、`|`、`/` 這些會貼在欄位名前後的字元。
 */
test.each([
  ['?q=%2Bpassword:hunter2', '+ 前綴'],
  ['?q=-password:hunter2', '- 前綴'],
  ['?q=password*:hunter2', '* 後綴'],
  ['?q=!password:hunter2', '! 前綴'],
  ['?sort=-password', 'sort 的 - 前綴'],
])('黑名單欄位貼上 Lucene 語法字元仍然要被擋：%s（%s）', async (queryString) => {
  const captured: Record<string, unknown> = {}
  await expect(
    run({ method: 'GET', path: `/users/_search${queryString}` }, fakeAdapter(captured), [], {
      users: ['password'],
    })
  ).rejects.toThrow(/blacklist-protected/)
  expect(captured.path).toBeUndefined()
})

test('沒有命中黑名單的 query string 照常放行', async () => {
  const captured: Record<string, unknown> = {}
  await run(
    { method: 'GET', path: '/users/_search?q=%2Bstatus:active' },
    fakeAdapter(captured),
    [],
    {
      users: ['password'],
    }
  )
  expect(captured.path).toBe('/users/_search?q=%2Bstatus:active')
})
