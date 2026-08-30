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

/**
 * 第六輪 CRITICAL：第五輪把檢查點搬對了層，卻沒發現它認得的名字不夠多。
 *
 * `scripted_metric` 聚合把它的四個 script 槽拼成 `init_script`、`map_script`、
 * `combine_script`、`reduce_script`。一個都不等於 `script` 或 `script_fields`，
 * 於是 query-only 可以用它在叢集上跑任意 Painless，把黑名單欄位以
 * `aggregations.<name>.value` 這個請求自選的 key 讀回來——`redactFields` 看的
 * 是 key 名稱，摸不到。
 *
 * 第五輪的 commit message 宣稱「一律拒絕 script 鍵」已經關掉
 * `doc['pass'+'word']` 這條路。那句話是錯的：拒絕的是兩個字面名稱，而
 * Elasticsearch 的 script 槽不只兩個。比對改看**形狀**而不是清單成員。
 */
describe('script 槽以形狀比對，不是兩個字面名稱', () => {
  test.each([
    'init_script',
    'map_script',
    'combine_script',
    'reduce_script',
    'inline_script',
    'stored_script',
  ])('攔截 %s', (key) => {
    expect(() =>
      assertNoElasticsearchScript({ aggs: { leak: { scripted_metric: { [key]: 'state.s=[]' } } } })
    ).toThrow(ServerSideScriptRejection)
  })

  test('攔截完整的 scripted_metric 洩漏 body', () => {
    expect(() =>
      assertNoElasticsearchScript({
        size: 0,
        aggs: {
          leak: {
            scripted_metric: {
              init_script: 'state.s=[]',
              map_script: "state.s.add(doc['pass'+'word'].value)",
              combine_script: 'return state.s',
              reduce_script: 'return states',
            },
          },
        },
      })
    ).toThrow(/script/i)
  })

  test('runtime_mappings 與 moving_fn 的巢狀 script 仍然擋得到', () => {
    expect(() =>
      assertNoElasticsearchScript({
        runtime_mappings: { x: { type: 'keyword', script: 'emit(1)' } },
      })
    ).toThrow(ServerSideScriptRejection)
    expect(() =>
      assertNoElasticsearchScript({
        aggs: { m: { moving_fn: { script: 'MovingFunctions.min(values)' } } },
      })
    ).toThrow(ServerSideScriptRejection)
  })

  test('名字裡剛好帶 script 但不是 script 槽的欄位不受影響', () => {
    // 結尾不是 `_script`，也不等於 `script`：一般文件欄位不該被誤擋。
    expect(() =>
      assertNoElasticsearchScript({ query: { match: { script_name: 'deploy.sh' } } })
    ).not.toThrow()
    expect(() =>
      assertNoElasticsearchScript({ query: { match: { transcription: 'a script tag' } } })
    ).not.toThrow()
  })
})

/**
 * 第六輪 MEDIUM：`'['.repeat(100000)` 是合法 JSON，遞迴掃描會丟
 * `RangeError: Maximum call stack size exceeded`。它 fail-closed（請求沒送出），
 * 但一個防護不該以「當掉」作為拒絕的方式——錯誤訊息要說得出發生什麼事。
 */
test('過深的 body 以明確的拒絕收場，不是 RangeError', () => {
  const deep = JSON.parse('['.repeat(50000) + ']'.repeat(50000)) as unknown
  expect(() => assertNoElasticsearchScript(deep)).toThrow(ServerSideScriptRejection)
  expect(() => assertNoElasticsearchScript(deep)).toThrow(/nests deeper/)
})

test('一般深度的 body 不受深度上限影響', () => {
  const nested = JSON.parse('['.repeat(50) + ']'.repeat(50)) as unknown
  expect(() => assertNoElasticsearchScript(nested)).not.toThrow()
})

/**
 * 循環參照的 body 由深度上限接住，不需要另外記已訪節點——重點是它以一個
 * 說得出原因的拒絕收場，而不是 `RangeError`。目前只有函式庫呼叫端能手工建出
 * 這種物件（`JSON.parse` 產不出），而 `AdapterFactory` 已不在公共表面上。
 */
