import { describe, it, expect, mock } from 'bun:test'
import { HealthChecker } from '@/core/health-checker'
import type { DatabaseAdapter, TableSchema } from '@/adapters/types'

function createMockAdapter(executeImpl: (sql: string) => any[]): DatabaseAdapter {
  return {
    connect: mock(() => Promise.resolve()),
    disconnect: mock(() => Promise.resolve()),
    testConnection: mock(() => Promise.resolve(true)),
    listTables: mock(() => Promise.resolve([])),
    getTableSchema: mock(() => Promise.resolve({ name: 'test', columns: [] })),
    execute: mock((sql: string) => Promise.resolve(executeImpl(sql))),
  }
}

describe('HealthChecker', () => {
  it('returns check report with correct table name and row count', async () => {
    const adapter = createMockAdapter((sql) => {
      if (sql.includes('COUNT(*)')) return [{ count: 100 }]
      return []
    })

    const checker = new HealthChecker(adapter)
    const schema: TableSchema = {
      name: 'users',
      columns: [{ name: 'id', type: 'bigint', nullable: false, primaryKey: true }],
      estimatedRowCount: 100,
    }

    const report = await checker.check(schema)
    expect(report.table).toBe('users')
    expect(report.rowCount).toBe(100)
    expect(report.sizeCategory).toBe('small')
  })

  it('detects null columns', async () => {
    const adapter = createMockAdapter((sql) => {
      if (sql.includes('COUNT(*)') && !sql.includes('COUNT(`')) return [{ count: 100 }]
      if (sql.includes('null_count')) return [{ null_count: 30 }]
      return []
    })

    const checker = new HealthChecker(adapter)
    const schema: TableSchema = {
      name: 'users',
      columns: [
        { name: 'id', type: 'bigint', nullable: false },
        { name: 'bio', type: 'text', nullable: true },
      ],
      estimatedRowCount: 100,
    }

    const report = await checker.check(schema)
    expect(report.checks.nulls.length).toBeGreaterThan(0)
    expect(report.checks.nulls[0].column).toBe('bio')
    expect(report.checks.nulls[0].nullCount).toBe(30)
  })

  it('detects orphan foreign keys', async () => {
    const adapter = createMockAdapter((sql) => {
      if (sql.includes('COUNT(*)') && !sql.includes('LEFT JOIN')) return [{ count: 50 }]
      if (sql.includes('orphan_count')) return [{ orphan_count: 3 }]
      return []
    })

    const checker = new HealthChecker(adapter)
    const schema: TableSchema = {
      name: 'orders',
      columns: [
        { name: 'id', type: 'bigint', nullable: false },
        {
          name: 'user_id',
          type: 'bigint',
          nullable: false,
          foreignKey: { table: 'users', column: 'id' },
        },
      ],
      estimatedRowCount: 50,
    }

    const report = await checker.check(schema)
    expect(report.checks.orphans.length).toBe(1)
    expect(report.checks.orphans[0].column).toBe('user_id')
    expect(report.checks.orphans[0].orphanCount).toBe(3)
  })

  it('detects empty strings', async () => {
    const adapter = createMockAdapter((sql) => {
      if (sql.includes('COUNT(*)') && !sql.includes("= ''")) return [{ count: 200 }]
      if (sql.includes("= ''")) return [{ empty_count: 15 }]
      return []
    })

    const checker = new HealthChecker(adapter)
    const schema: TableSchema = {
      name: 'users',
      columns: [
        { name: 'id', type: 'bigint', nullable: false },
        { name: 'name', type: 'varchar(100)', nullable: false },
      ],
      estimatedRowCount: 200,
    }

    const report = await checker.check(schema)
    expect(report.checks.emptyStrings.length).toBe(1)
    expect(report.checks.emptyStrings[0].column).toBe('name')
    expect(report.checks.emptyStrings[0].count).toBe(15)
  })

  it('returns clean report for healthy table', async () => {
    const adapter = createMockAdapter((sql) => {
      if (sql.includes('COUNT(*)')) return [{ count: 50 }]
      if (sql.includes('null_count')) return [{ null_count: 0 }]
      if (sql.includes('orphan_count')) return [{ orphan_count: 0 }]
      if (sql.includes('dup_count')) return [{ dup_count: 0 }]
      if (sql.includes('empty_count')) return [{ empty_count: 0 }]
      return []
    })

    const checker = new HealthChecker(adapter)
    const schema: TableSchema = {
      name: 'clean',
      columns: [{ name: 'id', type: 'bigint', nullable: false, primaryKey: true }],
      estimatedRowCount: 50,
    }

    const report = await checker.check(schema)
    expect(report.checks.nulls).toHaveLength(0)
    expect(report.checks.orphans).toHaveLength(0)
    expect(report.checks.duplicates).toHaveLength(0)
    expect(report.checks.emptyStrings).toHaveLength(0)
  })

  it('respects blacklisted columns', async () => {
    const adapter = createMockAdapter((sql) => {
      if (sql.includes('COUNT(*)')) return [{ count: 100 }]
      return []
    })

    const checker = new HealthChecker(adapter)
    const schema: TableSchema = {
      name: 'users',
      columns: [
        { name: 'id', type: 'bigint', nullable: false },
        { name: 'password', type: 'varchar(255)', nullable: true },
      ],
      estimatedRowCount: 100,
    }

    const report = await checker.check(schema, {
      blacklistedColumns: new Set(['users.password']),
    })
    // password column should be skipped in all checks
    const allCheckedCols = [
      ...report.checks.nulls.map((n) => n.column),
      ...report.checks.emptyStrings.map((e) => e.column),
    ]
    expect(allCheckedCols).not.toContain('password')
  })
})
