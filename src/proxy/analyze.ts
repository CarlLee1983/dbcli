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
