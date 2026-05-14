import { describe, expect, test } from 'bun:test'
import { buildInsertPlanSql } from '@/core/dml-plan-sql'

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
