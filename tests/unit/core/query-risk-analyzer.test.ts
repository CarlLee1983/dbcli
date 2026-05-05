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
