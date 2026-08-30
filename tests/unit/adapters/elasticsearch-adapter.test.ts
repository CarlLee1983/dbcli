import { describe, test, expect, beforeEach, afterEach, spyOn } from 'bun:test'
import { ElasticsearchAdapter } from '@/adapters/elasticsearch-adapter'
import { ConnectionError } from '@/adapters/types'

describe('ElasticsearchAdapter', () => {
  test('resolves basic host/port/protocol URL', () => {
    const adapter = new ElasticsearchAdapter({
      system: 'elasticsearch',
      protocol: 'http',
      host: 'localhost',
      port: 9200,
      user: '',
      password: '',
      database: '',
    })
    // @ts-expect-error - accessing private getBaseUrl() for test
    expect(adapter.getBaseUrl()).toBe('http://localhost:9200')
  })

  test('resolves cloudId to https URL', () => {
    const adapter = new ElasticsearchAdapter({
      system: 'elasticsearch',
      cloudId:
        'deployment:dXMtZWFzdC0xLmF3cy5mb3VuZC5pbyQ0YTY1ZDE3ZTIxYTM0YmRjOGZlYmY2MTU5Y2FmNGM5ZCQyYmY4ZTY3YmRjYmE0YmFlYmFmYmJlYmFmYmJlYmFmYg==',
      user: '',
      password: '',
      database: '',
    } as any)
    // @ts-expect-error - accessing private getBaseUrl() for test
    expect(adapter.getBaseUrl()).toBe(
      'https://4a65d17e21a34bdc8febf6159caf4c9d.us-east-1.aws.found.io:443'
    )
  })

  test('builds API key auth header', async () => {
    const adapter = new ElasticsearchAdapter({
      system: 'elasticsearch',
      apiKey: 'my-key',
      host: 'localhost',
      port: 9200,
      user: '',
      password: '',
      database: '',
    })
    // @ts-expect-error - accessing private getHeaders() for test
    const headers = await adapter.getHeaders()
    expect(headers.Authorization).toBe('ApiKey my-key')
  })

  test('builds basic auth header', async () => {
    const adapter = new ElasticsearchAdapter({
      system: 'elasticsearch',
      user: 'elastic',
      password: 'password',
      host: 'localhost',
      port: 9200,
      database: '',
    })
    // @ts-expect-error - accessing private getHeaders() for test
    const headers = await adapter.getHeaders()
    expect(headers.Authorization).toBe('Basic ' + btoa('elastic:password'))
  })

  test('maps 401 to AUTH_FAILED', async () => {
    const adapter = new ElasticsearchAdapter({
      system: 'elasticsearch',
      host: 'localhost',
      port: 9200,
      user: '',
      password: '',
      database: '',
    })

    // Mock fetch
    const mockFetch = spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('Unauthorized', { status: 401 })
    )

    try {
      await adapter.connect()
      expect.unreachable('Should have thrown')
    } catch (error: any) {
      expect(error).toBeInstanceOf(ConnectionError)
      expect(error.code).toBe('AUTH_FAILED')
    } finally {
      mockFetch.mockRestore()
    }
  })
})

