/**
 * Blacklist Performance Benchmarks
 *
 * Verifies that blacklist overhead is < 1ms per query for typical configurations.
 * Uses performance.now() to measure execution time.
 */

import { describe, it, expect } from 'bun:test'
import { BlacklistManager } from '@/core/blacklist-manager'
import { foldFieldPath } from '@/core/blacklist-fold'
import { BlacklistValidator } from '@/core/blacklist-validator'
import type { DbcliConfig } from '@/types'
import { medianElapsed, report } from '../helpers/bench'

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

describe('Blacklist Performance Benchmarks', () => {
  it('Table lookup (100 tables, typical config): 1000 lookups in < 2ms', () => {
    // The typical-scale half of the pair below, and the case DBCLI-015 moved out
    // of `tests/unit/core/blacklist-manager.test.ts`. There it was a single
    // `performance.now()` around one loop, run alongside 6,700 other tests: it
    // read 21.43ms against a 10ms budget under load and passed three times in a
    // row when the file was run alone, which made two verifications of the same
    // commit disagree. Here it is the median of nine samples and the number is
    // printed.
    const tables = Array.from({ length: 100 }, (_, i) => `table_${i}`)
    const manager = new BlacklistManager({
      ...baseConfig,
      blacklist: { tables, columns: {} },
    } as any)

    const elapsed = medianElapsed(() => {
      let hits = 0
      for (let i = 0; i < 1000; i++) {
        if (manager.isTableBlacklisted(`table_${i % 100}`)) hits++
      }
      return hits
    })

    // 0.14ms on this machine across five runs. Scaled the same way as the rest of
    // this file — a CI runner costs about 3x here — that is ~0.42ms, so 2ms keeps
    // a 4.7x margin. This case does not guard the linear-scan regression on its
    // own: at 100 tables that shape measures 0.98ms here, under any budget loose
    // enough not to be a coin flip. The 1000-table case below is what fails on it,
    // which is why both scales are kept.
    report('Table lookup (100 tables, typical)', elapsed, 2)
    expect(elapsed).toBeLessThan(2)
  })

  it('Table lookup (1000 tables): 1000 lookups in < 2ms', () => {
    const largeManager = new BlacklistManager(largeConfig as any)

    const elapsed = medianElapsed(() => {
      let hits = 0
      for (let i = 0; i < 1000; i++) {
        if (largeManager.isTableBlacklisted(`table_${i}`)) hits++
      }
      return hits
    })

    // Budget tightened from 10ms to 2ms by DBCLI-015. The lookup is set-backed, so
    // it does not care that the blacklist is ten times larger: 0.099ms here,
    // ~0.3ms on a runner at this file's 3x scaling. The old 10ms was 100x the
    // measurement. This budget is a cost ceiling only; the linear-scan regression
    // is rejected by the scaling pair below, which does not depend on how fast
    // the machine reading it happens to be.
    report('Table lookup (1000 tables)', elapsed, 2)
    expect(elapsed).toBeLessThan(2)
  })

  // ─── R2: lookup cost does not grow with blacklist size ──────────────────

  // The two cases below are the only place the linear-scan regression is
  // actually rejected by something that re-runs. The wall-clock budgets above
  // are calibrated on one machine and scaled; a claim that a linear scan would
  // blow them was, until DBCLI-015 was reviewed, a sentence in a comment. A
  // ratio between two sizes is dimensionless — it survives a slow runner, and
  // it is the property R2 names ("linear in the table count") rather than a
  // duration standing in for it.

  /** Probes must be spread across the whole blacklist. */
  const LOOKUPS_PER_SAMPLE = 2000
  /** Set-backed measures 0.83–1.04 here; a linear scan measures 7.3–9.6. */
  const MAX_SIZE_SCALING = 3

  const probeAllOf = (size: number, lookup: (name: string) => boolean) => () => {
    let hits = 0
    for (let i = 0; i < LOOKUPS_PER_SAMPLE; i++) {
      if (lookup(`table_${i % size}`)) hits++
    }
    return hits
  }

  const scalingRatio = (lookupFor: (size: number) => (name: string) => boolean): number => {
    const small = medianElapsed(probeAllOf(100, lookupFor(100)))
    const large = medianElapsed(probeAllOf(1000, lookupFor(1000)))
    return large / small
  }

  it('Table lookup cost does not scale with blacklist size', () => {
    const ratio = scalingRatio((size) => {
      const manager = new BlacklistManager({
        ...baseConfig,
        blacklist: { tables: Array.from({ length: size }, (_, i) => `table_${i}`), columns: {} },
      } as any)
      return (name) => manager.isTableBlacklisted(name)
    })

    console.log(
      `Table lookup 1000-vs-100 cost ratio = ${ratio.toFixed(2)} (max ${MAX_SIZE_SCALING})`
    )
    expect(ratio).toBeLessThan(MAX_SIZE_SCALING)
  })

  it('...and that assertion rejects a lookup that is linear in the table count', () => {
    // The shape the set-backed lookup replaced: fold every entry on every
    // lookup. Kept here as the regression the assertion above has to catch, so
    // that the threshold is checked against a failing implementation rather
    // than asserted to discriminate.
    const ratio = scalingRatio((size) => {
      const tables = Array.from({ length: size }, (_, i) => `table_${i}`)
      return (name) => {
        const folded = foldFieldPath(name)
        for (const entry of tables) {
          if (foldFieldPath(entry) === folded) return true
        }
        return false
      }
    })

    console.log(
      `Linear-scan 1000-vs-100 cost ratio = ${ratio.toFixed(2)} (must exceed ${MAX_SIZE_SCALING})`
    )
    expect(ratio).toBeGreaterThan(MAX_SIZE_SCALING)
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

    // Budget set from CI, not from a dev machine: measured 2.59–5.53ms across the
    // six matrix jobs (worst windows-latest, bun 1.3.3), against 1.83ms locally — so
    // a runner costs about 3x here. The regression this guards against measures
    // 8.7ms locally, i.e. roughly 26ms on that runner, so 12ms both clears the worst
    // real measurement by 2.2x and fails loudly if the per-row decision is undone.
    report('Column filtering (1000 flattened docs)', elapsed, 12)
    expect(elapsed).toBeLessThan(12)
  })

  it('Column filtering (1000 rows, 60 dotted rules that match nothing): < 6ms per call', () => {
    // The shape the fail-safe branch produces: when the statement scan cannot name a
    // table, every rule in the config is applied, so "many rules, almost no matches"
    // is the normal case rather than a pathological one. Every miss used to walk all
    // 1000 rows through `hasFieldPath`, re-splitting the path on each row — measured
    // 7.17ms locally for masking that omits a single column.
    const rows = Array.from({ length: 1000 }, (_, i) => {
      const row: Record<string, unknown> = { id: i, password: 'p' }
      for (let j = 0; j < 8; j++) row[`f${j}`] = j
      return row
    })
    const columns = Array.from({ length: 60 }, (_, i) => `ns${i}.secret`)
    const config = {
      ...baseConfig,
      blacklist: { tables: [], columns: { users: [...columns, 'password'] } },
    }
    const validator = new BlacklistValidator(new BlacklistManager(config as any))
    const columnList = Object.keys(rows[0] ?? {})

    const elapsed = medianElapsed(
      () => validator.filterColumns('users', rows, columnList).filteredRows
    )

    // Budget scaled the same way as the flattened-docs case: a CI runner costs about
    // 3x this machine, so 0.90ms locally is ~2.7ms there and 6ms keeps the 2.2x margin
    // that stops this being a coin flip. The regression it guards measures 12.1ms
    // locally — roughly 36ms on that runner — so it still fails loudly.
    report('Column filtering (60 missing dotted rules)', elapsed, 6)
    expect(elapsed).toBeLessThan(6)
  })

  it('Column filtering (wide rows, dotted rules that miss on a real nested head): < 60ms per call', () => {
    // The shape the existing dotted-miss case cannot see. There the rules' heads
    // (`ns0`..`ns59`) are absent, so `nestedHeads` rejects every one before a row is
    // touched. Here the head is a real nested object — a PostgreSQL `jsonb` column,
    // an Elasticsearch `_source` — so every rule reaches `hasFieldPath` and walks all
    // the rows, which is exactly where case folding could turn a key lookup into a
    // scan of the row's width. Measured on this machine: 45ms before folding, 417ms
    // with a scan per lookup, 85ms with the per-record key index.
    const rows = Array.from({ length: 2000 }, (_, r) => {
      const row: Record<string, unknown> = { profile: { a: 1, b: 2 } }
      for (let c = 0; c < 80; c++) row[`c${c}`] = r
      return row
    })
    const columns = Array.from({ length: 40 }, (_, i) => `profile.missing_${i}`)
    const config = { ...baseConfig, blacklist: { tables: [], columns: { users: columns } } }
    const validator = new BlacklistValidator(new BlacklistManager(config as any))
    const columnList = Object.keys(rows[0] ?? {})

    const elapsed = medianElapsed(
      () => validator.filterColumns('users', rows, columnList).filteredRows
    )

    // ~70ms locally after folding against ~44ms before it: the fold costs about
    // 1.6x here. Scaled the same way as the cases above (a CI runner costs roughly
    // 3x this machine) that is ~210ms there, so the budget is 400ms: it clears CI
    // with margin and still fails loudly on the 417ms shape this guards, which is
    // what one uncached key scan per lookup measured.
    report('Column filtering (wide rows, dotted misses on a real head)', elapsed, 400)
    expect(elapsed).toBeLessThan(400)
  })

  it('Column filtering (nested wildcard rules over a nested column): < 60ms per call', () => {
    // The walk added so a dotted wildcard rule reaches a nested key: a rule set
    // with one dotted wildcard in it makes the masker enumerate the paths below
    // every top-level key that holds a record. Bounded twice — only such rules
    // trigger it, and only to the depth the longest of them could reach — but a
    // `jsonb` column of 20 keys over 1000 rows is the shape it costs on.
    const rows = Array.from({ length: 1000 }, (_, r) => {
      const profile: Record<string, unknown> = {}
      for (let k = 0; k < 20; k++) profile[`k${k}`] = r
      return { id: r, profile }
    })
    const columns = Array.from({ length: 10 }, (_, i) => `profile.miss${i}*`)
    const config = { ...baseConfig, blacklist: { tables: [], columns: { users: columns } } }
    const validator = new BlacklistValidator(new BlacklistManager(config as any))

    const elapsed = medianElapsed(
      () => validator.filterColumns('users', rows, ['id', 'profile']).filteredRows
    )

    // 4-10ms locally depending on load; 35ms keeps the same ~3x CI margin the
    // other cases in this file are set with, measured from the slower end.
    // Ten rules that match nothing are carried through every key of every row,
    // which depth narrowing cannot help with — they all match the head. What
    // makes it cheap is the transition memo: the same (rule set, key) question
    // is asked once per result rather than once per row. Without it this shape
    // measured 43ms, and 50 such rules 190ms.
    report('Column filtering (nested wildcard rules, all miss)', elapsed, 35)
    expect(elapsed).toBeLessThan(35)
  })

  it('Column filtering (nested wildcard rule matching every row): < 60ms per call', () => {
    // The half the miss case cannot see. A matching rule makes the walk find
    // something, which is where the removal happens, and the removal used to be
    // driven by the *keys* it found: this shape has 20 of them per row.
    const rows = Array.from({ length: 1000 }, (_, r) => {
      const profile: Record<string, unknown> = {}
      for (let k = 0; k < 20; k++) profile[`k${k}`] = r
      return { id: r, profile }
    })
    const config = {
      ...baseConfig,
      blacklist: { tables: [], columns: { users: ['profile.k*'] } },
    }
    const validator = new BlacklistValidator(new BlacklistManager(config as any))

    const elapsed = medianElapsed(
      () => validator.filterColumns('users', rows, ['id', 'profile']).filteredRows
    )

    report('Column filtering (nested wildcard rule, all hit)', elapsed, 25)
    expect(elapsed).toBeLessThan(25)
  })

  it('Column filtering (nested wildcard rule hitting a different key per row): < 80ms per call', () => {
    // The shape that made the first implementation quadratic: the rule matches
    // a key that is unique to each row, so listing the keys it hit grew a set
    // with one entry per key per row and rebuilt every record once per entry.
    // 200 rows measured 1.8s that way, and 1000 rows a full minute; matching on
    // the rule instead makes this linear.
    const rows = Array.from({ length: 1000 }, (_, r) => {
      const profile: Record<string, unknown> = {}
      for (let k = 0; k < 20; k++) profile[`u${r}_secret${k}`] = r
      return { id: r, profile }
    })
    const config = {
      ...baseConfig,
      blacklist: { tables: [], columns: { users: ['profile.u*'] } },
    }
    const validator = new BlacklistValidator(new BlacklistManager(config as any))

    const elapsed = medianElapsed(
      () => validator.filterColumns('users', rows, ['id', 'profile']).filteredRows
    )

    report('Column filtering (nested wildcard rule, key per row)', elapsed, 40)
    expect(elapsed).toBeLessThan(40)
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
