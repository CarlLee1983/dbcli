/**
 * Server-side script 防護（#47）
 *
 * `$where` 與 ES 的 `script` 讓查詢在伺服器上跑任意程式碼——這是查詢介面上
 * 最接近 RCE 的東西。檢查點必須在 adapter，否則每新增一條呼叫路徑就等於新增
 * 一個繞道。
 */

import { describe, test, expect } from 'bun:test'
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
