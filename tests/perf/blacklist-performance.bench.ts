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
  connection: {
    system: 'postgresql',
    host: 'localhost',
    port: 5432,
    user: 'u',
    password: 'p',
    database: 'db',
  },
  permission: 'admin',
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
    payment: ['credit_card', 'cvv', 'bank_account'],
  },
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
  created_at: new Date().toISOString(),
}))
const typicalColumnList = Object.keys(typicalRows[0] ?? {})

/**
 * Median of `sampleCount` runs, after one discarded warm-up run.
 *
 * A single `performance.now()` around one call is not a threshold a CI job can be
 * held to: one GC pause or a descheduled slice and it reads several times high. On
 * this machine the same masking call medians at ~1.3ms, yet three consecutive
 * single-shot runs of the old benchmark produced one reading past the 5ms budget
 * (n=3 — enough to show the gate was unreliable, not enough to put a rate on it).
 * The median is what makes this assertion a gate rather than a coin flip.
 */
function medianElapsed(run: () => unknown, sampleCount = 9): number {
  const samples: number[] = []
  let sink = 0
  for (let i = 0; i <= sampleCount; i++) {
    const start = performance.now()
    const result = run()
    const elapsed = performance.now() - start
    // Consume the result so the JIT cannot elide the call it is timing.
    sink += Array.isArray(result) ? result.length : 1
    if (i > 0) samples.push(elapsed)
  }
  if (samples.length === 0 || sink === 0) {
    // Failing open here would let `expect(0).toBeLessThan(5)` certify a gate that
    // measured nothing at all.
    throw new Error('medianElapsed measured no samples')
  }
  samples.sort((a, b) => a - b)
  return samples[Math.floor(samples.length / 2)]!
}

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

  it('Column filtering (100 rows x 50 cols, omits 50): < 5ms per call', () => {
    const largeManager = new BlacklistManager(largeConfig as any)
    const largeValidator = new BlacklistValidator(largeManager)
    const columnList = Object.keys(largeRows[0] ?? {})

    const elapsed = medianElapsed(
      () => largeValidator.filterColumns('table_0', largeRows, columnList).filteredRows
    )

    // Printed so a passing CI run still shows the margin — without it there is no
    // way to tell whether this budget is comfortable on a runner or one GC away.
    console.log(`Column filtering (100 rows x 50 cols) = ${elapsed.toFixed(2)}ms (budget 5ms)`)
    expect(elapsed).toBeLessThan(5)
  })

  it('Column filtering (1000 rows x 7 cols, omits 3): < 5ms per call', () => {
    const elapsed = medianElapsed(
      () => typicalValidator.filterColumns('users', typicalRows, typicalColumnList).filteredRows
    )

    console.log(`Column filtering (1000 rows x 7 cols) = ${elapsed.toFixed(2)}ms (budget 5ms)`)
    expect(elapsed).toBeLessThan(5)
  })

  it('Column filtering (100 rows, 5 dotted JSON paths): < 10ms per call', () => {
    // The single-pass optimisation covers dotless paths only; a dotted path still
    // rebuilds the whole record once per path. Nothing guarded that half, so this
    // pins it. The budget is deliberately looser than the dotless cases because
    // this is the O(rows × paths) branch — it is a ceiling, not a target.
    const jsonRows = Array.from({ length: 100 }, (_, i) => ({
      id: i,
      name: `n${i}`,
      profile: { email: `e${i}`, ssn: `s${i}`, phone: `p${i}`, city: 'Taipei', note: 'x' },
      payment: { card: `c${i}`, cvv: '123' },
    }))
    const jsonConfig = {
      ...baseConfig,
      blacklist: {
        tables: [],
        columns: {
          orders: ['profile.email', 'profile.ssn', 'profile.phone', 'payment.card', 'payment.cvv'],
        },
      },
    }
    const validator = new BlacklistValidator(new BlacklistManager(jsonConfig as any))
    const columnList = Object.keys(jsonRows[0] ?? {})

    const elapsed = medianElapsed(
      () => validator.filterColumns('orders', jsonRows, columnList).filteredRows
    )

    console.log(
      `Column filtering (100 rows, 5 dotted paths) = ${elapsed.toFixed(2)}ms (budget 10ms)`
    )
    expect(elapsed).toBeLessThan(10)
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
        validator.filterColumns(
          'users',
          [{ id: i, password: 'hash', email: 'e@e.com' }],
          ['id', 'password', 'email']
        )
      }
    }

    const elapsed = performance.now() - start
    const perQuery = elapsed / ITERATIONS

    expect(perQuery).toBeLessThan(1) // < 1ms overhead per query
  })
})
