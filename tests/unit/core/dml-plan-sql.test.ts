import { describe, expect, test } from 'bun:test'
import { buildInsertPlanSql, buildUpdatePlanSql } from '@/core/dml-plan-sql'

describe('buildInsertPlanSql', () => {
  test('produces INSERT SQL with placeholders for each provided column', () => {
    expect(buildInsertPlanSql('users', { name: 'Alice', email: 'a@example.com' })).toBe(
      'INSERT INTO users (name, email) VALUES (?, ?)'
    )
  })

  test('preserves column order from object key insertion order', () => {
    expect(buildInsertPlanSql('orders', { id: 1, total: 99, currency: 'USD' })).toBe(
      'INSERT INTO orders (id, total, currency) VALUES (?, ?, ?)'
    )
  })

  test('does not embed any user values', () => {
    const sql = buildInsertPlanSql('users', {
      email: "robert'); DROP TABLE users; --",
      bio: 'multi\nline',
    })
    expect(sql).toBe('INSERT INTO users (email, bio) VALUES (?, ?)')
    expect(sql).not.toContain('DROP')
    expect(sql).not.toContain('robert')
  })

  test('rejects empty table name', () => {
    expect(() => buildInsertPlanSql('', { name: 'Alice' })).toThrow(/table name/i)
    expect(() => buildInsertPlanSql('   ', { name: 'Alice' })).toThrow(/table name/i)
  })

  test('rejects empty data object', () => {
    expect(() => buildInsertPlanSql('users', {})).toThrow(/at least one column/i)
  })

  test('rejects invalid table identifier', () => {
    expect(() => buildInsertPlanSql('users; DROP', { name: 'Alice' })).toThrow(/identifier/i)
    expect(() => buildInsertPlanSql('1users', { name: 'Alice' })).toThrow(/identifier/i)
  })

  test('rejects invalid column identifier', () => {
    expect(() => buildInsertPlanSql('users', { 'bad name': 'x' })).toThrow(/identifier/i)
    expect(() => buildInsertPlanSql('users', { '': 'x' })).toThrow(/identifier/i)
  })
})

describe('buildUpdatePlanSql', () => {
  test('produces UPDATE SQL with SET and WHERE placeholders', () => {
    expect(buildUpdatePlanSql('users', { status: 'inactive' }, { id: 1 })).toBe(
      'UPDATE users SET status = ? WHERE id = ?'
    )
  })

  test('joins multi-column SET and AND-joined WHERE', () => {
    expect(
      buildUpdatePlanSql(
        'users',
        { name: 'Bob', email: 'b@example.com' },
        { id: 1, tenant: 'acme' }
      )
    ).toBe('UPDATE users SET name = ?, email = ? WHERE id = ? AND tenant = ?')
  })

  test('does not embed user values in SET or WHERE', () => {
    const sql = buildUpdatePlanSql(
      'users',
      { bio: "evil'; DROP TABLE users; --" },
      { id: '1 OR 1=1' }
    )
    expect(sql).toBe('UPDATE users SET bio = ? WHERE id = ?')
    expect(sql).not.toContain('DROP')
    expect(sql).not.toContain('OR 1=1')
  })

  test('rejects empty table, empty SET, empty WHERE', () => {
    expect(() => buildUpdatePlanSql('', { x: 1 }, { id: 1 })).toThrow(/table name/i)
    expect(() => buildUpdatePlanSql('users', {}, { id: 1 })).toThrow(/at least one column/i)
    expect(() => buildUpdatePlanSql('users', { x: 1 }, {})).toThrow(/WHERE/i)
  })

  test('rejects invalid identifiers in SET or WHERE', () => {
    expect(() => buildUpdatePlanSql('users', { 'bad col': 1 }, { id: 1 })).toThrow(/identifier/i)
    expect(() => buildUpdatePlanSql('users', { name: 'x' }, { 'bad col': 1 })).toThrow(
      /identifier/i
    )
  })
})
