import { describe, test, expect } from 'bun:test'
import { parseEsRequest, runEsRequest, type EsRequest } from '@/commands/es-shell'
import { pinEnglishMessages } from '../../helpers/pin-english-messages'

pinEnglishMessages()

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

/**
 * 第六輪 CRITICAL：第五輪把 `-` 加進分隔字元集，於是欄位名本身含連字號的
 * 黑名單欄位被切成兩半而不再命中——`user-password` 變成 `user` 與 `password`，
 * 兩者都不在黑名單裡。ES 的欄位名允許 `-`，`user-password` 這種命名很常見。
 *
 * `?sort=` 是其中最嚴重的一條：搜尋回應把 sort key 的值原樣放在
 * `hits.hits[].sort` 陣列裡，不掛在欄位名下，所以 `redactFields` 結構上摸不到。
 * 同一個請求寫成 body（`{"sort":[{"user-password":"asc"}]}`）會被正確拒絕——
 * 差別只在切詞器，不在政策。
 *
 * 修法是兩套分隔字元集都切、取聯集：保守集（含 `:` 不含 `-`）產出
 * `user-password`，加寬集產出第五輪要擋的 `+password`。單靠任一套都不夠。
 */
test.each([
  ['?sort=user-password:asc', 'sort 直接洩值'],
  ['?q=user-password:hunter2', 'q 的 match oracle'],
  ['?docvalue_fields=user-password', 'docvalue_fields'],
  ['?_source_includes=user-password', '_source_includes'],
])('欄位名含連字號時仍然要被擋：%s（%s）', async (queryString) => {
  const captured: Record<string, unknown> = {}
  await expect(
    run({ method: 'GET', path: `/users/_search${queryString}` }, fakeAdapter(captured), [], {
      users: ['user-password'],
    })
  ).rejects.toThrow(/blacklist-protected/)
  expect(captured.path).toBeUndefined()
})

test('第五輪的 Lucene 前綴修補不得因此失效', async () => {
  const captured: Record<string, unknown> = {}
  await expect(
    run(
      { method: 'GET', path: '/users/_search?q=%2Bpassword:hunter2' },
      fakeAdapter(captured),
      [],
      {
        users: ['password'],
      }
    )
  ).rejects.toThrow(/blacklist-protected/)
  expect(captured.path).toBeUndefined()
})

test('其他含符號的合法欄位名同樣擋得住', async () => {
  for (const [field, queryString] of [
    ['user*name', '?sort=user*name:asc'],
    ['a|b', '?q=a|b:x'],
    ['a/b', '?sort=a/b:asc'],
  ] as [string, string][]) {
    const captured: Record<string, unknown> = {}
    await expect(
      run({ method: 'GET', path: `/users/_search${queryString}` }, fakeAdapter(captured), [], {
        users: [field],
      })
    ).rejects.toThrow(/blacklist-protected/)
  }
})

test('沒命中的請求不受兩套切法影響', async () => {
  const captured: Record<string, unknown> = {}
  await run(
    { method: 'GET', path: '/users/_search?sort=created-at:asc' },
    fakeAdapter(captured),
    [],
    {
      users: ['user-password'],
    }
  )
  expect(captured.path).toBe('/users/_search?sort=created-at:asc')
})

/**
 * 第六輪 MEDIUM：size cap 與分類器規則 2 對同一個請求給出不同答案。
 *
 * 兩處分歧：cap 不看 method（分類器要求 GET/HEAD/POST），且 cap 讀
 * `normalizeEsPath`（會解碼）而分類器讀原始 pathname（不解碼）。兩者都不可
 * 利用——ES 不會把寫入路由到 `/_search`，而分歧都落在需要 admin 的那一側——
 * 但「同一個請求、兩個函式、兩種答案」正是前幾輪 CRITICAL 的形狀。
 */
test.each([
  ['PUT', '/orders/_search'],
  ['DELETE', '/orders/_search'],
])('%s %s 不是搜尋，不得注入 size', async (method, path) => {
  const captured: Record<string, unknown> = {}
  await run({ method, path, body: { title: 'x' } } as EsRequest, fakeAdapter(captured), [])
  expect(captured.body).toEqual({ title: 'x' })
})

test('百分號編碼的 _search 依分類器的看法處理，不依解碼後的樣子', async () => {
  const captured: Record<string, unknown> = {}
  await run(
    { method: 'POST', path: '/orders/%5Fsearch', body: { query: { match_all: {} } } },
    fakeAdapter(captured),
    []
  )
  expect(captured.body).toEqual({ query: { match_all: {} } })
})