describe('ElasticsearchAdapter list/schema', () => {
  let originalFetch: typeof fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  test('listCollections returns indices and doc counts', async () => {
    const adapter = new ElasticsearchAdapter({
      system: 'elasticsearch',
      protocol: 'http',
      host: 'localhost',
      port: 9200,
      user: '',
      password: '',
      database: '',
    })

    const catRows = [
      { index: 'users', 'docs.count': '100' },
      { index: '.security', 'docs.count': '5' },
    ]

    const requestedUrls: string[] = []
    // @ts-expect-error - mocking globalThis.fetch with simplified signature for test
    globalThis.fetch = async (url: string) => {
      requestedUrls.push(url)
      if (url.includes('_cat/indices')) return Response.json(catRows)
      return Response.json({})
    }

    const collections = await adapter.listCollections()
    expect(collections).toHaveLength(1)
    expect(collections[0]!.name).toBe('users')
    expect(collections[0]!.documentCount).toBe(100)
    // 一個請求就夠：舊版還會把整個叢集的 settings 拉回來（#46）
    expect(requestedUrls).toHaveLength(1)
    expect(requestedUrls[0]).toContain('_cat/indices')
    // cat 預設只列 open index；少了這個參數，關閉中的 index 會從清單消失
    expect(requestedUrls[0]).toContain('expand_wildcards=all')

    const allCollections = await adapter.listCollections({ includeSystem: true })
    expect(allCollections).toHaveLength(2)
  })

  test('getTableSchema flattens mappings', async () => {
    const adapter = new ElasticsearchAdapter({
      system: 'elasticsearch',
      protocol: 'http',
      host: 'localhost',
      port: 9200,
      user: '',
      password: '',
      database: '',
    })

    const mockMapping = {
      users: {
        mappings: {
          properties: {
            id: { type: 'keyword' },
            name: { type: 'text', fields: { keyword: { type: 'keyword' } } },
            profile: {
              properties: {
                email: { type: 'keyword' },
                age: { type: 'integer' },
              },
            },
          },
        },
      },
    }

    // @ts-expect-error - mocking globalThis.fetch with simplified signature for test
    globalThis.fetch = async () => new Response(JSON.stringify(mockMapping))

    const schema = await adapter.getTableSchema('users')
    expect(schema.name).toBe('users')
    const columnNames = schema.columns.map((c) => c.name)
    expect(columnNames).toContain('id')
    expect(columnNames).toContain('name')
    expect(columnNames).toContain('name.keyword')
    expect(columnNames).toContain('profile.email')
    expect(columnNames).toContain('profile.age')
  })
})

describe('ElasticsearchAdapter execute', () => {
  let originalFetch: typeof fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  test('execute handles URI query', async () => {
    const adapter = new ElasticsearchAdapter({
      system: 'elasticsearch',
      protocol: 'http',
      host: 'localhost',
      port: 9200,
      user: '',
      password: '',
      database: '',
    })

    const mockResponse = {
      hits: {
        total: { value: 1, relation: 'eq' },
        hits: [{ _id: '1', _source: { name: 'Alice', profile: { email: 'a@example.com' } } }],
      },
    }

    let capturedUrl = ''
    // @ts-expect-error - mocking globalThis.fetch with simplified signature for test
    globalThis.fetch = async (url: string) => {
      capturedUrl = url
      return new Response(JSON.stringify(mockResponse))
    }

    const result = await adapter.execute('name:Alice', ['users'], { limit: 10 })
    expect(capturedUrl).toContain('/users/_search?q=name%3AAlice&size=10')
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]).toEqual({ _id: '1', name: 'Alice', 'profile.email': 'a@example.com' })
  })

  test('execute handles DSL query', async () => {
    const adapter = new ElasticsearchAdapter({
      system: 'elasticsearch',
      protocol: 'http',
      host: 'localhost',
      port: 9200,
      user: '',
      password: '',
      database: '',
    })

    const dsl = '{"query":{"match_all":{}}}'
    let capturedBody = ''
    // @ts-expect-error - mocking globalThis.fetch with simplified signature for test
    globalThis.fetch = async (url: string, init: any) => {
      capturedBody = init.body
      return new Response(JSON.stringify({ hits: { total: { value: 0 }, hits: [] } }))
    }

    await adapter.execute(dsl, ['users'])
    const parsed = JSON.parse(capturedBody)
    expect(parsed.query).toEqual({ match_all: {} })
    expect(parsed.size).toBe(100)
  })
})

