// tests/unit/commands/guide-missing-index.test.ts
import { test, expect } from 'bun:test'
import { resolveSingleQuery } from '@/commands/guide-missing-index'

test('returns raw SQL unchanged when not an @reference', async () => {
  const sql = await resolveSingleQuery('SELECT 1 FROM t', async () => null)
  expect(sql).toBe('SELECT 1 FROM t')
})

test('resolves a @saved-query to its SQL body', async () => {
  const loader = async (name: string) =>
    name === 'analytics/live' ? [{ name, sql: 'SELECT * FROM live' }] : null
  const sql = await resolveSingleQuery('@analytics/live', loader)
  expect(sql).toBe('SELECT * FROM live')
})

test('throws when @saved-query is not found', async () => {
  await expect(resolveSingleQuery('@nope', async () => null)).rejects.toThrow(/not found/i)
})

test('throws when no query is provided', async () => {
  await expect(resolveSingleQuery('', async () => null)).rejects.toThrow(/no query/i)
})
