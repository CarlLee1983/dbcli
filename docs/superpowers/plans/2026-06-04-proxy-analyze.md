# `dbcli proxy analyze` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `dbcli proxy analyze` — an offline command that aggregates a proxy event log (`.dbcli/proxy/events.jsonl` + rotated `.1`) into an agent-facing JSON report (and a secondary text view).

**Architecture:** A pure aggregation core (`src/proxy/analyze.ts`) turns `ProxyEvent[]` into an `AnalysisReport` via small per-block builder functions. A tolerant reader (`src/proxy/event-reader.ts`) loads + parses the JSONL files. A text renderer (`src/proxy/analyze-render.ts`) formats the report. The `proxy analyze` subcommand wires reader → analyze → renderer → stdout. No database connection.

**Tech Stack:** Bun, TypeScript, `bun test`, commander; reuses `redactLiterals` from `src/proxy/sql-metadata.ts` and the `ProxyEvent` types from `src/proxy/events.ts`.

**Spec:** [`docs/superpowers/specs/2026-06-04-proxy-analyze-design.md`](../specs/2026-06-04-proxy-analyze-design.md)

**Verification commands (used throughout):**
- Single test file: `bun test tests/unit/proxy/<file>.test.ts`
- Typecheck: `bun run typecheck`
- Full gate: `bun run test:unit && bun run typecheck && bun run lint`

---

## File Structure

| File | Responsibility |
|------|----------------|
| `src/proxy/analyze.ts` | Types (`AnalysisReport` et al.) + pure helpers (`percentile`, `fingerprintSql`) + per-block builders + `analyzeEvents` orchestrator |
| `src/proxy/event-reader.ts` | Read current (+ `.1`) JSONL, tolerant parse (skip + count malformed), merge-sort by timestamp |
| `src/proxy/analyze-render.ts` | `renderAnalysisText(report, top)` — text view |
| `src/commands/proxy.ts` | Add `analyze` subcommand wiring (modify) |
| `tests/unit/proxy/event-fixtures.ts` | Shared synthetic-event factories for tests |
| `tests/unit/proxy/analyze.test.ts` | Unit tests for analyze core |
| `tests/unit/proxy/event-reader.test.ts` | Unit tests for the reader |
| `tests/unit/proxy/analyze-render.test.ts` | Smoke tests for the text renderer |
| `tests/integration/proxy-analyze.test.ts` | End-to-end CLI test (fixture file → JSON output) |

---

## Task 1: analyze.ts foundation — types + `percentile` + `fingerprintSql`

**Files:**
- Create: `src/proxy/analyze.ts`
- Create: `tests/unit/proxy/event-fixtures.ts`
- Test: `tests/unit/proxy/analyze.test.ts`

- [ ] **Step 1: Create the shared test fixtures**

Create `tests/unit/proxy/event-fixtures.ts`:

```ts
// tests/unit/proxy/event-fixtures.ts
import type {
  ProxyEvent,
  QueryCompletedEvent,
  QueryErroredEvent,
} from '@/proxy/events'

export function completed(overrides: Partial<QueryCompletedEvent> = {}): QueryCompletedEvent {
  return {
    version: 1,
    type: 'query_completed',
    timestamp: '2026-06-04T12:00:00.000Z',
    engine: 'mysql',
    sessionId: 'pxy_1',
    queryId: 'qry_1',
    client: '127.0.0.1:1',
    target: '127.0.0.1:3306',
    sql: 'SELECT * FROM users WHERE id = 1',
    statement: 'SELECT',
    tables: ['users'],
    durationMs: 10,
    requestBytes: 64,
    responseBytes: 128,
    rowCount: 1,
    slow: false,
    error: null,
    tags: [],
    ...overrides,
  }
}

export function errored(overrides: Partial<QueryErroredEvent> = {}): QueryErroredEvent {
  return {
    version: 1,
    type: 'query_errored',
    timestamp: '2026-06-04T12:00:00.000Z',
    engine: 'mysql',
    sessionId: 'pxy_1',
    queryId: 'qry_err_1',
    client: '127.0.0.1:1',
    target: '127.0.0.1:3306',
    sql: "SELECT * FROM missing WHERE id = 1",
    statement: 'SELECT',
    tables: ['missing'],
    durationMs: 5,
    requestBytes: 32,
    responseBytes: 16,
    rowCount: null,
    error: { code: '1146', message: "Table 'missing' doesn't exist" },
    tags: [],
    ...overrides,
  }
}

export function sessionStarted(sessionId: string): ProxyEvent {
  return {
    version: 1,
    type: 'session_started',
    timestamp: '2026-06-04T12:00:00.000Z',
    engine: 'mysql',
    sessionId,
    client: '127.0.0.1:1',
    target: '127.0.0.1:3306',
  }
}
```

- [ ] **Step 2: Write failing tests for `percentile` and `fingerprintSql`**

Create `tests/unit/proxy/analyze.test.ts`:

```ts
// tests/unit/proxy/analyze.test.ts
import { describe, it, expect } from 'bun:test'
import { percentile, fingerprintSql } from '@/proxy/analyze'

describe('percentile', () => {
  it('returns 0 for an empty set', () => {
    expect(percentile([], 95)).toBe(0)
  })
  it('returns the only value for a single-element set', () => {
    expect(percentile([42], 50)).toBe(42)
    expect(percentile([42], 99)).toBe(42)
  })
  it('uses nearest-rank (p50/p95/p99 of 1..100)', () => {
    const vals = Array.from({ length: 100 }, (_, i) => i + 1) // 1..100
    expect(percentile(vals, 50)).toBe(50)
    expect(percentile(vals, 95)).toBe(95)
    expect(percentile(vals, 99)).toBe(99)
  })
  it('does not mutate the input array', () => {
    const vals = [3, 1, 2]
    percentile(vals, 50)
    expect(vals).toEqual([3, 1, 2])
  })
})

describe('fingerprintSql', () => {
  it('replaces literals with ? and collapses whitespace', () => {
    expect(fingerprintSql('SELECT *  FROM users   WHERE id = 42')).toBe(
      'SELECT * FROM users WHERE id = ?'
    )
  })
  it('maps different literal values to the same fingerprint', () => {
    expect(fingerprintSql('SELECT * FROM t WHERE id = 1')).toBe(
      fingerprintSql('SELECT * FROM t WHERE id = 999')
    )
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `bun test tests/unit/proxy/analyze.test.ts`
Expected: FAIL — `Cannot find module '@/proxy/analyze'`.

- [ ] **Step 4: Create `src/proxy/analyze.ts` with types + the two helpers**

```ts
// src/proxy/analyze.ts
import { redactLiterals, type StatementType } from './sql-metadata'
import type { ProxyEngine, ProxyEvent, QueryCompletedEvent, QueryErroredEvent } from './events'

export interface LatencyStats {
  p50: number
  p95: number
  p99: number
  max: number
}

