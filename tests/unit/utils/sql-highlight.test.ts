import { describe, test, expect } from 'bun:test'
import pc from 'picocolors'
import { highlightSQL } from '../../../src/utils/sql-highlight'

describe('highlightSQL', () => {
  test('highlights SQL keywords with blue bold', () => {
    const result = highlightSQL('SELECT id FROM users')
    expect(result).toContain(pc.blue(pc.bold('SELECT')))
    expect(result).toContain(pc.blue(pc.bold('FROM')))
    expect(result).toContain('id')
    expect(result).toContain('users')
  })

  test('highlights string literals with green', () => {
    const result = highlightSQL("WHERE name = 'Alice'")
    expect(result).toContain(pc.green("'Alice'"))
  })

  test('highlights numbers with yellow', () => {
    const result = highlightSQL('LIMIT 100')
    expect(result).toContain(pc.yellow('100'))
  })

  test('returns plain text when NO_COLOR is set', () => {
    const prev = process.env.NO_COLOR
    process.env.NO_COLOR = '1'
    try {
      const result = highlightSQL('SELECT 1')
      expect(result).toBe('SELECT 1')
    } finally {
      if (prev === undefined) {
        delete process.env.NO_COLOR
      } else {
        process.env.NO_COLOR = prev
      }
    }
  })

  test('handles empty string', () => {
    const result = highlightSQL('')
    expect(result).toBe('')
  })

  test('handles complex query with multiple keywords', () => {
    const sql =
      'SELECT u.id, u.name FROM users u JOIN orders o ON u.id = o.user_id WHERE o.total > 100'
    const result = highlightSQL(sql)
    expect(result).toContain('u.id')
    expect(result).toContain('u.name')
    expect(result).toContain(pc.blue(pc.bold('SELECT')))
    expect(result).toContain(pc.blue(pc.bold('JOIN')))
  })
})
