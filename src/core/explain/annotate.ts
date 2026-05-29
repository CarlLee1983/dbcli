/**
 * Annotation engine — tags ExplainRow with severity-marked rules so callers
 * can render visual cues. Thresholds are exported as constants to enable
 * future --annotation-config flag.
 */

import type { DatabaseSystem } from '@/adapters/types'
import type { ExplainAnnotation, ExplainRow } from './types'

export const ANNOTATION_THRESHOLDS = {
  /** rows / actualRows ratio that triggers cost-estimate-skew. */
  COST_SKEW_RATIO: 10,
  /** Plan Rows above this on a Nested Loop node triggers nested-loop-large. */
  NESTED_LOOP_ROWS: 10_000,
} as const

export function annotateRows(rows: ExplainRow[], system: DatabaseSystem): ExplainRow[] {
  return rows.map((row) => ({
    ...row,
    annotations: collectAnnotations(row, system),
  }))
}

function collectAnnotations(row: ExplainRow, system: DatabaseSystem): ExplainAnnotation[] {
  const out: ExplainAnnotation[] = []
  if (isFullScan(row, system)) {
    out.push({
      severity: 'red',
      rule: 'full-scan',
      message: `Full scan on '${row.driving || 'unknown'}' (${row.rows.toLocaleString()} rows)`,
    })
  }
  if (hasExtra(row, 'Using temporary')) {
    out.push({
      severity: 'yellow',
      rule: 'temp-table',
      message: 'Query materialises a temporary table',
    })
  }
  if (hasFilesort(row, system)) {
    out.push({ severity: 'yellow', rule: 'filesort', message: 'Result sorted on disk (filesort)' })
  }
  if (isCostSkewed(row)) {
    const ratio = Math.round((row.actualRows! / Math.max(row.rows, 1)) * 10) / 10
    out.push({
      severity: 'gray',
      rule: 'cost-estimate-skew',
      message: `Planner estimate off by ${ratio}× (estimated ${row.rows}, actual ${row.actualRows})`,
    })
  }
  if (isLargeNestedLoop(row)) {
    out.push({
      severity: 'yellow',
      rule: 'nested-loop-large',
      message: `Nested loop touches ~${row.rows.toLocaleString()} rows`,
    })
  }
  return out
}

function isFullScan(row: ExplainRow, system: DatabaseSystem): boolean {
  if (system === 'postgresql') return row.accessType === 'Seq Scan'
  // MySQL/MariaDB
  return row.accessType === 'ALL' || row.key === null
}

function hasExtra(row: ExplainRow, needle: string): boolean {
  return row.extra.some((s) => s.includes(needle))
}

function hasFilesort(row: ExplainRow, system: DatabaseSystem): boolean {
  if (system === 'postgresql') {
    return row.extra.some((s) => /Sort Method: external merge/i.test(s))
  }
  return hasExtra(row, 'Using filesort')
}

function isCostSkewed(row: ExplainRow): boolean {
  if (row.actualRows === undefined) return false
  if (row.rows <= 0) return false
  return row.actualRows / row.rows > ANNOTATION_THRESHOLDS.COST_SKEW_RATIO
}

function isLargeNestedLoop(row: ExplainRow): boolean {
  if (row.accessType !== 'Nested Loop') return false
  return row.rows > ANNOTATION_THRESHOLDS.NESTED_LOOP_ROWS
}
