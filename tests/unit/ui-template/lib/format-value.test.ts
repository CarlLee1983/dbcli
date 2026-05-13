import { test, expect } from 'bun:test'
import { formatValue, type ValueFormat } from '../../../../src/ui-template/src/lib/format-value'

test('formatValue returns USD currency string when format=currency', () => {
  expect(formatValue(1234.5, 'currency')).toBe('$1,234.50')
})

test('formatValue returns en-US percent string when format=percent (val divided by 100)', () => {
  expect(formatValue(50, 'percent')).toBe('50.0%')
})

test('formatValue returns en-US number string when format=number', () => {
  expect(formatValue(1234567, 'number')).toBe('1,234,567')
})

test('formatValue returns raw number when no format provided', () => {
  expect(formatValue(42)).toBe(42)
})

test('formatValue returns raw number when format is unknown', () => {
  // JSON payloads may carry unsupported format strings at runtime; we
  // intentionally bypass the literal type to assert the runtime fallback.
  expect(formatValue(42, 'unknown' as unknown as ValueFormat)).toBe(42)
})

test('formatValue passes through string when val is not a number', () => {
  expect(formatValue('hello', 'currency')).toBe('hello')
})

test('formatValue passes through null when val is null', () => {
  expect(formatValue(null, 'currency')).toBe(null)
})

test('formatValue passes through undefined when val is undefined', () => {
  expect(formatValue(undefined, 'percent')).toBe(undefined)
})
