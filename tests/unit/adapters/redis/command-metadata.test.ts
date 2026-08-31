import { test, expect } from 'bun:test'
import { REDIS_COMMAND_TABLE, getCommandSpec } from '@/adapters/redis/command-metadata'

test('lookup is case-insensitive', () => {
  expect(getCommandSpec('get')).toEqual(getCommandSpec('GET'))
})

test('GET is unbounded read with single-key arity', () => {
  const spec = getCommandSpec('GET')!
  expect(spec.readOnly).toBe(true)
  expect(spec.sizeGuard.kind).toBe('unbounded')
  expect(spec.keyArity).toEqual({ kind: 'single', argIndex: 0 })
})

test('SCAN is rewrite-count read with no key', () => {
  const spec = getCommandSpec('SCAN')!
  expect(spec.sizeGuard.kind).toBe('rewrite-count')
})

test('HGETALL is truncate read with single key', () => {
  const spec = getCommandSpec('HGETALL')!
  expect(spec.sizeGuard.kind).toBe('truncate')
  expect(spec.keyArity).toEqual({ kind: 'single', argIndex: 0 })
})

test('MGET has multi-variable key arity', () => {
  const spec = getCommandSpec('MGET')!
  expect(spec.keyArity).toEqual({ kind: 'multi-variable', startIndex: 0, step: 1 })
})

test('LRANGE rewrites stop arg', () => {
  const spec = getCommandSpec('LRANGE')!
  expect(spec.sizeGuard).toEqual({ kind: 'rewrite-stop', argIndex: 2 })
})

test('FLUSHDB is a reject with no read-only claim', () => {
  const spec = getCommandSpec('FLUSHDB')!
  expect(spec.sizeGuard.kind).toBe('reject')
  expect(spec.readOnly).toBe(false)
})

test('unknown commands return undefined', () => {
  expect(getCommandSpec('NONSENSE')).toBeUndefined()
})

test('the table carries no permission tier of its own', () => {
  // The tier has one owner, `REDIS_COMMAND_PERMISSION`. A second copy here went
  // unenforced and drifted on five commands — `KEYS` and `INFO` were recorded
  // as `query-only` while the enforcing map required `admin`, and the type
  // could not spell `data-admin` at all, so `DEL` read as `read-write`.
  for (const spec of Object.values(REDIS_COMMAND_TABLE)) {
    expect(spec).not.toHaveProperty('permissionTier')
  }
})
