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

test('FLUSHDB is admin reject', () => {
  const spec = getCommandSpec('FLUSHDB')!
  expect(spec.sizeGuard.kind).toBe('reject')
  expect(spec.permissionTier).toBe('admin')
  expect(spec.readOnly).toBe(false)
})

test('unknown commands return undefined', () => {
  expect(getCommandSpec('NONSENSE')).toBeUndefined()
})

test('every entry in the table has a valid permissionTier', () => {
  const valid = new Set(['query-only', 'read-write', 'admin'])
  for (const spec of Object.values(REDIS_COMMAND_TABLE)) {
    expect(valid.has(spec.permissionTier)).toBe(true)
  }
})
