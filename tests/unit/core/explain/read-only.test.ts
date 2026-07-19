import { describe, expect, test } from 'bun:test'
import { isProvenReadOnlySql } from '@/core/explain/read-only'

describe('isProvenReadOnlySql', () => {
  test('accepts a plain SELECT and a SELECT-only CTE', () => {
    expect(isProvenReadOnlySql('SELECT id FROM users', 'postgresql')).toBe(true)
    expect(
      isProvenReadOnlySql(
        'WITH active AS (SELECT id FROM users) SELECT id FROM active',
        'postgresql'
      )
    ).toBe(true)
  })

  test.each([
    ['UPDATE users SET active = false', 'postgresql'],
    ['DELETE FROM users', 'postgresql'],
    ['INSERT INTO users (id) VALUES (1)', 'postgresql'],
    ['CREATE TABLE scratch (id integer)', 'postgresql'],
    [
      'WITH changed AS (UPDATE users SET active = false RETURNING id) SELECT id FROM changed',
      'postgresql',
    ],
  ] as const)('rejects SQL that can modify data: %s', (sql, system) => {
    expect(isProvenReadOnlySql(sql, system)).toBe(false)
  })

  test('rejects SELECT INTO because it creates a table', () => {
    expect(
      isProvenReadOnlySql('SELECT id INTO archived_users FROM users', 'postgresql')
    ).toBe(false)
  })
})