export interface AnalysisSummary {
  sessions: number
  queries: number
  errors: number
  errorRate: number
  parseErrors: number
  slowCount: number
  latencyMs: LatencyStats
  bytes: { request: number; response: number }
}

export interface FingerprintStat {
  fingerprint: string
  statement: StatementType
  tables: string[]
  count: number
  durationMs: { total: number; avg: number; p95: number; max: number }
  rowsAvg: number
  bytesAvg: { request: number; response: number }
  errorCount: number
  slowCount: number
  redacted: boolean
  exampleSql: string
  exampleQueryId: string
  suggestedCommands?: string[]
}

export interface SlowQuery {
  queryId: string
  durationMs: number
  sql: string
  statement: StatementType
  tables: string[]
  timestamp: string
  sessionId: string
}

export interface ErrorGroup {
  code: string | null
  message: string
  count: number
  fingerprint: string
  exampleSql: string
}

export interface HotTable {
  table: string
  queryCount: number
  totalDurationMs: number
}

export interface RepetitionGroup {
  fingerprint: string
  sessionId: string
  count: number
  spanMs: number
  totalDurationMs: number
  tables: string[]
}

export interface AnalysisReport {
  version: 1
  tool: 'proxy-analyze'
  engine: ProxyEngine | null
  source: {
    files: string[]
    eventsRead: number
    malformedLines: number
    timeSpan: { from: string | null; to: string | null; durationMs: number }
  }
  summary: AnalysisSummary
  byFingerprint: FingerprintStat[]
  slowest: SlowQuery[]
  errors: ErrorGroup[]
  hotTables: HotTable[]
  repetition: RepetitionGroup[]
}

export interface AnalyzeOptions {
  slowMs: number
  top: number
  nPlusOne: number
  sourceFiles: string[]
  malformedLines: number
}

export const isCompleted = (e: ProxyEvent): e is QueryCompletedEvent =>
  e.type === 'query_completed'
export const isErrored = (e: ProxyEvent): e is QueryErroredEvent => e.type === 'query_errored'

/** Nearest-rank percentile. Returns 0 for an empty set. Does not mutate input. */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const rank = Math.ceil((p / 100) * sorted.length)
  const idx = Math.min(Math.max(rank, 1), sorted.length) - 1
  return sorted[idx]!
}

