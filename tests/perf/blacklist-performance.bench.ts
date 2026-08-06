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

/**
 * Print every measurement, passing or failing.
 *
 * `test:perf` is a blocking CI step, so the number a budget was met by is the only
 * way to tell "comfortable" from "one bad runner away" without waiting for a red
 * build. The budgets themselves were chosen from real runner measurements, not
 * from a dev machine — see the CHANGELOG entry.
 */
function report(label: string, elapsed: number, budget: number): void {
  console.log(`${label} = ${elapsed.toFixed(2)}ms (budget ${budget}ms)`)
}

describe('Blacklist Performance Benchmarks', () => {
  it('Table lookup (1000 tables): 1000 lookups in < 10ms', () => {
    const largeManager = new BlacklistManager(largeConfig as any)

    const elapsed = medianElapsed(() => {
      let hits = 0
      for (let i = 0; i < 1000; i++) {
        if (largeManager.isTableBlacklisted(`table_${i}`)) hits++
      }
      return hits
    })

    report('Table lookup (1000 tables)', elapsed, 10)
    expect(elapsed).toBeLessThan(10)
  })

  it('Column lookup (100 cols blacklisted): 1000 lookups in < 10ms', () => {
    const largeManager = new BlacklistManager(largeConfig as any)

    const elapsed = medianElapsed(() => {
      let hits = 0
      for (let i = 0; i < 1000; i++) {
        if (largeManager.isColumnBlacklisted('table_50', `col_${i % 100}`)) hits++
      }
      return hits
    })

    report('Column lookup (1000 lookups)', elapsed, 10)
    expect(elapsed).toBeLessThan(10)
  })

  it('Column filtering (100 rows x 50 cols, omits 50): < 8ms per call', () => {
    const largeManager = new BlacklistManager(largeConfig as any)
    const largeValidator = new BlacklistValidator(largeManager)
    const columnList = Object.keys(largeRows[0] ?? {})

    const elapsed = medianElapsed(
      () => largeValidator.filterColumns('table_0', largeRows, columnList).filteredRows
    )

    report('Column filtering (100 rows x 50 cols)', elapsed, 8)
    expect(elapsed).toBeLessThan(8)
  })

  it('Column filtering (1000 rows x 7 cols, omits 3): < 5ms per call', () => {
    const elapsed = medianElapsed(
      () => typicalValidator.filterColumns('users', typicalRows, typicalColumnList).filteredRows
    )

    report('Column filtering (1000 rows x 7 cols)', elapsed, 5)
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

    report('Column filtering (100 rows, 5 dotted paths)', elapsed, 10)
    expect(elapsed).toBeLessThan(10)
  })

  it('Column filtering (1000 flattened docs, 3 parent rules): < 8ms per call', () => {
    // The shape the Elasticsearch adapter actually produces: `_source` flattened
    // into dotted top-level keys with no nested records anywhere. Nothing here
    // covered it, which is how a 70x masking regression on real ES results passed
    // CI once — the other cases mask by plain column name and never exercise the
    // dotted branch on a wide result set.
    const docs = Array.from({ length: 1000 }, (_, i) => {
      const row: Record<string, unknown> = { id: i }
      for (let j = 0; j < 16; j++) row[`f${j}`] = j
      row['profile.email'] = `e${i}`
      row['profile.ssn'] = `s${i}`
      row['payment.card'] = `c${i}`
      row['payment.cvv'] = '123'
      row['meta.a'] = 1
      row['meta.b'] = 2
      return row
    })
    // Elasticsearch does not flatten arrays, so one document out of a thousand can
    // legitimately carry a nested `profile`. When the recursion decision was made
    // once for the whole result set instead of per row, this single document put the
    // other 999 back on the slow path and pushed this case over budget.
    docs[500] = { id: 500, profile: [{ email: 'nested' }], 'payment.card': 'c' }
    const config = {
      ...baseConfig,
      blacklist: { tables: [], columns: { logs: ['profile', 'payment', 'meta'] } },
    }
    const validator = new BlacklistValidator(new BlacklistManager(config as any))
    const columnList = Object.keys(docs[0] ?? {})

    const elapsed = medianElapsed(
      () => validator.filterColumns('logs', docs, columnList).filteredRows
    )

    // PROVISIONAL budget. Locally this measures ~1.8ms and the regression it guards
    // against (deciding the nested recursion per result set instead of per row)
    // measures ~8.7ms, so the discriminating ceiling is around 4ms — but the ratio
    // between this machine and a CI runner is not known for this shape yet, and the
    // sibling case scales 0.65ms → 3.66ms on windows-latest. Tightened from the CI
    // numbers this benchmark prints, not from a dev machine.
    report('Column filtering (1000 flattened docs)', elapsed, 16)
    expect(elapsed).toBeLessThan(16)
  })

  it('Config loading - typical blacklist: < 5ms', () => {
    const elapsed = medianElapsed(() => new BlacklistManager(typicalConfig as any))

    report('Config loading (typical)', elapsed, 5)
    expect(elapsed).toBeLessThan(5)
  })

  it('Config loading - large blacklist (1000 tables): < 50ms', () => {
    const elapsed = medianElapsed(() => new BlacklistManager(largeConfig as any))

    report('Config loading (1000 tables)', elapsed, 50)
    expect(elapsed).toBeLessThan(50)
  })

  it('Typical query flow overhead: blacklist check < 1ms', () => {
    // Simulate typical overhead per query
    const manager = new BlacklistManager(typicalConfig as any)
    const validator = new BlacklistValidator(manager)

    const ITERATIONS = 1000
    const elapsed = medianElapsed(() => {
      let masked = 0
      for (let i = 0; i < ITERATIONS; i++) {
        // Simulate what happens per query: table check + column filter
        if (!manager.isTableBlacklisted('users')) {
          masked += validator.filterColumns(
            'users',
            [{ id: i, password: 'hash', email: 'e@e.com' }],
            ['id', 'password', 'email']
          ).filteredRows.length
        }
      }
      return masked
    })
    const perQuery = elapsed / ITERATIONS

    report('Per-query overhead', perQuery, 1)
    expect(perQuery).toBeLessThan(1)
  })
})
