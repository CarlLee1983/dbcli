import { test, expect } from 'bun:test'
import { maskRedisRows } from '@/adapters/redis/value-masker'
import type { RedisMaskRule } from '@/types/blacklist'

const REDACTED = '[REDACTED]'

test('whole-value mask: GET on matched key redacts value', () => {
  const rules: RedisMaskRule[] = [{ keyPattern: 'secret:*' }]
  const rows = [{ value: 'hunter2' }]
  const out = maskRedisRows('GET', ['secret:pw'], rows, rules)
  expect(out).toEqual([{ value: REDACTED }])
})

test('no rules → rows unchanged', () => {
  const rows = [{ value: 'plain' }]
  expect(maskRedisRows('GET', ['k'], rows, [])).toEqual([{ value: 'plain' }])
})

test('non-matching key → unchanged', () => {
  const rules: RedisMaskRule[] = [{ keyPattern: 'secret:*' }]
  const rows = [{ value: 'plain' }]
  expect(maskRedisRows('GET', ['public:x'], rows, rules)).toEqual([{ value: 'plain' }])
})

test('HGETALL field mask: only named fields redacted', () => {
  const rules: RedisMaskRule[] = [{ keyPattern: 'user:*', fields: ['password', 'token'] }]
  const rows = [{ name: 'alice', password: 'hunter2', token: 'abc', age: '30' }]
  const out = maskRedisRows('HGETALL', ['user:1'], rows, rules)
  expect(out).toEqual([{ name: 'alice', password: REDACTED, token: REDACTED, age: '30' }])
})

test('HGETALL whole-value (no fields) redacts every field value', () => {
  const rules: RedisMaskRule[] = [{ keyPattern: 'user:*' }]
  const rows = [{ name: 'alice', password: 'hunter2' }]
  const out = maskRedisRows('HGETALL', ['user:1'], rows, rules)
  expect(out).toEqual([{ name: REDACTED, password: REDACTED }])
})
