import { test, expect } from 'bun:test'
import { resolveKpi } from '../../../../src/ui-template/src/lib/resolve-kpi'

test('resolveKpi returns formatted currency value when rows[0] has the column', () => {
  const rows = [{ revenue: 1000 }]
  expect(resolveKpi(rows, { label: 'Total', value_column: 'revenue', format: 'currency' })).toBe(
    '$1,000.00'
  )
})

test('resolveKpi returns null when rows is empty', () => {
  expect(resolveKpi([], { label: 'X', value_column: 'foo' })).toBe(null)
})

test('resolveKpi returns null when rows[0] is missing the column', () => {
  expect(resolveKpi([{ other: 1 }], { label: 'X', value_column: 'missing' })).toBe(null)
})

test('resolveKpi returns null when value is explicitly null (formatValue passthrough)', () => {
  expect(resolveKpi([{ x: null }], { label: 'X', value_column: 'x' })).toBe(null)
})

test('resolveKpi passes through string value when no format provided', () => {
  expect(resolveKpi([{ name: 'Alice' }], { label: 'Name', value_column: 'name' })).toBe('Alice')
})

test('resolveKpi forwards number format to formatValue', () => {
  expect(
    resolveKpi([{ count: 1500 }], { label: 'C', value_column: 'count', format: 'number' })
  ).toBe('1,500')
})
