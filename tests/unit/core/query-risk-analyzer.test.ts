import { describe, expect, test } from 'bun:test'
import { analyzeQueryRisk } from '@/core/query-risk-analyzer'
import type { AnalyzeQueryRiskInput, SchemaLookup } from '@/types/query-risk'
import type { BlacklistConfig } from '@/types/blacklist'
import type { Permission } from '@/types'

const schemaLookup: SchemaLookup = {
  cacheAvailable: true,
  tables: {
    users: {
      name: 'users',
      estimatedRowCount: 100,
      columns: [
        { name: 'id', type: 'integer', nullable: false, primaryKey: true },
        { name: 'email', type: 'varchar', nullable: false },
        { name: 'status', type: 'varchar', nullable: false },
      ],
    },
    orders: {
      name: 'orders',
      estimatedRowCount: 250_000,
      columns: [
        { name: 'id', type: 'integer', nullable: false, primaryKey: true },
        { name: 'user_id', type: 'integer', nullable: false },
      ],
    },
  },
}

const emptyBlacklist: BlacklistConfig = { tables: [], columns: {} }

function analyze(
  sql: string,
  overrides: Partial<Omit<AnalyzeQueryRiskInput, 'sql'>> = {}
) {
  return analyzeQueryRisk({
    sql,
    permission: overrides.permission ?? ('admin' as Permission),
    blacklist: overrides.blacklist ?? emptyBlacklist,
    schemaLookup: overrides.schemaLookup ?? schemaLookup,
  })
}

describe('analyzeQueryRisk parser foundation', () => {
  test('UPDATE without WHERE returns BLOCK', () => {
    const result = analyze('UPDATE users SET status = \'inactive\'')
    expect(result.decision).toBe('BLOCK')
    expect(result.operation).toBe('UPDATE')
    expect(result.targetTables).toEqual(['users'])
    expect(result.riskFactors).toContainEqual({
      code: 'write_missing_where',
      severity: 'block',
      message: 'UPDATE statement has no WHERE clause.',
    })
    expect(result.recommendations).toContain('Add a WHERE clause.')
  })

  test('DELETE without WHERE returns BLOCK', () => {
    const result = analyze('DELETE FROM users')
    expect(result.decision).toBe('BLOCK')
    expect(result.operation).toBe('DELETE')
    expect(result.targetTables).toEqual(['users'])
    expect(result.riskFactors).toContainEqual({
      code: 'write_missing_where',
      severity: 'block',
      message: 'DELETE statement has no WHERE clause.',
    })
  })

  test('comments do not hide missing WHERE', () => {
    const result = analyze('UPDATE users SET status = \'inactive\' -- WHERE id = 1\n')
    expect(result.decision).toBe('BLOCK')
    expect(result.riskFactors.map((factor) => factor.code)).toContain('write_missing_where')
  })

  test('SELECT star returns WARN', () => {
    const result = analyze('SELECT * FROM users WHERE id = 1')
    expect(result.decision).toBe('WARN')
    expect(result.operation).toBe('SELECT')
    expect(result.targetTables).toEqual(['users'])
    expect(result.riskFactors).toContainEqual({
      code: 'select_star',
      severity: 'warn',
      message: 'SELECT * may expose unnecessary columns.',
    })
    expect(result.recommendations).toContain('Select only the columns required for the task.')
  })

  test('safe SELECT with WHERE and LIMIT returns ALLOW', () => {
    const result = analyze('SELECT id, email FROM users WHERE id = 123 LIMIT 1')
    expect(result.decision).toBe('ALLOW')
    expect(result.operation).toBe('SELECT')
    expect(result.targetTables).toEqual(['users'])
    expect(result.riskFactors).toEqual([])
    expect(result.recommendations).toEqual([])
  })
})

