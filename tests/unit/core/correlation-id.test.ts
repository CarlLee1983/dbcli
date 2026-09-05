import { afterEach, expect, test } from 'bun:test'
import {
  getGlobalCorrelationId,
  isCorrelationId,
  setGlobalCorrelationId,
} from '@/core/correlation-id'

afterEach(() => setGlobalCorrelationId(undefined))

test('stores only bounded correlation IDs', () => {
  expect(isCorrelationId('INC-2026.09.05')).toBe(true)
  expect(isCorrelationId('../../secret')).toBe(false)

  setGlobalCorrelationId('INC-2026.09.05')
  expect(getGlobalCorrelationId()).toBe('INC-2026.09.05')
  expect(() => setGlobalCorrelationId('../../secret')).toThrow('Invalid correlation ID')
})
