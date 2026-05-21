import { test, expect } from 'bun:test'
import { scrollAll } from '@/adapters/elasticsearch/scroll-reader'

function fakeAdapter() {
  const batches = [
    { _scroll_id: 's1', hits: { hits: [{ _id: '1', _source: { a: 1 } }, { _id: '2', _source: { a: 2 } }] } },
    { _scroll_id: 's2', hits: { hits: [{ _id: '3', _source: { a: 3 } }] } },
    { _scroll_id: 's3', hits: { hits: [] } },
  ]
  let call = 0
  const requests: { method: string; path: string }[] = []
  return {
    requests,
    request: async (method: string, path: string) => {
      requests.push({ method, path })
      return batches[Math.min(call++, batches.length - 1)]
    },
  }
}

test('scrollAll pulls all batches until empty, honoring cap', async () => {
  const adapter = fakeAdapter()
  const rows = await scrollAll(adapter as never, 'idx', 10)
  expect(rows.map((r) => r._id)).toEqual(['1', '2', '3'])
})

test('scrollAll stops at the cap', async () => {
  const adapter = fakeAdapter()
  const rows = await scrollAll(adapter as never, 'idx', 2)
  expect(rows).toHaveLength(2)
})
