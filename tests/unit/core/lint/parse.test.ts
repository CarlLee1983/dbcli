import { describe, test, expect } from 'bun:test'
import { parseSingleStatement, ParseFailure } from '@/core/lint/parse'
import { collectTables, whereOf, findingSpan } from '@/core/lint/ast-utils'

describe('lint parse', () => {
  test('parses a single SELECT into an ast with type select', () => {
    const ast = parseSingleStatement('SELECT id FROM users WHERE id = 1', 'postgresql')
    expect((ast as { type?: string }).type).toBe('select')
  })

  test('accepts non-SELECT single statements (rules will no-op)', () => {
    const ast = parseSingleStatement("UPDATE users SET name = 'x' WHERE id = 1", 'mysql')
    expect((ast as { type?: string }).type).toBe('update')
  })

  test('throws ParseFailure on invalid SQL', () => {
    expect(() => parseSingleStatement('SELEC oops', 'postgresql')).toThrow(ParseFailure)
  })

  test('throws ParseFailure on multiple statements', () => {
    expect(() => parseSingleStatement('SELECT 1; SELECT 2', 'postgresql')).toThrow(ParseFailure)
  })

  test('collectTables returns FROM tables', () => {
    const ast = parseSingleStatement(
      'SELECT u.id FROM users u JOIN orders o ON o.user_id = u.id',
      'postgresql'
    )
    expect(collectTables(ast)).toEqual(['users', 'orders'])
  })

  test('whereOf returns the where node or null', () => {
    const ast = parseSingleStatement('SELECT id FROM users', 'postgresql')
    expect(whereOf(ast)).toBeNull()
  })

  test('findingSpan locates a fragment case-insensitively, else whole string', () => {
    expect(findingSpan('SELECT * FROM users', 'select *')).toEqual({ start: 0, end: 8 })
    expect(findingSpan('SELECT * FROM users', 'nope')).toEqual({ start: 0, end: 19 })
  })
})