test('真正的搜尋仍然拿到 size cap（GET 與 POST 都要）', async () => {
  for (const method of ['GET', 'POST']) {
    const captured: Record<string, unknown> = {}
    await run(
      { method, path: '/orders/_search', body: { query: { match_all: {} } } } as EsRequest,
      fakeAdapter(captured),
      []
    )
    expect((captured.body as { size?: number }).size).toBe(1000)
  }
})

/**
 * 第七輪 CRITICAL：帶 `.` 的黑名單欄位名整條失效——請求端與遮罩端同時漏掉。
 *
 * `namesProtectedField` 先比對整串相等，再把 term 拆成點分元件逐一比對。
 * 拆出來的元件永遠不含 `.`，所以**永遠不可能**等於一個含 `.` 的集合成員：
 * `user.password` 這種設定寫法對整個檢查毫無作用。而 ES 的 object field 一律
 * 以點分名稱呈現（`user.password`、`payment.card_number`），那是最自然的寫法。
 *
 * 遮罩端是同一個函式，所以 `_source` 巢狀走下去時鍵是 `user` 再 `password`，
 * 兩者都不在集合裡——回應原樣返回。對照組：扁平的 `password` 走同樣的路徑
 * 會被擋也會被遮，差別就只有那個 `.`。
 */
describe('含點的黑名單欄位名', () => {
  const dotted = { orders: ['user.password'] }

  test.each([
    '?docvalue_fields=user.password.keyword',
    '?sort=user.password:asc',
    '?_source_includes=user.password',
    '?q=user.password:hunter2',
  ])('請求端擋得住 %s', async (queryString) => {
    const captured: Record<string, unknown> = {}
    await expect(
      run(
        { method: 'GET', path: `/orders/_search${queryString}` },
        fakeAdapter(captured),
        [],
        dotted
      )
    ).rejects.toThrow(/blacklist-protected/)
    expect(captured.path).toBeUndefined()
  })

  test('body 裡指名也擋得住', async () => {
    const captured: Record<string, unknown> = {}
    await expect(
      run(
        { method: 'GET', path: '/orders/_search', body: { docvalue_fields: ['user.password'] } },
        fakeAdapter(captured),
        [],
        dotted
      )
    ).rejects.toThrow(/blacklist-protected/)
  })

  test('遮罩端把巢狀在 _source 底下的值移除', async () => {
    const adapter = {
      request: async () => ({
        hits: {
          hits: [{ _source: { id: 1, user: { name: 'a', password: 'hunter2' } } }],
        },
      }),
    }
    const res = (await run({ method: 'GET', path: '/orders/_search' }, adapter, [], dotted)) as any
    const source = res.hits.hits[0]._source
    expect(source.user.password).toBeUndefined()
    expect(source.user.name).toBe('a')
    expect(source.id).toBe(1)
  })

  test('遮罩端也移除點分呈現的 fields 鍵', async () => {
    const adapter = {
      request: async () => ({
        hits: { hits: [{ fields: { 'user.password.keyword': ['hunter2'], 'user.name': ['a'] } }] },
      }),
    }
    const res = (await run({ method: 'GET', path: '/orders/_search' }, adapter, [], dotted)) as any
    expect(res.hits.hits[0].fields['user.password.keyword']).toBeUndefined()
    expect(res.hits.hits[0].fields['user.name']).toEqual(['a'])
  })

  test('同名但不同路徑的欄位不受影響——user.password 不該連 admin.password 一起遮', async () => {
    const adapter = {
      request: async () => ({
        hits: { hits: [{ _source: { admin: { password: 'keep' } } }] },
      }),
    }
    const res = (await run({ method: 'GET', path: '/orders/_search' }, adapter, [], dotted)) as any
    expect(res.hits.hits[0]._source.admin.password).toBe('keep')
  })

  test('扁平欄位名的既有行為不變', async () => {
    const captured: Record<string, unknown> = {}
    await expect(
      run({ method: 'GET', path: '/orders/_search?sort=password:asc' }, fakeAdapter(captured), [], {
        orders: ['password'],
      })
    ).rejects.toThrow(/blacklist-protected/)
  })
})

/**
 * 第七輪 HIGH：`%2F..%2F` 讓 blacklist 與 audit 讀到一條伺服器收不到的路徑。
 *
 * `GET /secrets%2F..%2Fpublic/_search` 通得過位元組同一性檢查——`url.pathname`
 * 原封不動保留 `%2F`——但 `normalizeEsPath` 先把 `%2F` 解碼成 `/`，再用 `..`
 * 把前一段刪掉。於是 `secrets` 從路徑區段檢查、`extractIndexFromPath` 與
 * audit 的 target／statement 三處同時消失，而 ES 收到的是一整段
 * `secrets/../public` 的 index expression。
 *
 * dbcli 分辨不出伺服器會怎麼解讀它，所以拒絕而不是正規化——這與位元組同一性
 * 檢查是同一個原則：不近似傳輸層的行為。
 */
