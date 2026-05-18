import { describe, test, expect } from 'bun:test'
import { maskMongoRows } from '@/core/mongo/field-masker'

// End-to-end coverage lives in tests/integration/mongo-blacklist-nested.test.ts.
// This test pins the import contract so future refactors do not silently drop masking.
describe('query.ts mongo masking contract', () => {
  test('maskMongoRows is the function callers must use', () => {
    expect(typeof maskMongoRows).toBe('function')
  })
})
