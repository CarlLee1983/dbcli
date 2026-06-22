import { describe, test, expect } from 'bun:test'
import {
  quoteIdent,
  buildFkViolationQuery,
  buildNotNullViolationQuery,
  buildUniqueViolationQuery,
} from '@/core/verify/constraint-query'

describe('quoteIdent', () => {
  test('double-quotes for postgresql, escaping embedded quotes', () => {
    expect(quoteIdent('user_id', 'postgresql')).toBe('"user_id"')
    expect(quoteIdent('weird"name', 'postgresql')).toBe('"weird""name"')
  })
  test('backticks for mysql/mariadb, escaping embedded backticks', () => {
    expect(quoteIdent('user id', 'mysql')).toBe('`user id`')
    expect(quoteIdent('a`b', 'mariadb')).toBe('`a``b`')
  })
  test('quotes each segment of a qualified name', () => {
    expect(quoteIdent('public.users', 'postgresql')).toBe('"public"."users"')
  })
})

describe('buildNotNullViolationQuery', () => {
  test('single column', () => {
    expect(buildNotNullViolationQuery({ engine: 'postgresql', table: 'users', columns: ['email'] })).toBe(
      'SELECT COUNT(*) AS violation_count FROM "users" WHERE "email" IS NULL'
    )
  })
  test('multiple columns OR-joined', () => {
    expect(
      buildNotNullViolationQuery({ engine: 'postgresql', table: 'users', columns: ['email', 'name'] })
    ).toBe('SELECT COUNT(*) AS violation_count FROM "users" WHERE "email" IS NULL OR "name" IS NULL')
  })
})

describe('buildUniqueViolationQuery', () => {
  test('composite key', () => {
    expect(
      buildUniqueViolationQuery({ engine: 'postgresql', table: 'members', columns: ['org_id', 'email'] })
    ).toBe(
      'SELECT COUNT(*) AS violation_count FROM (SELECT 1 FROM "members" GROUP BY "org_id", "email" HAVING COUNT(*) > 1) AS dups'
    )
  })
})

describe('buildFkViolationQuery', () => {
  test('left-join orphan count', () => {
    expect(
      buildFkViolationQuery({
        engine: 'postgresql',
        table: 'orders',
        column: 'user_id',
        refTable: 'users',
        refColumn: 'id',
      })
    ).toBe(
      'SELECT COUNT(*) AS violation_count FROM "orders" AS c LEFT JOIN "users" AS p ON c."user_id" = p."id" WHERE c."user_id" IS NOT NULL AND p."id" IS NULL'
    )
  })
})

import { buildViolationQuery } from '@/core/verify/constraint-query'
import { normalizeConstraintInput } from '@/core/verify/constraint'

describe('buildViolationQuery dispatches by check', () => {
  test('custom returns the agent-supplied query verbatim', () => {
    const input = normalizeConstraintInput({
      check: 'custom',
      table: 'users',
      violationQuery: 'SELECT COUNT(*) AS violation_count FROM users WHERE banned',
    })
    expect(buildViolationQuery(input, 'postgresql')).toBe(
      'SELECT COUNT(*) AS violation_count FROM users WHERE banned'
    )
  })
  test('fk dispatches to the orphan-count builder', () => {
    const input = normalizeConstraintInput({
      check: 'fk',
      table: 'orders',
      column: ['user_id'],
      references: 'users.id',
    })
    expect(buildViolationQuery(input, 'postgresql')).toContain('LEFT JOIN "users" AS p')
  })
})
