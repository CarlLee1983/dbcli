/**
 * `dbcli schema <table>` should attach fuzzy-match suggestions when the
 * underlying TABLE_NOT_FOUND error fires.
 */
import { test, expect } from 'bun:test'
import { ConnectionError } from '@/adapters/error-mapper'
import { attachTableSuggestions } from '@/commands/schema'
import type { DatabaseAdapter } from '@/adapters/types'

function mockAdapterWithTables(tables: string[]): DatabaseAdapter {
  return {
    connect: async () => {},
    disconnect: async () => {},
    execute: async <T = Record<string, unknown>>() => ({ rows: [] as T[], affectedRows: 0 }),
    listTables: async () =>
      tables.map((name) => ({
        name,
        columns: [],
        rowCount: 0,
        primaryKey: undefined,
        foreignKeys: [],
      })),
    getTableSchema: async () => {
      throw new ConnectionError('TABLE_NOT_FOUND', "Table 'bets' not found", [
        'Run `dbcli list` to see available tables',
      ])
    },
    testConnection: async () => true,
    getServerVersion: async () => 'test',
  }
}

test('attachTableSuggestions appends top-3 fuzzy candidates to hints', async () => {
  // 'bet' and 'best' have Levenshtein distance < 3 from 'bets'; 'orders'/'users' do not
  const adapter = mockAdapterWithTables(['bet', 'best', 'orders', 'users'])
  const baseErr = new ConnectionError('TABLE_NOT_FOUND', "Table 'bets' not found", [
    'Run `dbcli list` to see available tables',
  ])
  const enriched = await attachTableSuggestions(baseErr, adapter, 'bets')
  expect(enriched.hints.some((h) => h.includes('Did you mean'))).toBe(true)
  const suggestionLine = enriched.hints.find((h) => h.includes('Did you mean')) || ''
  expect(suggestionLine).toMatch(/bet/i)
})

test('attachTableSuggestions returns original error when no close matches', async () => {
  const adapter = mockAdapterWithTables(['users', 'orders', 'payments'])
  const baseErr = new ConnectionError('TABLE_NOT_FOUND', "Table 'xyz123' not found", [
    'Run `dbcli list` to see available tables',
  ])
  const enriched = await attachTableSuggestions(baseErr, adapter, 'xyz123')
  expect(enriched.hints.some((h) => h.includes('Did you mean'))).toBe(false)
})

test('attachTableSuggestions is a no-op for non-TABLE_NOT_FOUND errors', async () => {
  const adapter = mockAdapterWithTables(['users'])
  const baseErr = new ConnectionError('UNKNOWN', 'something else', ['hint'])
  const enriched = await attachTableSuggestions(baseErr, adapter, 'anything')
  expect(enriched).toBe(baseErr)
})
