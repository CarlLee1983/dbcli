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
  tables: string[]
  suggestedCommands?: string[]
  hints?: string[]
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
  statement: StatementType
  exampleSql: string
  suggestedCommands?: string[]
  hints?: string[]
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

export const isCompleted = (e: ProxyEvent): e is QueryCompletedEvent => e.type === 'query_completed'
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

/** Escape a string for embedding inside a double-quoted shell argument. */
function shellEscapeDq(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\$/g, '\\$').replace(/`/g, '\\`').replace(/"/g, '\\"')
}

/** Executable next steps for a SELECT: inspect the plan and ask for a composite index. */
function explainSuggestions(sql: string): string[] {
  const esc = shellEscapeDq(sql)
  return [`dbcli explain "${esc}"`, `dbcli guide missing-index-for "${esc}"`]
}

/** Max tables to surface as `schema` suggestions for a single error group. */
const MAX_ERROR_SCHEMA_TABLES = 3

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
      return { ...s, suggestedCommands: explainSuggestions(s.exampleSql) }
    }
    return s
  })
}

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

export function buildErrors(events: ProxyEvent[]): ErrorGroup[] {
  interface Acc {
    code: string | null
    message: string
    count: number
    fingerprint: string
    exampleSql: string
    tables: string[]
  }
  const groups = new Map<string, Acc>()
  for (const e of events.filter(isErrored)) {
    const key = `${e.error.code ?? ''} ${e.error.message}`
    let g = groups.get(key)
    if (!g) {
      g = {
        code: e.error.code,
        message: e.error.message,
        count: 0,
        fingerprint: fingerprintSql(e.sql),
        exampleSql: e.sql,
        tables: e.tables,
      }
      groups.set(key, g)
    }
    g.count += 1
  }
  return [...groups.values()]
    .sort((a, b) => b.count - a.count)
    .map((g) => {
      const schemaCmds = g.tables.slice(0, MAX_ERROR_SCHEMA_TABLES).map((t) => `dbcli schema ${t}`)
      const hint =
        `failed ${g.count}×: verify the involved table/column names against the live schema ` +
        `before fixing the SQL — never guess column names`
      return {
        code: g.code,
        message: g.message,
        count: g.count,
        fingerprint: g.fingerprint,
        exampleSql: g.exampleSql,
        tables: g.tables,
        ...(schemaCmds.length ? { suggestedCommands: schemaCmds } : {}),
        hints: [hint],
      }
    })
}

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

export function buildRepetition(events: ProxyEvent[], threshold: number): RepetitionGroup[] {
  interface Acc {
    fingerprint: string
    sessionId: string
    tables: string[]
    statement: StatementType
    count: number
    totalDurationMs: number
    minTs: number
    maxTs: number
    exampleSql: string
    exampleDuration: number
  }
  const groups = new Map<string, Acc>()
  for (const e of events.filter(isCompleted)) {
    const fp = fingerprintSql(e.sql)
    const key = `${e.sessionId} ${fp}`
    const ts = Date.parse(e.timestamp)
    let g = groups.get(key)
    if (!g) {
      g = {
        fingerprint: fp,
        sessionId: e.sessionId,
        tables: e.tables,
        statement: e.statement,
        count: 0,
        totalDurationMs: 0,
        minTs: ts,
        maxTs: ts,
        exampleSql: e.sql,
        exampleDuration: e.durationMs,
      }
      groups.set(key, g)
    }
    g.count += 1
    g.totalDurationMs += e.durationMs
    if (ts < g.minTs) g.minTs = ts
    if (ts > g.maxTs) g.maxTs = ts
    if (e.durationMs > g.exampleDuration) {
      g.exampleDuration = e.durationMs
      g.exampleSql = e.sql
    }
  }
  return [...groups.values()]
    .filter((g) => g.count >= threshold)
    .sort((a, b) => b.count - a.count)
    .map((g) => {
      const spanMs = g.maxTs - g.minTs
      const hint =
        `N+1 suspect: the same query ran ${g.count}× within one session over ${spanMs}ms — ` +
        `collapse into a single query (JOIN / IN (...)) or cache the result`
      return {
        fingerprint: g.fingerprint,
        sessionId: g.sessionId,
        count: g.count,
        spanMs,
        totalDurationMs: g.totalDurationMs,
        tables: g.tables,
        statement: g.statement,
        exampleSql: g.exampleSql,
        ...(g.statement === 'SELECT'
          ? { suggestedCommands: explainSuggestions(g.exampleSql) }
          : {}),
        hints: [hint],
      }
    })
}

export function analyzeEvents(events: ProxyEvent[], opts: AnalyzeOptions): AnalysisReport {
  // ISO-8601 strings sort chronologically by lexical order.
  const timestamps = events
    .map((e) => e.timestamp)
    .filter(Boolean)
    .sort()
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

export function buildSummary(events: ProxyEvent[], slowMs: number): AnalysisSummary {
  const completed = events.filter(isCompleted)
  const errored = events.filter(isErrored)
  const durations = completed.map((e) => e.durationMs)
  const queries = completed.length
  const errors = errored.length
  const denom = queries + errors
  return {
    sessions: new Set(events.filter((e) => e.type === 'session_started').map((e) => e.sessionId))
      .size,
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
