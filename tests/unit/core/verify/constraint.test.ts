import { describe, test, expect } from 'bun:test'
import {
  normalizeConstraintCheck,
  normalizeConstraintInput,
} from '@/core/verify/constraint'
import { VerifyInputError } from '@/core/verify/scenario'

describe('normalizeConstraintCheck', () => {
  test('accepts the four supported checks', () => {
    expect(normalizeConstraintCheck('fk')).toBe('fk')
    expect(normalizeConstraintCheck('not-null')).toBe('not-null')
    expect(normalizeConstraintCheck('unique')).toBe('unique')
    expect(normalizeConstraintCheck('custom')).toBe('custom')
  })
  test('rejects missing or unsupported checks', () => {
    expect(() => normalizeConstraintCheck(undefined)).toThrow(VerifyInputError)
    expect(() => normalizeConstraintCheck('FK')).toThrow(VerifyInputError)
    expect(() => normalizeConstraintCheck('check')).toThrow(VerifyInputError)
  })
})

describe('normalizeConstraintInput', () => {
  test('fk requires exactly one column and a parseable --references', () => {
    const input = normalizeConstraintInput({
      check: 'fk',
      table: 'orders',
      column: ['user_id'],
      references: 'users.id',
    })
    expect(input.columns).toEqual(['user_id'])
    expect(input.references).toEqual({ table: 'users', column: 'id' })
    expect(() =>
      normalizeConstraintInput({ check: 'fk', table: 'orders', column: ['a', 'b'], references: 'users.id' })
    ).toThrow(VerifyInputError)
    expect(() =>
      normalizeConstraintInput({ check: 'fk', table: 'orders', column: ['user_id'] })
    ).toThrow(VerifyInputError)
    expect(() =>
      normalizeConstraintInput({ check: 'fk', table: 'orders', column: ['user_id'], references: 'usersid' })
    ).toThrow(VerifyInputError)
  })
  test('not-null / unique require at least one column and forbid references/violation-query', () => {
    expect(normalizeConstraintInput({ check: 'not-null', table: 'users', column: ['email'] }).columns).toEqual([
      'email',
    ])
    expect(normalizeConstraintInput({ check: 'unique', table: 'm', column: ['a', 'b'] }).columns).toEqual([
      'a',
      'b',
    ])
    expect(() => normalizeConstraintInput({ check: 'not-null', table: 'users' })).toThrow(VerifyInputError)
    expect(() =>
      normalizeConstraintInput({ check: 'unique', table: 'm', column: ['a'], violationQuery: 'SELECT 1' })
    ).toThrow(VerifyInputError)
  })
  test('custom requires --violation-query and forbids columns/references', () => {
    const input = normalizeConstraintInput({
      check: 'custom',
      table: 'users',
      violationQuery: 'SELECT COUNT(*) AS violation_count FROM users WHERE x',
    })
    expect(input.violationQuery).toContain('violation_count')
    expect(input.columns).toEqual([])
    expect(() => normalizeConstraintInput({ check: 'custom', table: 'users' })).toThrow(VerifyInputError)
    expect(() =>
      normalizeConstraintInput({ check: 'custom', table: 'users', violationQuery: 'SELECT 1', column: ['x'] })
    ).toThrow(VerifyInputError)
  })
  test('baseline parses a non-negative integer (default 0); allowPreexisting defaults false', () => {
    const a = normalizeConstraintInput({ check: 'not-null', table: 'users', column: ['email'] })
    expect(a.baseline).toBe(0)
    expect(a.allowPreexisting).toBe(false)
    const b = normalizeConstraintInput({
      check: 'not-null',
      table: 'users',
      column: ['email'],
      allowPreexisting: true,
      baseline: '5',
    })
    expect(b.baseline).toBe(5)
    expect(b.allowPreexisting).toBe(true)
    expect(() =>
      normalizeConstraintInput({ check: 'not-null', table: 'users', column: ['email'], baseline: '-1' })
    ).toThrow(VerifyInputError)
    expect(() =>
      normalizeConstraintInput({ check: 'not-null', table: 'users', column: ['email'], baseline: 'x' })
    ).toThrow(VerifyInputError)
  })
  test('defaults format=table and afterWrite=false', () => {
    const input = normalizeConstraintInput({ check: 'not-null', table: 'users', column: ['email'] })
    expect(input.format).toBe('table')
    expect(input.afterWrite).toBe(false)
  })
})
