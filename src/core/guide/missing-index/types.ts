/**
 * Types for `dbcli guide missing-index-for` — per-query composite-index advisor.
 * The pipeline is parse → extract → enrich → introspect → build → score → warn.
 * IO is injected via MissingIndexDeps to keep each stage unit-testable.
 */

import type { SqlDatabaseSystem } from '@/adapters/types'

export type Confidence = 'high' | 'medium' | 'low'

/** A column used by the query, tagged with how it was used in one table's scope. */
export interface TableColumnUsage {
  /** Real table name (alias already resolved). */
  table: string
  /** Original alias if the query used one (for reason text). */
  alias?: string
  /** WHERE/HAVING equality columns (=, IN). Leftmost-prefix priority. */
  equalityColumns: string[]
  /** WHERE/HAVING range columns (>, <, >=, <=, BETWEEN). */
  rangeColumns: string[]
  /** JOIN ON columns belonging to this table (treated as equality). */
  joinColumns: string[]
  /** ORDER BY / GROUP BY columns belonging to this table. */
  orderColumns: string[]
  /** Columns wrapped in a function in WHERE/GROUP (DATE(x), UPPER(x)) → warnings. */
  functionalColumns: { column: string; expr: string }[]
}

export interface QueryAnalysis {
  tables: TableColumnUsage[]
  /** false when node-sql-parser failed and we ran in fallback mode. */
  parsed: boolean
}

export interface ExistingIndex {
  name: string
  columns: string[]
  unique: boolean
}

/** Facts pulled from the real EXPLAIN plan, keyed by table name in the enricher. */
export interface EnrichedPlanFacts {
  accessType: string // MySQL `type` / PG node-type-mapped accessType
  key: string | null // index actually chosen by planner
  rows: number
  filtered?: number
}

export interface IndexCandidate {
  table: string
  columns: string[]
  reason: string
  confidence: Confidence
  /** Name of an existing index that shares the leftmost column, else null. */
  existingIndexCollision: string | null
  estimatedRowsReduction?: string
}

export type WarningRule =
  | 'functional-expression'
  | 'type-cast'
  | 'parser-limit'
  | 'unsupported-statement'

export interface AnalysisWarning {
  rule: WarningRule
  column?: string
  detail: string
}

export interface MissingIndexReport {
  query: string
  candidates: IndexCandidate[]
  warnings: AnalysisWarning[]
}

/** Injected IO so analyzer + stages stay unit-testable. */
export interface MissingIndexDeps {
  system: SqlDatabaseSystem
  /** AST in, usage out. Throws on parse failure. */
  parseSelect: (sql: string, system: SqlDatabaseSystem) => unknown
  extract: (ast: unknown) => QueryAnalysis
  getExistingIndexes: (table: string) => Promise<ExistingIndex[]>
  enrich: (sql: string) => Promise<Map<string, EnrichedPlanFacts>>
  /** Overall analysis budget; reserved for future enforcement. Default 5000. */
  timeoutMs?: number
}
