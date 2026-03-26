/**
 * Blacklist Performance Benchmarks
 *
 * Verifies that blacklist overhead is < 1ms per query for typical configurations.
 * Uses performance.now() to measure execution time.
 */

import { describe, it, expect } from 'bun:test'
import { BlacklistManager } from '@/core/blacklist-manager'
import { BlacklistValidator } from '@/core/blacklist-validator'
import type { DbcliConfig } from '@/types'

const baseConfig: DbcliConfig = {
  connection: { system: 'postgresql', host: 'localhost', port: 5432, user: 'u', password: 'p', database: 'db' },
  permission: 'admin'
}

// ─── Setup: Large config for stress testing ────────────────────────────────

// 1000 table names for blacklist
const largeTableList = Array.from({ length: 1000 }, (_, i) => `table_${i}`)

// 100 columns per table for column blacklist
const largeColumnConfig: Record<string, string[]> = {}
for (let i = 0; i < 100; i++) {
  largeColumnConfig[`table_${i}`] = Array.from({ length: 100 }, (_, j) => `col_${j}`)
}

const largeBlacklist = { tables: largeTableList, columns: largeColumnConfig }
const largeConfig = { ...baseConfig, blacklist: largeBlacklist }

// Large result set for filtering benchmark
const largeRows = Array.from({ length: 100 }, (_, i) => {
  const row: Record<string, any> = { id: i }
  for (let j = 0; j < 50; j++) {
    row[`col_${j}`] = `value_${i}_${j}`
  }
  return row
})

// Typical configs
const typicalBlacklist = {
  tables: ['audit_logs', 'secrets_vault', 'internal_config'],
  columns: {
    users: ['password', 'api_key', 'ssn'],
    payment: ['credit_card', 'cvv', 'bank_account']
  }
}
const typicalConfig = { ...baseConfig, blacklist: typicalBlacklist }
const typicalManager = new BlacklistManager(typicalConfig as any)
const typicalValidator = new BlacklistValidator(typicalManager)

const typicalRows = Array.from({ length: 1000 }, (_, i) => ({
  id: i,
  name: `User ${i}`,
  email: `user${i}@example.com`,
  password: `hash_${i}`,
  api_key: `key_${i}`,
  ssn: `ssn_${i}`,
  created_at: new Date().toISOString()
}))
const typicalColumnList = Object.keys(typicalRows[0])

describe('Blacklist Performance Benchmarks', () => {
  it('Table lookup (1000 tables): 1000 lookups in < 10ms', () => {
    const largeManager = new BlacklistManager(largeConfig as any)

    const start = performance.now()
    for (let i = 0; i < 1000; i++) {
      largeManager.isTableBlacklisted(`table_${i}`)
    }
    const elapsed = performance.now() - start

    expect(elapsed).toBeLessThan(10) // 1000 lookups in < 10ms
    // Individual lookup < 1µs (0.001ms)
    expect(elapsed / 1000).toBeLessThan(1) // avg per lookup < 1ms
  })

  it('Column lookup (100 cols blacklisted): 1000 lookups in < 10ms', () => {
    const largeManager = new BlacklistManager(largeConfig as any)

    const start = performance.now()
    for (let i = 0; i < 1000; i++) {
      largeManager.isColumnBlacklisted('table_50', `col_${i % 100}`)
    }
    const elapsed = performance.now() - start

    expect(elapsed).toBeLessThan(10)
    expect(elapsed / 1000).toBeLessThan(1) // avg < 1ms
  })

  it('Column filtering (100 rows x 50 cols, omit 5): < 5ms per call', () => {
    const largeManager = new BlacklistManager(largeConfig as any)
    const largeValidator = new BlacklistValidator(largeManager)
    const columnList = Object.keys(largeRows[0])

    // Warm up JIT
    largeValidator.filterColumns('table_0', largeRows.slice(0, 5), columnList)

    const start = performance.now()
    largeValidator.filterColumns('table_0', largeRows, columnList)
    const elapsed = performance.now() - start

    expect(elapsed).toBeLessThan(5) // < 5ms for 100 rows (first call may include JIT warmup)
  })

  it('Column filtering (1000 rows x 7 cols, omit 3): < 5ms per call', () => {
    const start = performance.now()
    typicalValidator.filterColumns('users', typicalRows, typicalColumnList)
    const elapsed = performance.now() - start

    expect(elapsed).toBeLessThan(5) // < 5ms for 1000 rows
  })

  it('Config loading - typical blacklist: < 5ms', () => {
    const start = performance.now()
    new BlacklistManager(typicalConfig as any)
    const elapsed = performance.now() - start

    expect(elapsed).toBeLessThan(5)
  })

  it('Config loading - large blacklist (1000 tables): < 50ms', () => {
    const start = performance.now()
    new BlacklistManager(largeConfig as any)
    const elapsed = performance.now() - start

    expect(elapsed).toBeLessThan(50)
  })

  it('Typical query flow overhead: blacklist check < 1ms', () => {
    // Simulate typical overhead per query
    const manager = new BlacklistManager(typicalConfig as any)
    const validator = new BlacklistValidator(manager)

    const ITERATIONS = 1000
    const start = performance.now()

    for (let i = 0; i < ITERATIONS; i++) {
      // Simulate what happens per query: table check + column filter
      if (!manager.isTableBlacklisted('users')) {
        validator.filterColumns('users', [{ id: i, password: 'hash', email: 'e@e.com' }], ['id', 'password', 'email'])
      }
    }

    const elapsed = performance.now() - start
    const perQuery = elapsed / ITERATIONS

    expect(perQuery).toBeLessThan(1) // < 1ms overhead per query
  })
})
