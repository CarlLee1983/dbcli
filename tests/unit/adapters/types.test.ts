import { test, expect } from 'bun:test'
import type { ExecutionResult, RedisWarning } from '@/adapters/types'

test('ExecutionResult.warnings is optional', () => {
  const r: ExecutionResult<unknown> = { rows: [], affectedRows: 0 }
  expect(r.warnings).toBeUndefined()
})

test('RedisWarning union covers rewrite/truncate/blacklist-filtered', () => {
  const w1: RedisWarning = {
    code: 'REDIS_SIZE_REWRITE',
    command: 'SCAN',
    original: ['0'],
    rewritten: ['0', 'COUNT', '1000'],
  }
  const w2: RedisWarning = {
    code: 'REDIS_SIZE_TRUNCATE',
    command: 'HGETALL',
    kept: 1000,
    droppedAtLeast: 1,
  }
  const w3: RedisWarning = { code: 'REDIS_BLACKLIST_FILTERED', count: 3 }
  expect([w1.code, w2.code, w3.code]).toEqual([
    'REDIS_SIZE_REWRITE',
    'REDIS_SIZE_TRUNCATE',
    'REDIS_BLACKLIST_FILTERED',
  ])
})
