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
    expect(isProvenReadOnlySql('SELECT id INTO archived_users FROM users', 'postgresql')).toBe(
      false
    )
  })

  test.each([
    ['SELECT @session_value := 1', 'mysql'],
    ['SELECT @session_value := id FROM users', 'mysql'],
    ['SELECT @session_value := 1', 'mariadb'],
    ['SELECT @session_value := id FROM users', 'mariadb'],
  ] as const)('rejects session-variable assignment expressions: %s (%s)', (sql, system) => {
    expect(isProvenReadOnlySql(sql, system)).toBe(false)
  })

  test.each([
    ['SELECT 1 INTO @session_value', 'mysql'],
    ['SELECT 1 INTO @session_value', 'mariadb'],
  ] as const)('rejects SELECT INTO session-variable mutation: %s (%s)', (sql, system) => {
    expect(isProvenReadOnlySql(sql, system)).toBe(false)
  })

  test.each(['mysql', 'mariadb'] as const)(
    'keeps session-variable comparisons distinct from assignment (%s)',
    (system) => {
      expect(isProvenReadOnlySql('SELECT @session_value = 1', system)).toBe(true)
    }
  )

  test.each([
    ['SELECT nextval(sequence_name)', 'postgresql'],
    ['SELECT setval(sequence_name, 1)', 'postgresql'],
    ['SELECT pg_advisory_lock(1)', 'postgresql'],
    ["SELECT set_config('application_name', 'dbcli', false)", 'postgresql'],
    ['SELECT COUNT(*) FROM users', 'postgresql'],
    ['SELECT ROW_NUMBER() OVER (ORDER BY id) FROM users', 'postgresql'],
    ['SELECT arbitrary_udf(id) FROM users', 'postgresql'],
    ['SELECT * FROM arbitrary_table_function(1)', 'postgresql'],
    ['SELECT arbitrary_udf(id) FROM users', 'mysql'],
    ['SELECT arbitrary_udf(id) FROM users', 'mariadb'],
  ] as const)('rejects function-bearing SELECTs as unproven: %s', (sql, system) => {
    expect(isProvenReadOnlySql(sql, system)).toBe(false)
  })
})
