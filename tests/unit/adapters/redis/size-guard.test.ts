import { test, expect } from 'bun:test'
import { rewriteArgs, truncateResult } from '@/adapters/redis/size-guard'

test('SCAN with no COUNT gets COUNT 1000 injected', () => {
  const r = rewriteArgs('SCAN', ['0'], { noLimit: false })
  expect(r.rewritten).toEqual(['0', 'COUNT', '1000'])
  expect(r.warning).toEqual({
    code: 'REDIS_SIZE_REWRITE',
    command: 'SCAN',
    original: ['0'],
    rewritten: ['0', 'COUNT', '1000'],
  })
})

test('SCAN with COUNT > limit is capped', () => {
  const r = rewriteArgs('SCAN', ['0', 'COUNT', '5000'], { noLimit: false })
  expect(r.rewritten).toEqual(['0', 'COUNT', '1000'])
  expect(r.warning).not.toBeUndefined()
})

test('SCAN with COUNT <= limit is unchanged', () => {
  const r = rewriteArgs('SCAN', ['0', 'COUNT', '500'], { noLimit: false })
  expect(r.rewritten).toEqual(['0', 'COUNT', '500'])
  expect(r.warning).toBeUndefined()
})

test('LRANGE k 0 -1 is clamped to k 0 999', () => {
  const r = rewriteArgs('LRANGE', ['k', '0', '-1'], { noLimit: false })
  expect(r.rewritten).toEqual(['k', '0', '999'])
})

test('LRANGE k 100 200 is unchanged (within budget)', () => {
  const r = rewriteArgs('LRANGE', ['k', '100', '200'], { noLimit: false })
  expect(r.rewritten).toEqual(['k', '100', '200'])
  expect(r.warning).toBeUndefined()
})

test('LRANGE k 0 5000 is clamped to k 0 999', () => {
  const r = rewriteArgs('LRANGE', ['k', '0', '5000'], { noLimit: false })
  expect(r.rewritten).toEqual(['k', '0', '999'])
})

test('ZRANGEBYSCORE without LIMIT gets LIMIT 0 1000 appended', () => {
  const r = rewriteArgs('ZRANGEBYSCORE', ['k', '-inf', '+inf'], { noLimit: false })
  expect(r.rewritten).toEqual(['k', '-inf', '+inf', 'LIMIT', '0', '1000'])
})

test('--no-limit bypasses all rewrites', () => {
  const r = rewriteArgs('SCAN', ['0'], { noLimit: true })
  expect(r.rewritten).toEqual(['0'])
  expect(r.warning).toBeUndefined()
})

test('unbounded commands pass through', () => {
  const r = rewriteArgs('GET', ['k'], { noLimit: false })
  expect(r.rewritten).toEqual(['k'])
  expect(r.warning).toBeUndefined()
})

test('truncate-strategy commands pass through rewrite', () => {
  const r = rewriteArgs('HGETALL', ['h'], { noLimit: false })
  expect(r.rewritten).toEqual(['h'])
  expect(r.warning).toBeUndefined()
})

test('HGETALL with ≤1000 fields passes through', () => {
  const reply = { a: '1', b: '2' }
  const r = truncateResult('HGETALL', reply, { noLimit: false })
  expect(r.value).toEqual(reply)
  expect(r.warning).toBeUndefined()
})

test('HGETALL with >1000 fields is truncated', () => {
  const reply: Record<string, string> = {}
  for (let i = 0; i < 1500; i++) reply[`k${i}`] = String(i)
  const r = truncateResult('HGETALL', reply, { noLimit: false })
  expect(Object.keys(r.value as Record<string, unknown>).length).toBe(1000)
  expect(r.warning).toEqual({
    code: 'REDIS_SIZE_TRUNCATE',
    command: 'HGETALL',
    kept: 1000,
    droppedAtLeast: 500,
  })
})

test('SMEMBERS array truncates', () => {
  const reply = Array.from({ length: 2000 }, (_, i) => `m${i}`)
  const r = truncateResult('SMEMBERS', reply, { noLimit: false })
  expect((r.value as string[]).length).toBe(1000)
  expect(r.warning?.code).toBe('REDIS_SIZE_TRUNCATE')
})

test('KEYS array truncates', () => {
  const reply = Array.from({ length: 1200 }, (_, i) => `k${i}`)
  const r = truncateResult('KEYS', reply, { noLimit: false })
  expect((r.value as string[]).length).toBe(1000)
})

test('--no-limit skips truncate', () => {
  const reply = Array.from({ length: 5000 }, (_, i) => `x${i}`)
  const r = truncateResult('SMEMBERS', reply, { noLimit: true })
  expect((r.value as string[]).length).toBe(5000)
  expect(r.warning).toBeUndefined()
})

test('rewrite-strategy commands pass through truncate', () => {
  const reply = Array.from({ length: 5000 }, (_, i) => `x${i}`)
  const r = truncateResult('SCAN', reply, { noLimit: false })
  expect(r.warning).toBeUndefined()
})
