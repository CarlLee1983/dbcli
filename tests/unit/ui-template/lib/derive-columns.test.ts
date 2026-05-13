import { test, expect } from 'bun:test'
import { deriveColumns } from '../../../../src/ui-template/src/lib/derive-columns'

test('deriveColumns returns Object.keys of rows[0] for non-empty rows', () => {
  expect(deriveColumns([{ a: 1, b: 2, c: 3 }])).toEqual(['a', 'b', 'c'])
})

test('deriveColumns returns empty array for empty rows', () => {
  expect(deriveColumns([])).toEqual([])
})

test('deriveColumns returns single-column array for single-key row', () => {
  expect(deriveColumns([{ only: 'value' }])).toEqual(['only'])
})

test('deriveColumns preserves insertion order across keys', () => {
  const row: Record<string, unknown> = {}
  row.zebra = 1
  row.apple = 2
  row.mango = 3
  expect(deriveColumns([row])).toEqual(['zebra', 'apple', 'mango'])
})
