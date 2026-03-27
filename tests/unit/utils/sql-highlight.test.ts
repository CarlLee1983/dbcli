import { describe, test, expect, afterEach } from 'vitest'
import { highlightSQL } from '../../../src/utils/sql-highlight'

describe('highlightSQL', () => {
  const originalNoColor = process.env.NO_COLOR

  afterEach(() => {
    if (originalNoColor === undefined) {
      delete process.env.NO_COLOR
    } else {
      process.env.NO_COLOR = originalNoColor
    }
  })

  test('highlights SQL keywords', () => {
    delete process.env.NO_COLOR
    const result = highlightSQL('SELECT id FROM users')
    expect(result).toContain('id')
    expect(result).toContain('users')
    expect(result).not.toBe('SELECT id FROM users')
  })

  test('highlights string literals in green', () => {
    delete process.env.NO_COLOR
    const result = highlightSQL("WHERE name = 'Alice'")
    expect(result).toContain('Alice')
    expect(result).not.toBe("WHERE name = 'Alice'")
  })

  test('highlights numbers in yellow', () => {
    delete process.env.NO_COLOR
    const result = highlightSQL('LIMIT 100')
    expect(result).toContain('100')
    expect(result).not.toBe('LIMIT 100')
  })

  test('returns plain text when NO_COLOR is set', () => {
    process.env.NO_COLOR = '1'
    const result = highlightSQL('SELECT 1')
    expect(result).toBe('SELECT 1')
  })

  test('handles empty string', () => {
    const result = highlightSQL('')
    expect(result).toBe('')
  })

  test('handles complex query with multiple keywords', () => {
    delete process.env.NO_COLOR
    const sql = "SELECT u.id, u.name FROM users u JOIN orders o ON u.id = o.user_id WHERE o.total > 100"
    const result = highlightSQL(sql)
    expect(result).toContain('u.id')
    expect(result).toContain('u.name')
  })
})
