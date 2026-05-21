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

test('HGET masks when requested field is listed', () => {
  const rules: RedisMaskRule[] = [{ keyPattern: 'user:*', fields: ['password'] }]
  const masked = maskRedisRows('HGET', ['user:1', 'password'], [{ value: 'hunter2' }], rules)
  expect(masked).toEqual([{ value: REDACTED }])
  const kept = maskRedisRows('HGET', ['user:1', 'name'], [{ value: 'alice' }], rules)
  expect(kept).toEqual([{ value: 'alice' }])
})

test('HMGET masks per-field by position', () => {
  const rules: RedisMaskRule[] = [{ keyPattern: 'user:*', fields: ['password'] }]
  const rows = [
    { index: 0, value: 'alice' },
    { index: 1, value: 'hunter2' },
  ]
  const out = maskRedisRows('HMGET', ['user:1', 'name', 'password'], rows, rules)
  expect(out).toEqual([
    { index: 0, value: 'alice' },
    { index: 1, value: REDACTED },
  ])
})

test('HVALS only honors whole-value rules', () => {
  const rows = [{ index: 0, value: 'a' }, { index: 1, value: 'b' }]
  const fieldRule: RedisMaskRule[] = [{ keyPattern: 'user:*', fields: ['password'] }]
  expect(maskRedisRows('HVALS', ['user:1'], rows, fieldRule)).toEqual(rows)
  const wholeRule: RedisMaskRule[] = [{ keyPattern: 'user:*' }]
  expect(maskRedisRows('HVALS', ['user:1'], rows, wholeRule)).toEqual([
    { index: 0, value: REDACTED },
    { index: 1, value: REDACTED },
  ])
})