describe('編碼後才出現的 .. 一律拒絕', () => {
  test.each([
    '/secrets%2F..%2Fpublic/_search',
    '/public/..%2Fsecrets/_search',
    '/a%2F..%2Fb/_doc/1',
  ])('拒絕 %s', async (path) => {
    const captured: Record<string, unknown> = {}
    await expect(run({ method: 'GET', path }, fakeAdapter(captured), ['secrets'])).rejects.toThrow(
      /\.\./
    )
    expect(captured.path).toBeUndefined()
  })

  test('沒有 .. 的編碼斜線不受影響', async () => {
    const captured: Record<string, unknown> = {}
    await run({ method: 'GET', path: '/orders/_doc/a%2Fb' }, fakeAdapter(captured), [])
    expect(captured.path).toBe('/orders/_doc/a%2Fb')
  })

  test('一般路徑不受影響', async () => {
    const captured: Record<string, unknown> = {}
    await run({ method: 'GET', path: '/orders/_search' }, fakeAdapter(captured), [])
    expect(captured.path).toBe('/orders/_search')
  })
})

/**
 * 第七輪 MEDIUM：body 中間夾一行「只有空白」的行會把 block 截斷，前半段照送。
 *
 * 提交的判斷是 `line.trim() === ''`，所以編輯器常見的「含空白的空行」等同於
 * 提交。最壞的具體例子是 `POST /orders/_update_by_query` 後面接一行兩個空白：
 * 前半段解析成一個**沒有 body** 的請求並實際送出，而 `_update_by_query` 沒有
 * body 是合法的、作用範圍是整個 index；使用者只會看到後半段的一則格式錯誤，
 * 以為整筆沒送。而 audit 寫下的 `POST /orders/_update_by_query` 與使用者本來
 * 打算送的那一筆逐字相同，事後查不出送出去的是無 body 版本。
 *
 * 這是第六輪那個 CRITICAL 的同一類——「使用者提交的」與「送出的」不一致——
 * 只是源頭在 block 的切分規則。含空白的行屬於 block 的內容，不是它的結尾。
 */
test('block 內部含空白的行不是提交，body 跟著 header 一起送出', () => {
  const req = parseEsRequest(
    'POST /orders/_update_by_query\n  \n{"query":{"term":{"status":"draft"}}}'
  )
  expect(req.method).toBe('POST')
  expect(req.path).toBe('/orders/_update_by_query')
  expect(req.body).toEqual({ query: { term: { status: 'draft' } } })
})

test('前導與尾端的空白行仍然被忽略', () => {
  const req = parseEsRequest('\n  \nGET /orders/_search\n')
  expect(req.method).toBe('GET')
  expect(req.path).toBe('/orders/_search')
  expect(req.body).toBeUndefined()
})

/**
 * 第七輪 MEDIUM（誤擋）：不含欄位名的 query 參數不該進切詞器。
 * `?routing=abc-name-1` 在黑名單欄位叫 `name` 時被拒絕——路徑上沒有任何
 * 欄位名語意可言，那是純誤擋。
 */
test.each([
  ['?routing=abc-name-1', 'routing'],
  ['?preference=_shards:2', 'preference'],
  ['?filter_path=hits.hits._source.name', 'filter_path'],
])('不含欄位名的參數 %s（%s）不因為切出片段而被擋', async (queryString) => {
  const captured: Record<string, unknown> = {}
  await run({ method: 'GET', path: `/orders/_search${queryString}` }, fakeAdapter(captured), [], {
    orders: ['name'],
  })
  expect(captured.path).toBe(`/orders/_search${queryString}`)
})

test('真正指名欄位的參數仍然被擋', async () => {
  const captured: Record<string, unknown> = {}
  await expect(
    run({ method: 'GET', path: '/orders/_search?sort=name:asc' }, fakeAdapter(captured), [], {
      orders: ['name'],
    })
  ).rejects.toThrow(/blacklist-protected/)
})