test('循環參照的 body 以明確的拒絕收場', () => {
  const cyclic: Record<string, unknown> = { x: 1 }
  cyclic.self = cyclic
  expect(() => assertNoElasticsearchScript(cyclic)).toThrow(ServerSideScriptRejection)
  expect(() => assertNoElasticsearchScript(cyclic)).toThrow(/nests deeper/)
})

/**
 * 第七輪 CRITICAL：`wrapper` query 把整段 query 放在 base64 字串裡，伺服器
 * 解碼後執行。掃描只走物件的**鍵**，碰不到字串內部——形狀比對再怎麼放寬都
 * 無效，因為 body 裡的鍵只有 `query` / `wrapper` / `query`。
 *
 * 後果不只是 oracle：`function_score.script_score` 把值算進 `_score`，
 * 於是每筆 hit 的 `_score` 就是黑名單欄位的數值原文，而 `_score` 不是受保護
 * 的鍵名，回應遮罩不會動它。同一條路也繞過黑名單詞比對——base64 裡沒有
 * 那個欄位名。
 *
 * 這與已經拒絕的「字串形式 body」和 `?source=` 是同一個原則：**dbcli 檢查不了
 * 的編碼 body 一律拒絕**，而不是教四個檢查各自去解一種編碼。
 */
describe('dbcli 檢查不了的編碼 body 一律拒絕', () => {
  test('攔截 wrapper query', () => {
    expect(() =>
      assertNoElasticsearchScript({
        query: {
          wrapper: {
            query:
              'eyJmdW5jdGlvbl9zY29yZSI6eyJzY3JpcHRfc2NvcmUiOnsic2NyaXB0Ijp7InNvdXJjZSI6ImRvY1snc2FsYXJ5J10udmFsdWUifX19fQ==',
          },
        },
      })
    ).toThrow(ServerSideScriptRejection)
  })

  test('攔截巢狀在 bool 裡的 wrapper', () => {
    expect(() =>
      assertNoElasticsearchScript({ query: { bool: { must: [{ wrapper: { query: 'e30=' } }] } } })
    ).toThrow(/wrapper/i)
  })

  test('錯誤訊息說得出為什麼——不是「含有 script」', () => {
    expect(() => assertNoElasticsearchScript({ query: { wrapper: { query: 'e30=' } } })).toThrow(
      /cannot be inspected|encoded/i
    )
  })

  test('欄位名剛好叫 wrapper 的一般查詢不受影響', () => {
    expect(() =>
      assertNoElasticsearchScript({ query: { match: { wrapper_type: 'carton' } } })
    ).not.toThrow()
  })
})

/**
 * 第七輪 HIGH（誤擋）：`_script` 後綴無條件成立時，`deploy_script` 這種一般
 * 欄位名在 query-only 的唯讀查詢上就被拒絕，訊息還說它「executes script code
 * on the cluster」——指著一個純資料欄位。`term` / `match` / `range` / `sort` /
 * `exists` 都把欄位名放在鍵的位置，正是掃描看的位置。
 */
describe('欄位名不因為以 _script 結尾就被當成 script 槽', () => {
  test.each([
    [{ query: { term: { deploy_script: 'x' } } }, 'term'],
    [{ sort: [{ build_script: 'asc' }] }, 'sort'],
    [{ query: { exists: { field: 'onboarding_script' } } }, 'exists'],
    [{ query: { range: { rollout_script: { gte: 1 } } } }, 'range'],
  ])('%#: %s 位置的一般欄位名放行', (body) => {
    expect(() => assertNoElasticsearchScript(body)).not.toThrow()
  })

  test('scripted_metric 底下的同名鍵仍然被擋', () => {
    expect(() =>
      assertNoElasticsearchScript({ aggs: { a: { scripted_metric: { map_script: 'x' } } } })
    ).toThrow(ServerSideScriptRejection)
  })

  test('其餘 script 載體靠內層字面 script 鍵接住', () => {
    for (const body of [
      { query: { function_score: { script_score: { script: { source: 'x' } } } } },
      { aggs: { a: { bucket_script: { script: 'params.a' } } } },
      { runtime_mappings: { f: { type: 'long', script: 'emit(1)' } } },
      { script: { source: "ctx._source.role='admin'" } },
    ]) {
      expect(() => assertNoElasticsearchScript(body)).toThrow(ServerSideScriptRejection)
    }
  })
})