/** Normalize SQL into a grouping key: literals -> ?, whitespace collapsed, trimmed. */
export function fingerprintSql(sql: string): string {
  return redactLiterals(sql).replace(/\s+/g, ' ').trim()
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test tests/unit/proxy/analyze.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add src/proxy/analyze.ts tests/unit/proxy/analyze.test.ts tests/unit/proxy/event-fixtures.ts
git commit -m "feat: [proxy] analyze foundation — types, percentile, fingerprintSql"
```

---

## Task 2: `buildSummary`

**Files:**
- Modify: `src/proxy/analyze.ts`
- Test: `tests/unit/proxy/analyze.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `tests/unit/proxy/analyze.test.ts`:

```ts
import { buildSummary } from '@/proxy/analyze'
import { completed, errored, sessionStarted } from './event-fixtures'

describe('buildSummary', () => {
  it('counts queries, errors, sessions and error rate', () => {
    const events = [
      sessionStarted('pxy_1'),
      sessionStarted('pxy_2'),
      completed({ durationMs: 10 }),
      completed({ durationMs: 20 }),
      errored(),
    ]
    const s = buildSummary(events, 1000)
    expect(s.sessions).toBe(2)
    expect(s.queries).toBe(2)
    expect(s.errors).toBe(1)
    expect(s.errorRate).toBeCloseTo(1 / 3, 5)
  })

  it('returns errorRate 0 when there are no queries or errors', () => {
    expect(buildSummary([sessionStarted('pxy_1')], 1000).errorRate).toBe(0)
  })

  it('computes slowCount with the analyze threshold, not the event slow flag', () => {
    const events = [
      completed({ durationMs: 100, slow: true }), // under 500 -> not slow per analyze
      completed({ durationMs: 800, slow: false }), // over 500 -> slow per analyze
    ]
    expect(buildSummary(events, 500).slowCount).toBe(1)
  })

  it('sums bytes and computes latency percentiles over completed only', () => {
    const events = [
      completed({ durationMs: 10, requestBytes: 1, responseBytes: 2 }),
      completed({ durationMs: 30, requestBytes: 3, responseBytes: 4 }),
      errored({ durationMs: 9999 }), // must not affect latency
    ]
    const s = buildSummary(events, 1000)
    expect(s.bytes).toEqual({ request: 4, response: 6 })
    expect(s.latencyMs.max).toBe(30)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test tests/unit/proxy/analyze.test.ts`
Expected: FAIL — `buildSummary` is not exported.

- [ ] **Step 3: Implement `buildSummary`**

Append to `src/proxy/analyze.ts`:

```ts
export function buildSummary(events: ProxyEvent[], slowMs: number): AnalysisSummary {
  const completed = events.filter(isCompleted)
  const errored = events.filter(isErrored)
  const durations = completed.map((e) => e.durationMs)
  const queries = completed.length
  const errors = errored.length
  const denom = queries + errors
  return {
    sessions: new Set(
      events.filter((e) => e.type === 'session_started').map((e) => e.sessionId)
    ).size,
    queries,
    errors,
    errorRate: denom === 0 ? 0 : errors / denom,
    parseErrors: events.filter((e) => e.type === 'parse_error').length,
    slowCount: completed.filter((e) => e.durationMs >= slowMs).length,
    latencyMs: {
      p50: percentile(durations, 50),
      p95: percentile(durations, 95),
      p99: percentile(durations, 99),
      max: durations.length ? Math.max(...durations) : 0,
    },
    bytes: {
      request: completed.reduce((sum, e) => sum + e.requestBytes, 0),
      response: completed.reduce((sum, e) => sum + e.responseBytes, 0),
    },
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `bun test tests/unit/proxy/analyze.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/proxy/analyze.ts tests/unit/proxy/analyze.test.ts
git commit -m "feat: [proxy] analyze buildSummary"
```

---

## Task 3: `buildByFingerprint` (+ shell-escape + suggestedCommands)

**Files:**
- Modify: `src/proxy/analyze.ts`
- Test: `tests/unit/proxy/analyze.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `tests/unit/proxy/analyze.test.ts`:

```ts
import { buildByFingerprint } from '@/proxy/analyze'

describe('buildByFingerprint', () => {
  it('groups by fingerprint and sorts by total duration desc', () => {
    const events = [
      completed({ sql: 'SELECT * FROM a WHERE id = 1', tables: ['a'], durationMs: 5 }),
      completed({ sql: 'SELECT * FROM a WHERE id = 2', tables: ['a'], durationMs: 7 }),
      completed({ sql: 'SELECT * FROM b WHERE id = 1', tables: ['b'], durationMs: 100 }),
    ]
    const stats = buildByFingerprint(events, 1000, 20)
    expect(stats).toHaveLength(2)
    expect(stats[0]!.fingerprint).toBe('SELECT * FROM b WHERE id = ?')
    const a = stats.find((s) => s.tables[0] === 'a')!
    expect(a.count).toBe(2)
    expect(a.durationMs.total).toBe(12)
  })

  it('keeps the slowest occurrence as the example and counts errors per fingerprint', () => {
    const events = [
      completed({ sql: 'SELECT * FROM a WHERE id = 1', durationMs: 5, queryId: 'q1' }),
      completed({ sql: 'SELECT * FROM a WHERE id = 2', durationMs: 50, queryId: 'q2' }),
      errored({ sql: 'SELECT * FROM a WHERE id = 9', tables: ['a'] }),
    ]
    const [a] = buildByFingerprint(events, 1000, 20)
    expect(a!.exampleQueryId).toBe('q2')
    expect(a!.exampleSql).toBe('SELECT * FROM a WHERE id = 2')
    expect(a!.errorCount).toBe(1)
  })

  it('attaches suggestedCommands only to top-N SELECT fingerprints', () => {
    const events = [
      completed({ sql: 'SELECT * FROM a WHERE id = 1', statement: 'SELECT', durationMs: 100 }),
      completed({
        sql: 'UPDATE b SET x = 1 WHERE id = 1',
        statement: 'UPDATE',
        tables: ['b'],
        durationMs: 200,
      }),
    ]
    const stats = buildByFingerprint(events, 1000, 20)
    const sel = stats.find((s) => s.statement === 'SELECT')!
    const upd = stats.find((s) => s.statement === 'UPDATE')!
    expect(sel.suggestedCommands).toEqual([
      'dbcli explain "SELECT * FROM a WHERE id = 1"',
      'dbcli guide missing-index-for "SELECT * FROM a WHERE id = 1"',
    ])
    expect(upd.suggestedCommands).toBeUndefined()
  })

  it('does not attach suggestedCommands beyond the top cutoff', () => {
    const events = [
      completed({ sql: 'SELECT * FROM a WHERE id = 1', durationMs: 100, tables: ['a'] }),
      completed({ sql: 'SELECT * FROM b WHERE id = 1', durationMs: 10, tables: ['b'] }),
    ]
    const stats = buildByFingerprint(events, 1000, 1) // top=1
    expect(stats[0]!.suggestedCommands).toBeDefined()
    expect(stats[1]!.suggestedCommands).toBeUndefined()
  })

  it('flags redacted when the example SQL has no substitutable literals', () => {
    const events = [completed({ sql: 'SELECT * FROM a WHERE id = ?', tables: ['a'] })]
    expect(buildByFingerprint(events, 1000, 20)[0]!.redacted).toBe(true)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test tests/unit/proxy/analyze.test.ts`
Expected: FAIL — `buildByFingerprint` not exported.

- [ ] **Step 3: Implement `shellEscapeDq` + `buildByFingerprint`**

Append to `src/proxy/analyze.ts`:

```ts
/** Escape a string for embedding inside a double-quoted shell argument. */
function shellEscapeDq(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

export function buildByFingerprint(
  events: ProxyEvent[],
  slowMs: number,
  top: number
): FingerprintStat[] {
  const errorByFp = new Map<string, number>()
  for (const e of events.filter(isErrored)) {
    const fp = fingerprintSql(e.sql)
    errorByFp.set(fp, (errorByFp.get(fp) ?? 0) + 1)
  }

  interface Acc {
    fingerprint: string
    statement: StatementType
    tables: string[]
    durations: number[]
    reqBytes: number
    respBytes: number
    rows: number[]
    slowCount: number
    exampleSql: string
    exampleQueryId: string
    exampleDuration: number
  }
  const groups = new Map<string, Acc>()
  for (const e of events.filter(isCompleted)) {
    const fp = fingerprintSql(e.sql)
    let g = groups.get(fp)
    if (!g) {
      g = {
        fingerprint: fp,
        statement: e.statement,
        tables: e.tables,
        durations: [],
        reqBytes: 0,
        respBytes: 0,
        rows: [],
        slowCount: 0,
        exampleSql: e.sql,
        exampleQueryId: e.queryId,
        exampleDuration: e.durationMs,
      }
      groups.set(fp, g)
    }
    g.durations.push(e.durationMs)
    g.reqBytes += e.requestBytes
    g.respBytes += e.responseBytes
    if (e.rowCount !== null) g.rows.push(e.rowCount)
    if (e.durationMs >= slowMs) g.slowCount += 1
    if (e.durationMs > g.exampleDuration) {
      g.exampleDuration = e.durationMs
      g.exampleSql = e.sql
      g.exampleQueryId = e.queryId
    }
  }

  const stats: FingerprintStat[] = [...groups.values()].map((g) => {
    const count = g.durations.length
    const total = g.durations.reduce((sum, d) => sum + d, 0)
    return {
      fingerprint: g.fingerprint,
      statement: g.statement,
      tables: g.tables,
      count,
      durationMs: {
        total,
        avg: count ? Math.round(total / count) : 0,
        p95: percentile(g.durations, 95),
        max: count ? Math.max(...g.durations) : 0,
      },
      rowsAvg: g.rows.length
        ? Math.round(g.rows.reduce((sum, r) => sum + r, 0) / g.rows.length)
        : 0,
      bytesAvg: {
        request: count ? Math.round(g.reqBytes / count) : 0,
        response: count ? Math.round(g.respBytes / count) : 0,
      },
      errorCount: errorByFp.get(g.fingerprint) ?? 0,
      slowCount: g.slowCount,
      redacted: redactLiterals(g.exampleSql) === g.exampleSql,
      exampleSql: g.exampleSql,
      exampleQueryId: g.exampleQueryId,
    }
  })

  stats.sort((a, b) => b.durationMs.total - a.durationMs.total)

  return stats.map((s, i) => {
    if (i < top && s.statement === 'SELECT') {
      const sql = shellEscapeDq(s.exampleSql)
      return {
        ...s,
        suggestedCommands: [
          `dbcli explain "${sql}"`,
          `dbcli guide missing-index-for "${sql}"`,
        ],
      }
    }
    return s
  })
}
```

- [ ] **Step 4: Run to verify pass**

Run: `bun test tests/unit/proxy/analyze.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/proxy/analyze.ts tests/unit/proxy/analyze.test.ts
git commit -m "feat: [proxy] analyze buildByFingerprint + suggestedCommands"
```

---

## Task 4: `buildSlowest`

**Files:**
- Modify: `src/proxy/analyze.ts`
- Test: `tests/unit/proxy/analyze.test.ts`

- [ ] **Step 1: Add failing test**

Append to `tests/unit/proxy/analyze.test.ts`:

```ts
import { buildSlowest } from '@/proxy/analyze'

describe('buildSlowest', () => {
  it('returns the top-N completed queries by duration desc', () => {
    const events = [
      completed({ durationMs: 10, queryId: 'a' }),
      completed({ durationMs: 90, queryId: 'b' }),
      completed({ durationMs: 50, queryId: 'c' }),
      errored({ durationMs: 999 }), // excluded
    ]
    const slow = buildSlowest(events, 2)
    expect(slow.map((q) => q.queryId)).toEqual(['b', 'c'])
    expect(slow[0]!.durationMs).toBe(90)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test tests/unit/proxy/analyze.test.ts`
Expected: FAIL — `buildSlowest` not exported.

- [ ] **Step 3: Implement `buildSlowest`**

Append to `src/proxy/analyze.ts`:

```ts
export function buildSlowest(events: ProxyEvent[], top: number): SlowQuery[] {
  return events
    .filter(isCompleted)
    .sort((a, b) => b.durationMs - a.durationMs)
    .slice(0, top)
    .map((e) => ({
      queryId: e.queryId,
      durationMs: e.durationMs,
      sql: e.sql,
      statement: e.statement,
      tables: e.tables,
      timestamp: e.timestamp,
      sessionId: e.sessionId,
    }))
}
```

- [ ] **Step 4: Run to verify pass**

Run: `bun test tests/unit/proxy/analyze.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/proxy/analyze.ts tests/unit/proxy/analyze.test.ts
git commit -m "feat: [proxy] analyze buildSlowest"
```

---

## Task 5: `buildErrors`

**Files:**
- Modify: `src/proxy/analyze.ts`
- Test: `tests/unit/proxy/analyze.test.ts`

- [ ] **Step 1: Add failing test**

Append to `tests/unit/proxy/analyze.test.ts`:

```ts
import { buildErrors } from '@/proxy/analyze'

describe('buildErrors', () => {
  it('groups errors by code+message and sorts by count desc', () => {
    const events = [
      errored({ error: { code: '1146', message: 'no table' }, sql: 'SELECT * FROM x WHERE a = 1' }),
      errored({ error: { code: '1146', message: 'no table' }, sql: 'SELECT * FROM x WHERE a = 2' }),
      errored({ error: { code: '1064', message: 'syntax' }, sql: 'SELEC 1' }),
    ]
    const groups = buildErrors(events)
    expect(groups).toHaveLength(2)
    expect(groups[0]!.code).toBe('1146')
    expect(groups[0]!.count).toBe(2)
    expect(groups[0]!.fingerprint).toBe('SELECT * FROM x WHERE a = ?')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test tests/unit/proxy/analyze.test.ts`
Expected: FAIL — `buildErrors` not exported.

- [ ] **Step 3: Implement `buildErrors`**

Append to `src/proxy/analyze.ts`:

```ts
export function buildErrors(events: ProxyEvent[]): ErrorGroup[] {
  interface Acc {
    code: string | null
    message: string
    count: number
    fingerprint: string
    exampleSql: string
  }
  const groups = new Map<string, Acc>()
  for (const e of events.filter(isErrored)) {
    const key = `${e.error.code ?? ''} ${e.error.message}`
    let g = groups.get(key)
    if (!g) {
      g = {
        code: e.error.code,
        message: e.error.message,
        count: 0,
        fingerprint: fingerprintSql(e.sql),
        exampleSql: e.sql,
      }
      groups.set(key, g)
    }
    g.count += 1
  }
  return [...groups.values()].sort((a, b) => b.count - a.count)
}
```

- [ ] **Step 4: Run to verify pass**

Run: `bun test tests/unit/proxy/analyze.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/proxy/analyze.ts tests/unit/proxy/analyze.test.ts
git commit -m "feat: [proxy] analyze buildErrors"
```

---

## Task 6: `buildHotTables`

**Files:**
- Modify: `src/proxy/analyze.ts`
- Test: `tests/unit/proxy/analyze.test.ts`

- [ ] **Step 1: Add failing test**

Append to `tests/unit/proxy/analyze.test.ts`:

```ts
import { buildHotTables } from '@/proxy/analyze'

describe('buildHotTables', () => {
  it('counts queries and total duration per table, sorted by count desc', () => {
    const events = [
      completed({ tables: ['users'], durationMs: 10 }),
      completed({ tables: ['users', 'orders'], durationMs: 20 }),
      completed({ tables: ['orders'], durationMs: 5 }),
    ]
    const hot = buildHotTables(events)
    expect(hot[0]).toEqual({ table: 'users', queryCount: 2, totalDurationMs: 30 })
    const orders = hot.find((h) => h.table === 'orders')!
    expect(orders.queryCount).toBe(2)
    expect(orders.totalDurationMs).toBe(25)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test tests/unit/proxy/analyze.test.ts`
Expected: FAIL — `buildHotTables` not exported.

- [ ] **Step 3: Implement `buildHotTables`**

Append to `src/proxy/analyze.ts`:

```ts
export function buildHotTables(events: ProxyEvent[]): HotTable[] {
  const map = new Map<string, { queryCount: number; totalDurationMs: number }>()
  for (const e of events.filter(isCompleted)) {
    for (const t of e.tables) {
      let g = map.get(t)
      if (!g) {
        g = { queryCount: 0, totalDurationMs: 0 }
        map.set(t, g)
      }
      g.queryCount += 1
      g.totalDurationMs += e.durationMs
    }
  }
  return [...map.entries()]
    .map(([table, g]) => ({ table, queryCount: g.queryCount, totalDurationMs: g.totalDurationMs }))
    .sort((a, b) => b.queryCount - a.queryCount)
}
```

- [ ] **Step 4: Run to verify pass**

Run: `bun test tests/unit/proxy/analyze.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/proxy/analyze.ts tests/unit/proxy/analyze.test.ts
git commit -m "feat: [proxy] analyze buildHotTables"
```

---

## Task 7: `buildRepetition`

**Files:**
- Modify: `src/proxy/analyze.ts`
- Test: `tests/unit/proxy/analyze.test.ts`

- [ ] **Step 1: Add failing test**

Append to `tests/unit/proxy/analyze.test.ts`:

```ts
import { buildRepetition } from '@/proxy/analyze'

describe('buildRepetition', () => {
  it('flags (session, fingerprint) groups at or above the threshold', () => {
    const base = (id: number, ts: string) =>
      completed({
        sessionId: 'pxy_1',
        sql: `SELECT * FROM items WHERE order_id = ${id}`,
        tables: ['items'],
        durationMs: 2,
        timestamp: ts,
      })
    const events = [
      base(1, '2026-06-04T12:00:00.000Z'),
      base(2, '2026-06-04T12:00:00.500Z'),
      base(3, '2026-06-04T12:00:01.000Z'),
      completed({ sessionId: 'pxy_2', sql: 'SELECT 1' }), // different session/fingerprint
    ]
    const rep = buildRepetition(events, 3)
    expect(rep).toHaveLength(1)
    expect(rep[0]!.count).toBe(3)
    expect(rep[0]!.sessionId).toBe('pxy_1')
    expect(rep[0]!.fingerprint).toBe('SELECT * FROM items WHERE order_id = ?')
    expect(rep[0]!.spanMs).toBe(1000)
    expect(rep[0]!.totalDurationMs).toBe(6)
  })

  it('does not flag groups below the threshold', () => {
    const events = [completed({ sql: 'SELECT * FROM a WHERE id = 1' })]
    expect(buildRepetition(events, 10)).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test tests/unit/proxy/analyze.test.ts`
Expected: FAIL — `buildRepetition` not exported.

- [ ] **Step 3: Implement `buildRepetition`**

Append to `src/proxy/analyze.ts`:

```ts
export function buildRepetition(events: ProxyEvent[], threshold: number): RepetitionGroup[] {
  interface Acc {
    fingerprint: string
    sessionId: string
    tables: string[]
    count: number
    totalDurationMs: number
    minTs: number
    maxTs: number
  }
  const groups = new Map<string, Acc>()
  for (const e of events.filter(isCompleted)) {
    const fp = fingerprintSql(e.sql)
    const key = `${e.sessionId} ${fp}`
    const ts = Date.parse(e.timestamp)
    let g = groups.get(key)
    if (!g) {
      g = {
        fingerprint: fp,
        sessionId: e.sessionId,
        tables: e.tables,
        count: 0,
        totalDurationMs: 0,
        minTs: ts,
        maxTs: ts,
      }
      groups.set(key, g)
    }
    g.count += 1
    g.totalDurationMs += e.durationMs
    if (ts < g.minTs) g.minTs = ts
    if (ts > g.maxTs) g.maxTs = ts
  }
  return [...groups.values()]
    .filter((g) => g.count >= threshold)
    .map((g) => ({
      fingerprint: g.fingerprint,
      sessionId: g.sessionId,
      count: g.count,
      spanMs: g.maxTs - g.minTs,
      totalDurationMs: g.totalDurationMs,
      tables: g.tables,
    }))
    .sort((a, b) => b.count - a.count)
}
```

- [ ] **Step 4: Run to verify pass**

Run: `bun test tests/unit/proxy/analyze.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/proxy/analyze.ts tests/unit/proxy/analyze.test.ts
git commit -m "feat: [proxy] analyze buildRepetition"
```

---

## Task 8: `analyzeEvents` orchestrator

**Files:**
- Modify: `src/proxy/analyze.ts`
- Test: `tests/unit/proxy/analyze.test.ts`

- [ ] **Step 1: Add failing test**

Append to `tests/unit/proxy/analyze.test.ts`:

```ts
import { analyzeEvents } from '@/proxy/analyze'

describe('analyzeEvents', () => {
  const opts = { slowMs: 1000, top: 20, nPlusOne: 10, sourceFiles: ['x.jsonl'], malformedLines: 2 }

  it('assembles all blocks with source metadata and time span', () => {
    const events = [
      sessionStarted('pxy_1'),
      completed({ durationMs: 10, timestamp: '2026-06-04T12:00:00.000Z' }),
      completed({ durationMs: 30, timestamp: '2026-06-04T12:00:02.000Z' }),
      errored({ timestamp: '2026-06-04T12:00:01.000Z' }),
    ]
    const r = analyzeEvents(events, opts)
    expect(r.version).toBe(1)
    expect(r.tool).toBe('proxy-analyze')
    expect(r.engine).toBe('mysql')
    expect(r.source.eventsRead).toBe(4)
    expect(r.source.malformedLines).toBe(2)
    expect(r.source.files).toEqual(['x.jsonl'])
    expect(r.source.timeSpan.from).toBe('2026-06-04T12:00:00.000Z')
    expect(r.source.timeSpan.to).toBe('2026-06-04T12:00:02.000Z')
    expect(r.source.timeSpan.durationMs).toBe(2000)
    expect(r.summary.queries).toBe(2)
    expect(r.byFingerprint.length).toBeGreaterThan(0)
    expect(r.slowest.length).toBe(2)
  })

  it('returns a valid zeroed report for no events', () => {
    const r = analyzeEvents([], opts)
    expect(r.engine).toBeNull()
    expect(r.summary.queries).toBe(0)
    expect(r.source.timeSpan).toEqual({ from: null, to: null, durationMs: 0 })
    expect(r.byFingerprint).toEqual([])
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test tests/unit/proxy/analyze.test.ts`
Expected: FAIL — `analyzeEvents` not exported.

- [ ] **Step 3: Implement `analyzeEvents`**

Append to `src/proxy/analyze.ts`:

```ts
export function analyzeEvents(events: ProxyEvent[], opts: AnalyzeOptions): AnalysisReport {
  // ISO-8601 strings sort chronologically by lexical order.
  const timestamps = events.map((e) => e.timestamp).filter(Boolean).sort()
  const from = timestamps[0] ?? null
  const to = timestamps[timestamps.length - 1] ?? null
  return {
    version: 1,
    tool: 'proxy-analyze',
    engine: events[0]?.engine ?? null,
    source: {
      files: opts.sourceFiles,
      eventsRead: events.length,
      malformedLines: opts.malformedLines,
      timeSpan: {
        from,
        to,
        durationMs: from && to ? Date.parse(to) - Date.parse(from) : 0,
      },
    },
    summary: buildSummary(events, opts.slowMs),
    byFingerprint: buildByFingerprint(events, opts.slowMs, opts.top),
    slowest: buildSlowest(events, opts.top),
    errors: buildErrors(events),
    hotTables: buildHotTables(events),
    repetition: buildRepetition(events, opts.nPlusOne),
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `bun test tests/unit/proxy/analyze.test.ts`
Expected: PASS (all analyze tests).

- [ ] **Step 5: Commit**

```bash
git add src/proxy/analyze.ts tests/unit/proxy/analyze.test.ts
git commit -m "feat: [proxy] analyzeEvents orchestrator"
```

---

## Task 9: `event-reader.ts`

**Files:**
- Create: `src/proxy/event-reader.ts`
- Test: `tests/unit/proxy/event-reader.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/unit/proxy/event-reader.test.ts`:

```ts
// tests/unit/proxy/event-reader.test.ts
import { describe, it, expect, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readEvents } from '@/proxy/event-reader'

const tmps: string[] = []
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'proxy-reader-'))
  tmps.push(d)
  return d
}
afterEach(() => {
  for (const d of tmps.splice(0)) rmSync(d, { recursive: true, force: true })
})