describe('ElasticsearchAdapter write operations', () => {
  let originalFetch: typeof fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  test('insert sends PUT to _doc', async () => {
    const adapter = new ElasticsearchAdapter({
      system: 'elasticsearch',
      protocol: 'http',
      host: 'localhost',
      port: 9200,
      user: '',
      password: '',
      database: '',
    })

    let capturedMethod = ''
    let capturedUrl = ''
    // @ts-expect-error - mocking globalThis.fetch with simplified signature for test
    globalThis.fetch = async (url: string, init: any) => {
      capturedUrl = url
      capturedMethod = init.method
      return new Response(JSON.stringify({ _id: '1', result: 'created' }))
    }

    await adapter.insert('users', { _id: '1', name: 'Alice' })
    expect(capturedMethod).toBe('PUT')
    expect(capturedUrl).toContain('/users/_doc/1')
  })

  test('update sends POST to _update', async () => {
    const adapter = new ElasticsearchAdapter({
      system: 'elasticsearch',
      protocol: 'http',
      host: 'localhost',
      port: 9200,
      user: '',
      password: '',
      database: '',
    })

    let capturedMethod = ''
    let capturedUrl = ''
    // @ts-expect-error - mocking globalThis.fetch with simplified signature for test
    globalThis.fetch = async (url: string, init: any) => {
      capturedUrl = url
      capturedMethod = init.method
      return new Response(JSON.stringify({ _id: '1', result: 'updated' }))
    }

    await adapter.update('users', { _id: '1' }, { name: 'Bob' })
    expect(capturedMethod).toBe('POST')
    expect(capturedUrl).toContain('/users/_update/1')
  })

  test('delete sends DELETE to _doc', async () => {
    const adapter = new ElasticsearchAdapter({
      system: 'elasticsearch',
      protocol: 'http',
      host: 'localhost',
      port: 9200,
      user: '',
      password: '',
      database: '',
    })

    let capturedMethod = ''
    let capturedUrl = ''
    // @ts-expect-error - mocking globalThis.fetch with simplified signature for test
    globalThis.fetch = async (url: string, init: any) => {
      capturedUrl = url
      capturedMethod = init.method
      return new Response(JSON.stringify({ _id: '1', result: 'deleted' }))
    }

    await adapter.delete('users', { _id: '1' })
    expect(capturedMethod).toBe('DELETE')
    expect(capturedUrl).toContain('/users/_doc/1')
  })
})

test('request() is callable from outside the adapter', () => {
  const opts = {
    system: 'elasticsearch',
    host: 'localhost',
    port: 9200,
  } as unknown as import('@/adapters/types').ConnectionOptions
  const adapter = new ElasticsearchAdapter(opts)
  expect(typeof (adapter as unknown as { request: unknown }).request).toBe('function')
})

// ── URL 路徑編碼（#39） ────────────────────────────────────────────────────

describe('ElasticsearchAdapter URL 路徑編碼', () => {
  function adapterWithCapturedPaths(): {
    adapter: ElasticsearchAdapter
    paths: { method: string; path: string }[]
  } {
    const adapter = new ElasticsearchAdapter({
      system: 'elasticsearch',
      protocol: 'http',
      host: 'localhost',
      port: 9200,
      user: '',
      password: '',
      database: '',
    })
    const paths: { method: string; path: string }[] = []
    ;(adapter as unknown as { request: unknown }).request = async (
      method: string,
      path: string
    ): Promise<unknown> => {
      paths.push({ method, path })
      return { hits: { hits: [] }, result: 'created' }
    }
    return { adapter, paths }
  }

  test('index 名稱中的斜線不會多切出一層路徑', async () => {
    const { adapter, paths } = adapterWithCapturedPaths()
    await adapter.execute('{}', ['secrets/_search'])
    expect(paths[0]?.path).toBe('/secrets%2F_search/_search')
  })

  test('getTableSchema 的 index 名稱被編碼', async () => {
    const { adapter, paths } = adapterWithCapturedPaths()
    ;(adapter as unknown as { request: unknown }).request = async (
      _method: string,
      path: string
    ): Promise<unknown> => {
      paths.push({ method: _method, path })
      return { 'we ird': { mappings: { properties: {} } } }
    }
    await adapter.getTableSchema('we ird')
    expect(paths[0]?.path).toBe('/we%20ird/_mapping')
  })

  test('document id 中的斜線與問號被編碼', async () => {
    const { adapter, paths } = adapterWithCapturedPaths()
    await adapter.insert('logs', { _id: 'a/b?c', msg: 'x' })
    expect(paths[0]?.path).toBe('/logs/_doc/a%2Fb%3Fc')
  })

  test('update 與 delete 的 id 同樣被編碼', async () => {
    const { adapter, paths } = adapterWithCapturedPaths()
    await adapter.update('logs', { _id: 'a/b' }, { msg: 'y' })
    await adapter.delete('logs', { _id: 'a/b' })
    expect(paths[0]?.path).toBe('/logs/_update/a%2Fb')
    expect(paths[1]?.path).toBe('/logs/_doc/a%2Fb')
  })

  test('逗號分隔的多 index 語法仍然可用', async () => {
    const { adapter, paths } = adapterWithCapturedPaths()
    await adapter.execute('{}', ['logs-a,logs-b'])
    expect(paths[0]?.path).toBe('/logs-a,logs-b/_search')
  })
})

