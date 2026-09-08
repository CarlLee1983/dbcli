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

    const hits = () => {
      let found = 0
      for (let i = 0; i < 1000; i++) {
        if (manager.isTableBlacklisted(`table_${i % 100}`)) found++
      }
      return found
    }
    const elapsed = medianElapsed(hits)

    // Measured on the runners this actually runs on (workflow run 34177694446,
    // the merge of DBCLI-015): 0.08ms ubuntu, 0.07ms macos, 0.27ms windows. The
    // slowest of the three leaves 2ms a 7.4x margin. This case does not guard the
    // linear-scan regression on its own — at 100 tables that shape is fast enough
    // to pass any budget loose enough not to be a coin flip. The scaling pair
    // below is what rejects it, which is why both scales are kept.
    // 絕對耗時只印不斷言。上面那段量測本身就說明了理由：它是 DBCLI-015 從單元測試
    // 搬過來的那一則，搬過來之後仍然是絕對比較，仍然會被負載翻掉。這一則自己也寫著
    // 它擋不住線性掃描的退步——那是下面那對比值在擋的。留在這裡的斷言是「查找真的
    // 發生過」：一千次查詢命中一千次，計數不會因為機器忙就變。
    report('Table lookup (100 tables, typical)', elapsed, 2)
    expect(hits()).toBe(1_000)
  })

  it('Table lookup (1000 tables): 1000 lookups in < 2ms', () => {
    const largeManager = new BlacklistManager(largeConfig as any)

    const hits = () => {
      let found = 0
      for (let i = 0; i < 1000; i++) {
        if (largeManager.isTableBlacklisted(`table_${i}`)) found++
      }
      return found
    }
    const elapsed = medianElapsed(hits)

    // Budget tightened from 10ms to 2ms by DBCLI-015. The lookup is set-backed, so
    // it does not care that the blacklist is ten times larger: same run as above,
    // 0.10ms ubuntu, 0.07ms macos, 0.20ms windows — indistinguishable from the
    // 100-table case, which is the point. The old 10ms was 100x the measurement.
    // This budget is a cost ceiling only; the linear-scan regression is rejected
    // by the scaling pair below, which does not depend on how fast the machine
    // reading it happens to be.
    // 同上：只印不斷言，線性掃描由下面那對比值否決。
    report('Table lookup (1000 tables)', elapsed, 2)
    expect(hits()).toBe(1_000)
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
  /**
   * Set-backed measures 1.03–1.15 across ubuntu, macos and windows runners; a
   * linear scan measures 8.33–9.49 on the same three (workflow run 34177694446).
   * The threshold sits between them with margin on both sides, and because a
   * ratio has no unit, a slow runner slows both halves.
   */
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

    const hits = () => {
      let found = 0
      for (let i = 0; i < 1000; i++) {
        if (largeManager.isColumnBlacklisted('table_50', `col_${i % 100}`)) found++
      }
      return found
    }
    const elapsed = medianElapsed(hits)

    // 只印不斷言，理由同上面兩則。斷言是查找真的發生過且答案沒有變：一千次查詢，
    // 一百個被列管的欄名輪流問，每一次都該命中。
    report('Column lookup (1000 lookups)', elapsed, 10)
    expect(hits()).toBe(1_000)
  })

  it('Column filtering (100 rows x 50 cols, omits 50): < 8ms per call', () => {
    const largeManager = new BlacklistManager(largeConfig as any)
    const largeValidator = new BlacklistValidator(largeManager)
    const columnList = Object.keys(largeRows[0] ?? {})

    const elapsed = medianElapsed(
      () => largeValidator.filterColumns('table_0', largeRows, columnList).filteredRows
    )

    const cost = largeValidator.filterColumns('table_0', largeRows, columnList).cost
    // 絕對耗時只印不斷言：同一個 commit 在忙碌的機器上會給出不同的判決
    // （DBCLI-019）。門在下面的計數上，那是這段程式做了多少事，不是機器多閒。
    report('Column filtering (100 rows x 50 cols)', elapsed, 8)
    // 100 列 × 51 個鍵，100 條規則全部由名稱比對答完，一列都不必往下走。
    // 退步的樣子是 nestedProbeRows 從 0 變成上萬。
    expect(cost.rowsScanned).toBe(100)
    expect(cost.keysScanned).toBe(5_100)
    expect(cost.ruleEvaluations).toBe(100)
    expect(cost.nestedProbeRows).toBe(0)
  })

  it('Column filtering (1000 rows x 7 cols, omits 3): < 5ms per call', () => {
    const elapsed = medianElapsed(
      () => typicalValidator.filterColumns('users', typicalRows, typicalColumnList).filteredRows
    )

    const cost = typicalValidator.filterColumns('users', typicalRows, typicalColumnList).cost
    // 絕對耗時只印不斷言：同一個 commit 在忙碌的機器上會給出不同的判決
    // （DBCLI-019）。門在下面的計數上，那是這段程式做了多少事，不是機器多閒。
    report('Column filtering (1000 rows x 7 cols)', elapsed, 5)
    // 一般設定：三條規則、七個欄位，走過一千列收名字就結束。
    expect(cost.rowsScanned).toBe(1_000)
    expect(cost.keysScanned).toBe(7_000)
    expect(cost.ruleEvaluations).toBe(3)
    expect(cost.nestedProbeRows).toBe(0)
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

    const cost = validator.filterColumns('orders', jsonRows, columnList).cost
    // 絕對耗時只印不斷言：同一個 commit 在忙碌的機器上會給出不同的判決
    // （DBCLI-019）。門在下面的計數上，那是這段程式做了多少事，不是機器多閒。
    report('Column filtering (100 rows, 5 dotted paths)', elapsed, 10)
    // 五條點分規則，每條切一次路徑；探測在第一列就命中，所以是 5 而不是 500。
    expect(cost.ruleEvaluations).toBe(5)
    expect(cost.pathSplits).toBe(5)
    expect(cost.nestedProbeRows).toBe(5)
  })

  it('Column filtering (1000 flattened docs): one nested row does not slow the other 999', () => {
    // The shape the Elasticsearch adapter actually produces: `_source` flattened
    // into dotted top-level keys with no nested records anywhere. Nothing here
    // covered it, which is how a 70x masking regression on real ES results passed
    // CI once — the other cases mask by plain column name and never exercise the
    // dotted branch on a wide result set.
    const flatDocs = () =>
      Array.from({ length: 1000 }, (_, i) => {
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
    const docs = flatDocs()
    // The same thousand rows with no nested document anywhere. It is the ratio's
    // denominator, not a gate: both sides are the same work on the same machine,
    // so load inflates them together and cancels.
    const allFlat = flatDocs()
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

    const flat = medianElapsed(
      () => validator.filterColumns('logs', allFlat, columnList).filteredRows
    )

    // What this gate has to reject is the per-row decision being made once for the
    // whole result set: that puts the 999 flat rows on the nested path, so the run
    // with one nested document costs several times the run without it. The ratio
    // says exactly that, and says it in a quantity load cannot move — measured
    // 0.77–0.94 idle and 0.50–1.25 under eight CPU-bound processes on this
    // ten-core machine, against a threshold of 3.
    //
    // The absolute number is printed, not asserted. Its 12ms ceiling came from CI
    // (2.59–5.53ms across the six matrix jobs) and held there, but on a loaded
    // machine the same commit measured 12.65–15.96ms and failed 2 runs in 5 while
    // nothing about the code had changed — DBCLI-019, EV-018 to EV-020.
    report('Column filtering (1000 flattened docs)', elapsed, 12)
    report('Column filtering (1000 flattened docs, none nested) [ratio denominator]', flat, 12)
    expect(elapsed / Math.max(flat, 0.001)).toBeLessThan(3)
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
    const cost = validator.filterColumns('users', rows, columnList).cost
    // 絕對耗時只印不斷言：同一個 commit 在忙碌的機器上會給出不同的判決
    // （DBCLI-019）。門在下面的計數上，那是這段程式做了多少事，不是機器多閒。
    report('Column filtering (60 missing dotted rules)', elapsed, 6)
    // 這一則的全部意義：規則的頭在任何一列都不是物件，所以 nestedHeads 在碰任何
    // 一列之前就否決掉全部 60 條。退步是把那個判斷搬回每列做一次——60,000 次探測
    // 與 60 次切分，兩個數字都不會因為機器忙就變。
    expect(cost.ruleEvaluations).toBe(61)
    expect(cost.nestedProbeRows).toBe(0)
    expect(cost.pathSplits).toBe(0)
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
    const cost = validator.filterColumns('users', rows, columnList).cost
    // 絕對耗時只印不斷言：同一個 commit 在忙碌的機器上會給出不同的判決
    // （DBCLI-019）。門在下面的計數上，那是這段程式做了多少事，不是機器多閒。
    report('Column filtering (wide rows, dotted misses on a real head)', elapsed, 400)
    // 頭是真的巢狀物件，所以每條規則都要走完兩千列：40 × 2000。這是這一則要盯住
    // 的形狀——每次查找退回一次整列掃描時，走過的列數不變而時間爆掉，所以時間仍
    // 然印出來給人看，數量則保證走的是同一條路。
    expect(cost.rowsScanned).toBe(2_000)
    expect(cost.keysScanned).toBe(162_000)
    expect(cost.ruleEvaluations).toBe(40)
    expect(cost.nestedProbeRows).toBe(80_000)
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
    const cost = validator.filterColumns('users', rows, ['id', 'profile']).cost
    // 絕對耗時只印不斷言：同一個 commit 在忙碌的機器上會給出不同的判決
    // （DBCLI-019）。門在下面的計數上，那是這段程式做了多少事，不是機器多閒。
    report('Column filtering (nested wildcard rules, all miss)', elapsed, 35)
    // 十條萬用字元規則全部落空：字面探測走一千列 × 十條，巢狀走訪再走一千列，
    // 而一條都沒有命中。
    expect(cost.ruleEvaluations).toBe(10)
    expect(cost.nestedProbeRows).toBe(10_000)
    expect(cost.nestedGlobRows).toBe(1_000)
    expect(cost.nestedGlobMatches).toBe(0)
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

    const cost = validator.filterColumns('users', rows, ['id', 'profile']).cost
    // 絕對耗時只印不斷言：同一個 commit 在忙碌的機器上會給出不同的判決
    // （DBCLI-019）。門在下面的計數上，那是這段程式做了多少事，不是機器多閒。
    report('Column filtering (nested wildcard rule, all hit)', elapsed, 25)
    // 命中就停：巢狀走訪在第一列把唯一的規則消掉，所以是 1 列 1 條。
    expect(cost.nestedGlobRows).toBe(1)
    expect(cost.nestedGlobMatches).toBe(1)
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

    const cost = validator.filterColumns('users', rows, ['id', 'profile']).cost
    // 絕對耗時只印不斷言：同一個 commit 在忙碌的機器上會給出不同的判決
    // （DBCLI-019）。門在下面的計數上，那是這段程式做了多少事，不是機器多閒。
    report('Column filtering (nested wildcard rule, key per row)', elapsed, 40)
    // 一條規則在每一列命中不同的鍵，收的仍然是規則不是鍵——所以是 1。收成鍵的
    // 那個退步會讓移除階段把每列重建一次（200 列 × 20 鍵量到 1.8 秒），在這裡表現
    // 為 nestedGlobMatches 變成上千。
    expect(cost.nestedGlobRows).toBe(1)
    expect(cost.nestedGlobMatches).toBe(1)
  })

  it('Config loading - typical blacklist', () => {
    const elapsed = medianElapsed(() => new BlacklistManager(typicalConfig as any))

    // 只印不斷言。載入成本的退步會是「規模上去成本非線性上去」，那是下面那一則比值
    // 在擋的；單一絕對值在忙碌的機器上只會翻判決。這裡斷言載入真的把設定讀進去了。
    report('Config loading (typical)', elapsed, 5)
    const manager = new BlacklistManager(typicalConfig as any)
    expect(manager.getBlacklistedColumns('users')).toHaveLength(3)
  })

  it('Config loading - large blacklist (1000 tables)', () => {
    const elapsed = medianElapsed(() => new BlacklistManager(largeConfig as any))

    report('Config loading (1000 tables)', elapsed, 50)
    const manager = new BlacklistManager(largeConfig as any)
    expect(manager.getBlacklistedColumns('table_0')).toHaveLength(100)
  })

  it('Config loading cost does not grow faster than the blacklist', () => {
    // 載入是線性的，所以十倍的規模就是大約十倍的成本——量到 10.34，門檻放在 25。
    // 這裡不能用 MAX_SIZE_SCALING（那是給 O(1) 查找的 3 倍門檻，線性載入必然超過）。
    // 退回「每個條目都要跟其他條目比一次」那種形狀，比值會是上百。比值兩邊在同一台
    // 機器上量，負載同時放大所以抵消。
    const load = (size: number) => {
      const tables = Array.from({ length: size }, (_, i) => `table_${i}`)
      const columns: Record<string, string[]> = {}
      for (let i = 0; i < size; i++) {
        columns[`table_${i}`] = ['password', 'ssn']
      }
      const config = { ...baseConfig, blacklist: { tables, columns } }
      return medianElapsed(() => new BlacklistManager(config as any))
    }
    const small = load(100)
    const large = load(1_000)
    const ratio = large / Math.max(small, 0.001)

    const MAX_LOAD_SCALING = 25
    console.log(
      `Config loading 1000-vs-100 cost ratio = ${ratio.toFixed(2)} (max ${MAX_LOAD_SCALING})`
    )
    expect(ratio).toBeLessThan(MAX_LOAD_SCALING)
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

    // 只印不斷言。門在每一次呼叫做了多少事上：一列、三個鍵、三條規則，一次都不必
    // 往下走。每查詢多走一列或多探一次，這裡就會變。
    report('Per-query overhead', perQuery, 1)
    const cost = validator.filterColumns(
      'users',
      [{ id: 1, password: 'hash', email: 'e@e.com' }],
      ['id', 'password', 'email']
    ).cost
    expect(cost.rowsScanned).toBe(1)
    expect(cost.keysScanned).toBe(3)
    expect(cost.ruleEvaluations).toBe(3)
    expect(cost.nestedProbeRows).toBe(0)
  })
})