/**
 * 第八輪 HIGH：白名單只比對第一段，於是它放行了自己明文拒絕過的資料。
 *
 * `_ingest` 與 `_tasks` 被移出白名單的理由寫在原始碼裡：pipeline 定義常內嵌
 * 憑證，詳細 task 列表帶著執行中查詢的 request source。但 `_cluster/state` 的
 * `metadata.ingest.pipeline[]` 就是同一份 pipeline 定義，`_cat/tasks?detailed`
 * 的 description 就是同一份 task 來源——`_cluster` 與 `_cat` 是整個前綴放行的。
 * 關掉一扇門，旁邊那扇通往同一個房間的門開著。
 *
 * `_cluster/state` 另外還給出黑名單索引的完整 mapping，而 `_cat/indices/secrets`
 * （只有統計）是明確被拒絕的。
 */
describe('無 index 的 metadata 白名單要細到子資源', () => {
  test.each([
    ['/_cluster/state'],
    ['/_cluster/state/metadata'],
    ['/_cat/tasks'],
    ['/_nodes/stats'],
    ['/_nodes/stats/indices'],
    ['/_nodes/hot_threads'],
  ])('%s 在有黑名單時要被拒絕', async (path) => {
    const captured: Record<string, unknown> = {}
    await expect(run({ method: 'GET', path }, fakeAdapter(captured), ['secrets'])).rejects.toThrow(
      /names no index|blacklist/i
    )
    expect(captured.path).toBeUndefined()
  })

  test.each([['/_cat/indices'], ['/_cluster/health'], ['/_license'], ['/_nodes']])(
    '%s 仍然放行——它們不帶文件內容',
    async (path) => {
      const captured: Record<string, unknown> = {}
      await run({ method: 'GET', path }, fakeAdapter(captured), ['secrets'])
      expect(captured.path).toBe(path)
    }
  )

  test('沒有設定黑名單時不受影響', async () => {
    const captured: Record<string, unknown> = {}
    await run({ method: 'GET', path: '/_cluster/state' }, fakeAdapter(captured), [])
    expect(captured.path).toBe('/_cluster/state')
  })
})

/**
 * 第八輪 HIGH：`_search/template` 的 `source` 是字串，body 側的 index 掃描
 * 從不進字串內部，所以裡面的 terms lookup 指到黑名單索引也看不見。
 *
 * ```
 * POST /public/_search/template
 * {"source":"{\"query\":{\"terms\":{\"u\":{\"index\":\"secrets\",...}}}}","params":{}}
 * ```
 * 同一個 terms lookup 直接寫在 `_search` body 裡是被拒絕的——差別只在它被包進
 * 一個字串。stored template（`{"id":"t"}`）更徹底：內容根本不在請求裡。
 *
 * 這與 `wrapper` query 是同一個原則（ADR-0014 Decision 7）：dbcli 檢查不了的
 * body 不放行。第六輪曾把「字串編碼 body」記為盲點，卻用 tier gate 論證它不可
 * 觸發——那個論證只涵蓋了它列舉到的入口。
 */
describe('template 端點的 body 檢查不了，一律拒絕', () => {
  test.each([
    [
      '/public/_search/template',
      { source: '{"query":{"terms":{"u":{"index":"secrets","id":"1","path":"n"}}}}', params: {} },
    ],
    ['/public/_search/template', { id: 'stored-template', params: {} }],
    ['/_search/template', { id: 't' }],
    ['/_render/template', { id: 't' }],
    ['/_msearch/template', { id: 't' }],
  ])('拒絕 %s', async (path, body) => {
    const captured: Record<string, unknown> = {}
    await expect(
      run({ method: 'POST', path, body }, fakeAdapter(captured), ['secrets'])
    ).rejects.toThrow(/cannot be inspected|template/i)
    expect(captured.path).toBeUndefined()
  })

  test('一般 _search 不受影響', async () => {
    const captured: Record<string, unknown> = {}
    await run(
      { method: 'POST', path: '/public/_search', body: { query: { match_all: {} } } },
      fakeAdapter(captured),
      ['secrets']
    )
    expect(captured.path).toBe('/public/_search')
  })
})

/**
 * 第八輪 MEDIUM：黑名單條目帶前後空白時等於沒設，而且沒有任何提示。
 * ES 的 index 名與欄位名都不能帶空白，所以這種條目保證是死設定。
 */
test('欄位黑名單的前後空白不影響比對', async () => {
  const captured: Record<string, unknown> = {}
  await expect(
    run({ method: 'GET', path: '/orders/_search?sort=password:asc' }, fakeAdapter(captured), [], {
      orders: [' password '],
    })
  ).rejects.toThrow(/blacklist-protected/)
})

test('index 黑名單的前後空白不影響比對', async () => {
  const captured: Record<string, unknown> = {}
  await expect(
    run({ method: 'GET', path: '/secrets/_search' }, fakeAdapter(captured), [' secrets '])
  ).rejects.toThrow(/blacklist-protected/)
})
