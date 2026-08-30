/**
 * Server-side script 防護（#47）
 *
 * `$where` 與 ES 的 `script` 讓查詢在伺服器上跑任意程式碼——這是查詢介面上
 * 最接近 RCE 的東西。檢查點必須在 adapter，否則每新增一條呼叫路徑就等於新增
 * 一個繞道。
 */

import { describe, test, expect, spyOn } from 'bun:test'
import { ElasticsearchAdapter } from 'src/adapters/elasticsearch-adapter'
import {
  ServerSideScriptRejection,
  assertNoElasticsearchScript,
  assertNoMongoServerSideScript,
} from 'src/adapters/server-side-script'

describe('assertNoMongoServerSideScript', () => {
  test('放行一般 filter', () => {
    expect(() => assertNoMongoServerSideScript({ status: 'active' })).not.toThrow()
  })

  test('攔截頂層 $where', () => {
    expect(() => assertNoMongoServerSideScript({ $where: 'this.a > 1' })).toThrow(
      ServerSideScriptRejection
    )
  })

  test('攔截巢狀在 $or 裡的 $where', () => {
    expect(() =>
      assertNoMongoServerSideScript({ $or: [{ a: 1 }, { $where: 'this.a > 1' }] })
    ).toThrow(/\$where/)
  })

  test('攔截 pipeline 階段裡的 $where 與 $function', () => {
    expect(() => assertNoMongoServerSideScript([{ $match: { $where: 'x' } }])).toThrow(
      ServerSideScriptRejection
    )
    expect(() =>
      assertNoMongoServerSideScript([
        { $set: { computed: { $function: { body: 'function(){}', args: [], lang: 'js' } } } },
      ])
    ).toThrow(ServerSideScriptRejection)
  })

  test('欄位名剛好叫 where 的一般查詢不受影響', () => {
    expect(() => assertNoMongoServerSideScript({ where: 'taipei' })).not.toThrow()
  })

  test('錯誤訊息指出被擋的運算子，讓呼叫端知道要改什麼', () => {
    expect(() => assertNoMongoServerSideScript({ $where: 'x' })).toThrow(
      /server-side script.*\$where/i
    )
  })
})

describe('assertNoElasticsearchScript', () => {
  test('放行一般 DSL', () => {
    expect(() => assertNoElasticsearchScript({ query: { match_all: {} } })).not.toThrow()
  })

  test('攔截 script query', () => {
    expect(() =>
      assertNoElasticsearchScript({ query: { script: { script: "doc['a'].value > 1" } } })
    ).toThrow(ServerSideScriptRejection)
  })

  test('攔截 script_fields', () => {
    expect(() =>
      assertNoElasticsearchScript({ script_fields: { total: { script: 'x' } } })
    ).toThrow(/script_fields/)
  })

  test('攔截藏在 aggs 深處的 script', () => {
    expect(() => assertNoElasticsearchScript({ aggs: { by: { terms: { script: 'x' } } } })).toThrow(
      ServerSideScriptRejection
    )
  })

  test('欄位名叫 description 而值含 "script" 字樣的查詢不受影響', () => {
    expect(() =>
      assertNoElasticsearchScript({ query: { match: { description: 'a script tag' } } })
    ).not.toThrow()
  })
})

/**
 * 第五輪對抗式複查的 CRITICAL：檢查點掛在 `execute()`，但 adapter 有第二個
 * 執行入口 `request()`——`dbcli shell` 走的正是它。本檔開頭「檢查點必須在
 * adapter，否則每新增一條呼叫路徑就等於新增一個繞道」的理由沒有錯，錯的是
 * 「adapter 的執行入口」被當成單數。兩個 agent 從互不相通的方向撞上同一點。
 */
describe('ElasticsearchAdapter.request 是第二個執行入口，共用同一個檢查點', () => {
  const conn = {
    system: 'elasticsearch' as const,
    protocol: 'http',
    host: 'localhost',
    port: 9200,
    user: '',
    password: '',
    database: '',
  }

  function adapter() {
    return new ElasticsearchAdapter(conn as any)
  }

  test('script_fields 在送出前就被擋下，fetch 完全沒有被呼叫', async () => {
    const mockFetch = spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ hits: { hits: [] } }), { status: 200 })
    )
    try {
      await expect(
        adapter().request('POST', '/orders/_search', {
          size: 1,
          script_fields: { leak: { script: { source: "params._source['pass'+'word']" } } },
        })
      ).rejects.toThrow(ServerSideScriptRejection)
      expect(mockFetch).not.toHaveBeenCalled()
    } finally {
      mockFetch.mockRestore()
    }
  })

  test('_update 的 Painless 走 request() 一樣被擋（read-write 也不該放行）', async () => {
    const mockFetch = spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ result: 'updated' }), { status: 200 })
    )
    try {
      await expect(
        adapter().request('POST', '/orders/_update/1', {
          script: { lang: 'painless', source: "ctx._source.role='admin'" },
        })
      ).rejects.toThrow(/script/i)
      expect(mockFetch).not.toHaveBeenCalled()
    } finally {
      mockFetch.mockRestore()
    }
  })

  test('aggs 深處的 script 也擋得到', async () => {
    const mockFetch = spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ hits: { hits: [] } }), { status: 200 })
    )
    try {
      await expect(
        adapter().request('POST', '/orders/_search', {
          aggs: { by: { terms: { script: "doc['x'].value" } } },
        })
      ).rejects.toThrow(ServerSideScriptRejection)
    } finally {
      mockFetch.mockRestore()
    }
  })

  test('一般 DSL 照常送出——檢查不得誤傷', async () => {
    const mockFetch = spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ hits: { hits: [] } }), { status: 200 })
    )
    try {
      await adapter().request('POST', '/orders/_search', { query: { match_all: {} } })
      expect(mockFetch).toHaveBeenCalledTimes(1)
    } finally {
      mockFetch.mockRestore()
    }
  })

  test('無 body 的請求不受影響', async () => {
    const mockFetch = spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({}), { status: 200 })
    )
    try {
      await adapter().request('GET', '/_cat/indices')
      expect(mockFetch).toHaveBeenCalledTimes(1)
    } finally {
      mockFetch.mockRestore()
    }
  })
})