describe('analyzeQueryRisk MVP risk rules', () => {
  test('insufficient permission returns BLOCK', () => {
    const result = analyze('UPDATE users SET status = \'inactive\' WHERE id = 1', {
      permission: 'query-only',
    })
    expect(result.decision).toBe('BLOCK')
    expect(result.riskFactors.map((factor) => factor.code)).toContain('permission_denied')
  })

  test('large table without WHERE or LIMIT returns WARN', () => {
    const result = analyze('SELECT id FROM orders')
    expect(result.decision).toBe('WARN')
    expect(result.riskFactors).toContainEqual({
      code: 'large_table_unfiltered',
      severity: 'warn',
      message: 'Target table orders is large and the query has no WHERE or LIMIT clause.',
    })
  })

  test('large table with LIMIT does not warn for table size', () => {
    const result = analyze('SELECT id FROM orders LIMIT 10')
    expect(result.riskFactors.map((factor) => factor.code)).not.toContain('large_table_unfiltered')
  })

  test('blacklisted table returns BLOCK', () => {
    const result = analyze('SELECT id FROM users WHERE id = 1', {
      blacklist: { tables: ['users'], columns: {} },
    })
    expect(result.decision).toBe('BLOCK')
    expect(result.riskFactors).toContainEqual({
      code: 'table_blacklisted',
      severity: 'block',
      message: 'Target table users is blacklisted.',
    })
  })

  test('blacklisted selected column returns WARN', () => {
    const result = analyze('SELECT id, email FROM users WHERE id = 1', {
      blacklist: { tables: [], columns: { users: ['email'] } },
    })
    expect(result.decision).toBe('WARN')
    expect(result.riskFactors).toContainEqual({
      code: 'blacklisted_column',
      severity: 'warn',
      message: 'Query references blacklisted column users.email.',
    })
  })

  test('blacklisted updated column returns WARN', () => {
    const result = analyze('UPDATE users SET email = \'a@example.com\' WHERE id = 1', {
      blacklist: { tables: [], columns: { users: ['email'] } },
    })
    expect(result.decision).toBe('WARN')
    expect(result.riskFactors.map((factor) => factor.code)).toContain('blacklisted_column')
  })

  test('unknown table returns WARN and suggested schema command', () => {
    const result = analyze('SELECT id FROM invoices WHERE id = 1')
    expect(result.decision).toBe('WARN')
    expect(result.riskFactors).toContainEqual({
      code: 'schema_table_unknown',
      severity: 'warn',
      message: 'Target table invoices is missing from schema cache.',
    })
    expect(result.suggestedCommands).toEqual(['dbcli schema invoices --format json'])
  })

  test('missing schema cache returns WARN', () => {
    const result = analyze('SELECT id FROM users WHERE id = 1', {
      schemaLookup: { cacheAvailable: false, tables: {} },
    })
    expect(result.decision).toBe('WARN')
    expect(result.riskFactors).toContainEqual({
      code: 'schema_cache_missing',
      severity: 'warn',
      message: 'Schema cache is missing for the selected connection.',
    })
    expect(result.suggestedCommands).toEqual(['dbcli schema users --format json'])
  })

  test('multi-table query with partial schema coverage returns WARN', () => {
    const result = analyze('SELECT users.id FROM users JOIN invoices ON invoices.user_id = users.id')
    expect(result.decision).toBe('WARN')
    expect(result.targetTables).toEqual(['users', 'invoices'])
    expect(result.riskFactors.map((factor) => factor.code)).toContain('partial_schema_coverage')
  })

  test('destructive DDL returns BLOCK', () => {
    const result = analyze('DROP TABLE users')
    expect(result.decision).toBe('BLOCK')
    expect(result.operation).toBe('DDL')
    expect(result.riskFactors.map((factor) => factor.code)).toContain('destructive_ddl')
  })

  test('unknown write-like SQL returns BLOCK', () => {
    const result = analyze('MERGE INTO users USING staging_users ON users.id = staging_users.id')
    expect(result.decision).toBe('BLOCK')
    expect(result.operation).toBe('UNKNOWN')
    expect(result.riskFactors.map((factor) => factor.code)).toContain('unknown_write_or_ddl')
  })

  test('unknown read-like SQL returns WARN', () => {
    const result = analyze('WITH recent_users AS (SELECT id FROM users) TABLE recent_users')
    expect(result.decision).toBe('WARN')
    expect(result.riskFactors.map((factor) => factor.code)).toContain('unknown_read')
  })
})