// ── server-side script 攔截（#47） ─────────────────────────────────────────

describe('ElasticsearchAdapter server-side script guard', () => {
  function adapter(): ElasticsearchAdapter {
    return new ElasticsearchAdapter({
      system: 'elasticsearch',
      protocol: 'http',
      host: 'localhost',
      port: 9200,
      user: '',
      password: '',
      database: '',
    })
  }

  // 這兩個測試原本 stub `request` 來斷言「沒有送出請求」。檢查點就在 request，
  // 所以那個 stub 等於把待測的那一層 mock 掉——會漏掉第五輪那個 CRITICAL 的
  // 測試長的就是那樣。改 stub `fetch`：唯一真的算「送出」的邊界。
  test('主查詢路徑的 script 被攔截，且沒有送出任何請求', async () => {
    const mockFetch = spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ hits: { hits: [] } }), { status: 200 })
    )
    try {
      await expect(
        adapter().execute('{"query":{"script":{"script":"doc[\'a\'].value > 1"}}}', ['logs'])
      ).rejects.toThrow(/server-side script/i)
      expect(mockFetch).not.toHaveBeenCalled()
    } finally {
      mockFetch.mockRestore()
    }
  })

  test('一般 DSL 照常執行', async () => {
    const mockFetch = spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ hits: { hits: [] } }), { status: 200 })
    )
    try {
      await expect(adapter().execute('{"query":{"match_all":{}}}', ['logs'])).resolves.toBeDefined()
      expect(mockFetch).toHaveBeenCalledTimes(1)
    } finally {
      mockFetch.mockRestore()
    }
  })
})

/**
 * `execute()` 只發得出 `/<index>/_search`。
 *
 * `q` 與 `export` 的 Elasticsearch 路徑從不呼叫 `enforceElasticsearchPermission`，
 * 目前無害**只因為**這件事——SELECT 在最低 tier 也放行，所以只要 `execute()`
 * 發不出第二種端點，缺少 gate 就不構成缺口。那是一個隱性依賴，先前沒有任何
 * 東西釘住它：`execute()` 一旦支援第二種端點，那兩處立刻變成現成的繞道。
 *
 * 這個測試不讓那個依賴繼續隱性。它紅掉的時候，要做的不是改測試，是去那兩處
 * 補上 gate。
 */
describe('execute() 的請求形狀是那兩處缺少 gate 的唯一理由', () => {
  function adapter(): ElasticsearchAdapter {
    return new ElasticsearchAdapter({
      system: 'elasticsearch',
      protocol: 'http',
      host: 'localhost',
      port: 9200,
      user: '',
      password: '',
      database: '',
    })
  }

  test.each([
    ['DSL 查詢', '{"query":{"match_all":{}}}'],
    ['字串查詢', 'status:active'],
    ['index 名稱含斜線與問號的嘗試', '{"query":{"match_all":{}}}'],
  ])('%s 只送到 /<index>/_search', async (_label, query) => {
    const seen: { method?: string; url?: string } = {}
    const mockFetch = spyOn(globalThis, 'fetch').mockImplementation((async (
      url: string,
      init: { method?: string }
    ) => {
      seen.url = String(url)
      seen.method = init?.method
      return new Response(JSON.stringify({ hits: { hits: [] } }), { status: 200 })
    }) as unknown as typeof fetch)

    try {
      await adapter().execute(query, ['logs/../secrets?x=1'])
      const path = new URL(seen.url!).pathname
      expect(path.endsWith('/_search')).toBe(true)
      // index 是唯一的變動段，且必須是單一段——編碼過的 `/` 不得長出新段。
      expect(path.split('/').filter((s) => s.length > 0)).toHaveLength(2)
      expect(['GET', 'POST']).toContain(seen.method!)
    } finally {
      mockFetch.mockRestore()
    }
  })
})
