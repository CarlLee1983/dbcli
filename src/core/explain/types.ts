/**
 * Unified EXPLAIN plan types — bridges MySQL/MariaDB and PostgreSQL
 * into a shared row schema for annotation + rendering.
 */

import type { DatabaseSystem } from '@/adapters/types'

export type AnnotationSeverity = 'red' | 'yellow' | 'gray'

export type AnnotationRule =
  | 'full-scan'
  | 'temp-table'
  | 'filesort'
  | 'cost-estimate-skew'
  | 'nested-loop-large'

export interface ExplainAnnotation {
  severity: AnnotationSeverity
  rule: AnnotationRule
  message: string
}

export interface ExplainRow {
  /** Set only when produced via --bulk; identifies which query this row came from. */
  queryLabel?: string
  /** MySQL: `table` field. PG: leaf-most relation under this plan node. */
  driving: string
  /** MySQL: `type` (ALL/ref/eq_ref/range/...). PG: `Node Type` (Seq Scan/Index Scan/...). */
  accessType: string
  /** MySQL: `key`. PG: `Index Name`. Null when no index used. */
  key: string | null
  /** Estimated rows the planner expects to touch at this node. */
  rows: number
  /** MySQL `filtered` %. Undefined for PG. */
  filtered?: number
  /** Free-form notes — MySQL `Extra` items, PG `Sort Method` etc. */
  extra: string[]
  /** PostgreSQL only — planner cost (startup, total). */
  cost?: { startup: number; total: number }
  /** PostgreSQL ANALYZE only — `actual rows` vs `rows`; used by cost-skew rule. */
  actualRows?: number
  annotations: ExplainAnnotation[]
}

export interface ExplainPlan {
  /** Per-row breakdown after normalization. */
  rows: ExplainRow[]
  /** Database system this plan came from. */
  system: DatabaseSystem
  /** Original SQL that was EXPLAINed (without EXPLAIN prefix). */
  rawSql: string
  /** Only set in --bulk mode. */
  queryLabel?: string
  /** Raw driver payload kept for --format json deep-dive. */
  raw: unknown
}

export interface ExplainOptions {
  /** True when --analyze flag is set — adapters issue EXPLAIN ANALYZE / ANALYZE SELECT instead. */
  analyze?: boolean
}