const line = (ts: string, sql: string) =>
  JSON.stringify({
    version: 1,
    type: 'query_completed',
    timestamp: ts,
    engine: 'mysql',
    sessionId: 'pxy_1',
    queryId: 'q',
    client: 'c',
    target: 't',
    sql,
    statement: 'SELECT',
    tables: [],
    durationMs: 1,
    requestBytes: 0,
    responseBytes: 0,
    rowCount: null,
    slow: false,
    error: null,
    tags: [],
  })

describe('readEvents', () => {
  it('merges current + .1 and sorts by timestamp', async () => {
    const dir = tmp()
    const path = join(dir, 'events.jsonl')
    writeFileSync(path, line('2026-06-04T12:00:02.000Z', 'SELECT 2') + '\n')
    writeFileSync(`${path}.1`, line('2026-06-04T12:00:01.000Z', 'SELECT 1') + '\n')
    const r = await readEvents(path, { includeRotated: true })
    expect(r.events.map((e) => (e as { sql: string }).sql)).toEqual(['SELECT 1', 'SELECT 2'])
    expect(r.files.length).toBe(2)
  })

  it('skips malformed lines and counts them', async () => {
    const dir = tmp()
    const path = join(dir, 'events.jsonl')
    writeFileSync(path, [line('2026-06-04T12:00:00.000Z', 'SELECT 1'), 'not json', ''].join('\n'))
    const r = await readEvents(path, { includeRotated: true })
    expect(r.events).toHaveLength(1)
    expect(r.malformedLines).toBe(1)
  })

  it('ignores the .1 segment when includeRotated is false', async () => {
    const dir = tmp()
    const path = join(dir, 'events.jsonl')
    writeFileSync(path, line('2026-06-04T12:00:02.000Z', 'SELECT cur') + '\n')
    writeFileSync(`${path}.1`, line('2026-06-04T12:00:01.000Z', 'SELECT old') + '\n')
    const r = await readEvents(path, { includeRotated: false })
    expect(r.files).toEqual([path])
    expect(r.events).toHaveLength(1)
  })

  it('returns empty files list when nothing exists', async () => {
    const dir = tmp()
    const r = await readEvents(join(dir, 'nope.jsonl'), { includeRotated: true })
    expect(r.files).toEqual([])
    expect(r.events).toEqual([])
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test tests/unit/proxy/event-reader.test.ts`
Expected: FAIL — `Cannot find module '@/proxy/event-reader'`.

- [ ] **Step 3: Implement `event-reader.ts`**

```ts
// src/proxy/event-reader.ts
import { readFile } from 'node:fs/promises'
import type { ProxyEvent } from './events'

export interface ReadResult {
  events: ProxyEvent[]
  malformedLines: number
  files: string[]
}

export interface ReadOptions {
  includeRotated: boolean
}

/**
 * Read a proxy event log and (optionally) its rotated `.1` segment. Malformed
 * lines are skipped and counted, never thrown. Events are merge-sorted by
 * timestamp so a rotated segment interleaves correctly with the current file.
 */
export async function readEvents(path: string, opts: ReadOptions): Promise<ReadResult> {
  const candidates = opts.includeRotated ? [path, `${path}.1`] : [path]
  const files: string[] = []
  const events: ProxyEvent[] = []
  let malformedLines = 0

  for (const file of candidates) {
    let raw: string
    try {
      raw = await readFile(file, 'utf8')
    } catch {
      continue // file doesn't exist — skip
    }
    files.push(file)
    for (const rawLine of raw.split('\n')) {
      const trimmed = rawLine.trim()
      if (!trimmed) continue
      try {
        events.push(JSON.parse(trimmed) as ProxyEvent)
      } catch {
        malformedLines += 1
      }
    }
  }

  events.sort((a, b) => (a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0))
  return { events, malformedLines, files }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `bun test tests/unit/proxy/event-reader.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/proxy/event-reader.ts tests/unit/proxy/event-reader.test.ts
git commit -m "feat: [proxy] tolerant event-reader (current + .1, malformed-line counting)"
```

---

## Task 10: `analyze-render.ts` (text view)

**Files:**
- Create: `src/proxy/analyze-render.ts`
- Test: `tests/unit/proxy/analyze-render.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/unit/proxy/analyze-render.test.ts`:

```ts
// tests/unit/proxy/analyze-render.test.ts
import { describe, it, expect } from 'bun:test'
import { analyzeEvents } from '@/proxy/analyze'
import { renderAnalysisText } from '@/proxy/analyze-render'
import { completed, errored } from './event-fixtures'

const opts = { slowMs: 1000, top: 20, nPlusOne: 10, sourceFiles: ['x.jsonl'], malformedLines: 0 }

describe('renderAnalysisText', () => {
  it('renders section headers and suggested commands', () => {
    const report = analyzeEvents([completed({ durationMs: 100 }), errored()], opts)
    const text = renderAnalysisText(report, 20)
    expect(text).toContain('SUMMARY')
    expect(text).toContain('TOP QUERIES BY TOTAL TIME')
    expect(text).toContain('SLOWEST SINGLE QUERIES')
    expect(text).toContain('HOT TABLES')
    expect(text).toContain('ERRORS')
    expect(text).toContain('N+1 SUSPECTS')
    expect(text).toContain('SUGGESTED COMMANDS')
    expect(text).toContain('dbcli guide missing-index-for')
  })

  it('prints a friendly message when there is nothing to analyze', () => {
    const report = analyzeEvents([], opts)
    expect(renderAnalysisText(report, 20)).toBe('no events to analyze')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test tests/unit/proxy/analyze-render.test.ts`
Expected: FAIL — `Cannot find module '@/proxy/analyze-render'`.

- [ ] **Step 3: Implement `analyze-render.ts`**

```ts
// src/proxy/analyze-render.ts
import type { AnalysisReport } from './analyze'

/** Render an AnalysisReport as a sectioned plain-text view. `top` truncates lists. */
export function renderAnalysisText(report: AnalysisReport, top: number): string {
  if (report.summary.queries === 0 && report.summary.errors === 0) {
    return 'no events to analyze'
  }
  const s = report.summary
  const L: string[] = []

  L.push('SUMMARY')
  L.push(
    `  engine: ${report.engine ?? 'unknown'}  sessions: ${s.sessions}  ` +
      `queries: ${s.queries}  errors: ${s.errors} (${(s.errorRate * 100).toFixed(2)}%)`
  )
  L.push(
    `  latency ms: p50=${s.latencyMs.p50} p95=${s.latencyMs.p95} ` +
      `p99=${s.latencyMs.p99} max=${s.latencyMs.max}  slow=${s.slowCount}`
  )
  L.push(`  bytes: req=${s.bytes.request} resp=${s.bytes.response}`)

  L.push('', 'TOP QUERIES BY TOTAL TIME')
  for (const f of report.byFingerprint.slice(0, top)) {
    L.push(
      `  [${f.count}x total=${f.durationMs.total}ms avg=${f.durationMs.avg} ` +
        `p95=${f.durationMs.p95}] ${f.fingerprint}`
    )
  }

  L.push('', 'SLOWEST SINGLE QUERIES')
  for (const q of report.slowest.slice(0, top)) {
    L.push(`  ${q.durationMs}ms  ${q.sql}`)
  }

  L.push('', 'HOT TABLES')
  for (const t of report.hotTables.slice(0, top)) {
    L.push(`  ${t.queryCount}x  ${t.totalDurationMs}ms  ${t.table}`)
  }

  L.push('', 'ERRORS')
  if (report.errors.length === 0) L.push('  (none)')
  for (const e of report.errors.slice(0, top)) {
    L.push(`  ${e.count}x  [${e.code ?? '?'}] ${e.message}`)
  }

  L.push('', 'N+1 SUSPECTS')
  if (report.repetition.length === 0) L.push('  (none)')
  for (const r of report.repetition.slice(0, top)) {
    L.push(`  ${r.count}x in session ${r.sessionId} (${r.spanMs}ms)  ${r.fingerprint}`)
  }

  const cmds = [...new Set(report.byFingerprint.flatMap((f) => f.suggestedCommands ?? []))]
  if (cmds.length) {
    L.push('', 'SUGGESTED COMMANDS')
    for (const c of cmds) L.push(`  ${c}`)
  }

  return L.join('\n')
}
```

- [ ] **Step 4: Run to verify pass**

Run: `bun test tests/unit/proxy/analyze-render.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/proxy/analyze-render.ts tests/unit/proxy/analyze-render.test.ts
git commit -m "feat: [proxy] analyze text renderer"
```

---

## Task 11: Wire the `proxy analyze` subcommand

**Files:**
- Modify: `src/commands/proxy.ts`
- Test: `tests/integration/proxy-analyze.test.ts`

- [ ] **Step 1: Write the failing integration test**

Create `tests/integration/proxy-analyze.test.ts`:

```ts
// tests/integration/proxy-analyze.test.ts
import { describe, it, expect, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const tmps: string[] = []
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'proxy-analyze-it-'))
  tmps.push(d)
  return d
}
afterEach(() => {
  for (const d of tmps.splice(0)) rmSync(d, { recursive: true, force: true })
})

const evt = (sql: string, durationMs: number) =>
  JSON.stringify({
    version: 1,
    type: 'query_completed',
    timestamp: '2026-06-04T12:00:00.000Z',
    engine: 'mysql',
    sessionId: 'pxy_1',
    queryId: 'q',
    client: 'c',
    target: 't',
    sql,
    statement: 'SELECT',
    tables: ['users'],
    durationMs,
    requestBytes: 1,
    responseBytes: 2,
    rowCount: 1,
    slow: false,
    error: null,
    tags: [],
  })

describe('dbcli proxy analyze (CLI)', () => {
  it('reads an events file and prints a JSON report', () => {
    const dir = tmp()
    const path = join(dir, 'events.jsonl')
    writeFileSync(path, [evt('SELECT * FROM users WHERE id = 1', 50), 'garbage'].join('\n'))

    const proc = Bun.spawnSync([
      'bun',
      'run',
      'src/cli.ts',
      'proxy',
      'analyze',
      '--events',
      path,
      '--format',
      'json',
    ])
    expect(proc.exitCode).toBe(0)
    const report = JSON.parse(proc.stdout.toString())
    expect(report.tool).toBe('proxy-analyze')
    expect(report.summary.queries).toBe(1)
    expect(report.source.malformedLines).toBe(1)
    expect(report.byFingerprint[0].fingerprint).toBe('SELECT * FROM users WHERE id = ?')
  })

  it('exits 1 with a friendly message when the events file is missing', () => {
    const dir = tmp()
    const proc = Bun.spawnSync([
      'bun',
      'run',
      'src/cli.ts',
      'proxy',
      'analyze',
      '--events',
      join(dir, 'nope.jsonl'),
    ])
    expect(proc.exitCode).toBe(1)
    expect(proc.stderr.toString()).toContain('no events found')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test tests/integration/proxy-analyze.test.ts`
Expected: FAIL — `error: unknown command 'analyze'` (exit code mismatch).

- [ ] **Step 3: Add imports + the analyze wiring to `src/commands/proxy.ts`**

Add these imports near the top of `src/commands/proxy.ts` (after the existing imports on lines 1-8):

```ts
import { readEvents } from '@/proxy/event-reader'
import { analyzeEvents } from '@/proxy/analyze'
import { renderAnalysisText } from '@/proxy/analyze-render'
```

Then add the following just BEFORE the `// No-subcommand form:` comment near the end of the file (i.e. after the engine `for` loop, before the default action):

```ts
const ANALYZE_FORMATS = ['json', 'text'] as const

interface ProxyAnalyzeOptions {
  events?: string
  format?: string
  top?: string
  slowMs?: string
  nPlusOne?: string
  includeRotated?: boolean
}

function parseNonNegInt(value: string | undefined, flag: string, fallback: number): number {
  if (value === undefined) return fallback
  const n = Number(value)
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`Invalid --${flag} "${value}". Expected a non-negative integer`)
  }
  return n
}

async function runAnalyze(options: ProxyAnalyzeOptions): Promise<void> {
  try {
    const format = options.format ?? 'json'
    validateFormat(format, ANALYZE_FORMATS, 'proxy analyze')
    const top = parseNonNegInt(options.top, 'top', 20)
    const slowMs = parseNonNegInt(options.slowMs, 'slow-ms', 1000)
    const nPlusOne = parseNonNegInt(options.nPlusOne, 'n-plus-one', 10)
    const eventsPath = options.events ?? join('.dbcli', 'proxy', 'events.jsonl')

    const { events, malformedLines, files } = await readEvents(eventsPath, {
      includeRotated: options.includeRotated !== false,
    })
    if (files.length === 0) {
      throw new Error(`no events found at ${eventsPath}; run 'dbcli proxy <engine>' first`)
    }

    const report = analyzeEvents(events, {
      slowMs,
      top,
      nPlusOne,
      sourceFiles: files,
      malformedLines,
    })

    if (format === 'text') {
      process.stdout.write(renderAnalysisText(report, top) + '\n')
    } else {
      process.stdout.write(JSON.stringify(report, null, 2) + '\n')
    }
  } catch (error) {
    if (error instanceof Error) console.error(error.message)
    process.exit(1)
  }
}

proxyCommand
  .command('analyze')
  .description('Analyze a proxy event log offline (no DB connection)')
  .option('--events <path>', 'Event JSONL path', join('.dbcli', 'proxy', 'events.jsonl'))
  .option('--format <format>', 'Output format: json | text', 'json')
  .option('--top <number>', 'Rows shown in text + suggestedCommands depth', '20')
  .option('--slow-ms <number>', 'Slow-query threshold (ms) for slowCount', '1000')
  .option('--n-plus-one <number>', 'Min repeats per (session,fingerprint) to flag N+1', '10')
  .option('--no-include-rotated', 'Do not merge the rotated <events>.1 segment')
  .action(async (options: ProxyAnalyzeOptions) => {
    await runAnalyze(options)
  })
```

Note: commander turns `--no-include-rotated` into `options.includeRotated` defaulting to `true`, so `options.includeRotated !== false` is `true` unless the flag is passed.

- [ ] **Step 4: Run to verify pass**

Run: `bun test tests/integration/proxy-analyze.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Run the proxy unit + resolve tests to confirm no regressions**

Run: `bun test tests/unit/proxy tests/unit/commands/proxy-resolve.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/commands/proxy.ts tests/integration/proxy-analyze.test.ts
git commit -m "feat: [proxy] wire 'proxy analyze' subcommand"
```

---

## Task 12: Documentation + CHANGELOG

**Files:**
- Modify: `assets/reference.md`
- Modify: `assets/SKILL.md`
- Modify: `docs/user/en/index.md`, `docs/user/en/index.html`
- Modify: `docs/user/zh-TW/index.md`, `docs/user/zh-TW/index.html`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Add the `analyze` subcommand to `assets/reference.md`**

In the proxy section of `assets/reference.md` (search for `dbcli proxy mysql`), add an analyze example near the other proxy command examples:

```bash
dbcli proxy analyze                               # analyze .dbcli/proxy/events.jsonl (JSON)
dbcli proxy analyze --format text --top 10        # human-readable top-10 view
dbcli proxy analyze --slow-ms 200 --n-plus-one 5  # custom thresholds
```

And add a description block after the existing proxy event-schema/rotation notes:

```
**`proxy analyze`** — offline aggregation of the event log (no DB). Flags: `--events <path>` (default `.dbcli/proxy/events.jsonl`), `--format json|text` (default `json`), `--top <n>` (default 20; text rows + suggestedCommands depth), `--slow-ms <ms>` (default 1000; recomputes slowCount), `--n-plus-one <n>` (default 10), `--no-include-rotated`. JSON report blocks: `summary`, `byFingerprint` (sorted by total time; SELECT entries in the top-N carry `suggestedCommands` for `explain` / `guide missing-index-for`), `slowest`, `errors`, `hotTables`, `repetition` (N+1 suspects). Reads the current log plus the rotated `.1` segment by default.
```

- [ ] **Step 2: Add the `analyze` row to `assets/SKILL.md`**

In `assets/SKILL.md`, find the `proxy` table row (search for `| \`proxy\` |`) and append a sentence to its cell. Use the version marker matching the release this ships in — read it from `package.json` (`"version"`) and write `(vX.Y)` to match the existing markers like `(v1.26)`:

```
**(vX.Y)** `proxy analyze` aggregates the event log offline into a JSON/text report (summary, byFingerprint with suggestedCommands, slowest, errors, hotTables, N+1) — `--format`, `--top`, `--slow-ms`, `--n-plus-one`.
```

- [ ] **Step 3: Add an `analyze` table row to the user docs (en md + html, zh-TW md + html)**

In `docs/user/en/index.md`, in the proxy flags/subcommands area, add:

```
`dbcli proxy analyze` — analyze the captured event log offline (no DB). `--format json|text`, `--top`, `--slow-ms`, `--n-plus-one`, `--no-include-rotated`. Produces summary, per-fingerprint stats (with suggested `explain` / `guide missing-index-for` commands), slowest queries, error groups, hot tables, and N+1 suspects.
```

In `docs/user/zh-TW/index.md`, add the Traditional-Chinese equivalent:

```
`dbcli proxy analyze` — 離線分析擷取的事件日誌(不連 DB)。`--format json|text`、`--top`、`--slow-ms`、`--n-plus-one`、`--no-include-rotated`。輸出總覽、各查詢指紋統計(附 `explain` / `guide missing-index-for` 建議指令)、最慢查詢、錯誤分群、熱點表、N+1 嫌疑。
```

Then mirror the same content into `docs/user/en/index.html` and `docs/user/zh-TW/index.html` using the surrounding HTML row/element style (match the existing proxy entries' markup, e.g. wrap flags in `<code>` tags).

- [ ] **Step 4: Add a CHANGELOG entry**

In `CHANGELOG.md`, under `## [Unreleased]`, add an `### Added` block (create it if absent, above the existing `### Changed`/`### Fixed`):

```markdown
### Added

- **`dbcli proxy analyze` — 離線分析 proxy 事件日誌。** 讀取 `.dbcli/proxy/events.jsonl`(預設含 rotation `.1` 段),聚合成 agent-facing JSON 報告(`summary`、`byFingerprint`、`slowest`、`errors`、`hotTables`、`repetition`)或人類版 text。重用 `redactLiterals` 做 SQL 指紋正規化;對最吃總時間的 SELECT 指紋附上可執行的 `suggestedCommands`(`explain` / `guide missing-index-for`),離線產生不自動執行。旗標:`--events`、`--format json|text`、`--top`、`--slow-ms`、`--n-plus-one`、`--no-include-rotated`。不連資料庫。
```

- [ ] **Step 5: Run the docs parity check + full gate**

Run: `bun run docs:check`
Expected: PASS (or no proxy-related errors).

Run: `bun run test:unit && bun run typecheck && bun run lint`
Expected: All PASS.

- [ ] **Step 6: Format and commit**

```bash
bun run format
git add assets/reference.md assets/SKILL.md docs/user CHANGELOG.md src tests
git commit -m "docs: [proxy] document 'proxy analyze' (reference, skill, user docs, CHANGELOG)"
```

---

## Final Verification

- [ ] Run the full gate one more time (note: `test:unit` does NOT cover `tests/integration/`, so run the integration test explicitly too):

```bash
bun run test:unit \
  && bun test tests/integration/proxy-analyze.test.ts \
  && bun run typecheck && bun run lint && bun run docs:check
```

Expected: all PASS. The proxy analyze unit tests (analyze, event-reader, analyze-render), the CLI integration test, and the existing proxy suite should all be green.

- [ ] Smoke-test the real command against a sample log:

```bash
printf '%s\n' '{"version":1,"type":"query_completed","timestamp":"2026-06-04T12:00:00.000Z","engine":"mysql","sessionId":"pxy_1","queryId":"q","client":"c","target":"t","sql":"SELECT * FROM users WHERE id = 1","statement":"SELECT","tables":["users"],"durationMs":50,"requestBytes":1,"responseBytes":2,"rowCount":1,"slow":false,"error":null,"tags":[]}' > /tmp/ev.jsonl
bun run src/cli.ts proxy analyze --events /tmp/ev.jsonl --format text
```

Expected: a SUMMARY block and a SUGGESTED COMMANDS block referencing `guide missing-index-for`.
