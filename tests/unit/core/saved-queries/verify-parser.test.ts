import { test, expect, describe } from 'bun:test'
import { parseSavedQuery } from '../../../../src/core/saved-queries/parser'
import { type ParseInput } from '../../../../src/core/saved-queries/parser'
import { evaluateExpectation } from '../../../../src/commands/q'

describe('Saved Query Verify Parser', () => {
  test('extracts verify metadata correctly', () => {
    const input: ParseInput = {
      key: '@test',
      file: 'test.sql',
      source: 'local',
      text: `-- ---
-- name: Test Verify
-- verify:
--   query: "SELECT COUNT(*) AS cnt FROM users"
--   expects: "cnt > 0"
-- ---
SELECT * FROM users`,
    }

    const { query } = parseSavedQuery(input)
    const verify = query.meta.verify

    expect(verify).toBeDefined()
    expect(verify?.query).toBe('SELECT COUNT(*) AS cnt FROM users')
    expect(verify?.expects).toBe('cnt > 0')
  })

  test('handles missing verify metadata gracefully', () => {
    const input: ParseInput = {
      key: '@test-no-verify',
      file: 'test.sql',
      source: 'local',
      text: `-- ---
-- name: No Verify
-- ---
SELECT 1`,
    }

    const { query } = parseSavedQuery(input)
    expect(query.meta.verify).toBeUndefined()
  })

  test('rejects invalid verify schema (not a map)', () => {
    const input: ParseInput = {
      key: '@test-invalid',
      file: 'test.sql',
      source: 'local',
      text: `-- ---
-- verify: "should be a map"
-- ---
SELECT 1`,
    }

    expect(() => parseSavedQuery(input)).toThrow(/must be a map/)
  })

  test('rejects missing or empty verify query', () => {
    const input: ParseInput = {
      key: '@test-missing-query',
      file: 'test.sql',
      source: 'local',
      text: `-- ---
-- verify:
--   expects: "cnt > 0"
-- ---
SELECT 1`,
    }

    expect(() => parseSavedQuery(input)).toThrow(/verify\.query/)
  })

  test('rejects missing or empty verify expects', () => {
    const input: ParseInput = {
      key: '@test-missing-expects',
      file: 'test.sql',
      source: 'local',
      text: `-- ---
-- verify:
--   query: "SELECT 1"
-- ---
SELECT 1`,
    }

    expect(() => parseSavedQuery(input)).toThrow(/verify\.expects/)
  })
})

describe('evaluateExpectation', () => {
  test('evaluates numeric comparisons', () => {
    const row = { cnt: 10 }
    expect(evaluateExpectation(row, 'cnt > 0').success).toBe(true)
    expect(evaluateExpectation(row, 'cnt >= 10').success).toBe(true)
    expect(evaluateExpectation(row, 'cnt < 100').success).toBe(true)
    expect(evaluateExpectation(row, 'cnt <= 10').success).toBe(true)
    expect(evaluateExpectation(row, 'cnt == 10').success).toBe(true)
    expect(evaluateExpectation(row, 'cnt = 10').success).toBe(true)
    expect(evaluateExpectation(row, 'cnt != 5').success).toBe(true)

    expect(evaluateExpectation(row, 'cnt > 20').success).toBe(false)
  })

  test('evaluates string comparisons (with and without quotes)', () => {
    const row = { status: 'completed' }
    expect(evaluateExpectation(row, "status = 'completed'").success).toBe(true)
    expect(evaluateExpectation(row, 'status == "completed"').success).toBe(true)
    expect(evaluateExpectation(row, 'status = completed').success).toBe(true)
    expect(evaluateExpectation(row, 'status != failed').success).toBe(true)

    expect(evaluateExpectation(row, 'status = active').success).toBe(false)
  })

  test('evaluates boolean comparisons', () => {
    const row = { active: true }
    expect(evaluateExpectation(row, 'active = true').success).toBe(true)
    expect(evaluateExpectation(row, 'active != false').success).toBe(true)
  })

  test('evaluates null comparisons', () => {
    const row = { deleted_at: null }
    expect(evaluateExpectation(row, 'deleted_at = null').success).toBe(true)
  })

  test('handles missing column error gracefully', () => {
    const row = { cnt: 10 }
    const result = evaluateExpectation(row, 'total > 0')
    expect(result.success).toBe(false)
    expect(result.error).toContain("Column 'total' not found")
  })

  test('handles invalid expression format gracefully', () => {
    const row = { cnt: 10 }
    const result = evaluateExpectation(row, 'invalid-expression')
    expect(result.success).toBe(false)
    expect(result.error).toContain('Invalid expects format')
  })

  test('handles empty row gracefully', () => {
    const result = evaluateExpectation(undefined, 'cnt > 0')
    expect(result.success).toBe(false)
    expect(result.error).toContain('No rows returned')
  })
})
