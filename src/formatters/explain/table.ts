/**
 * ANSI-table EXPLAIN formatter — reuses the project's TableFormatter
 * (generic record formatter: object keys → headers, values → cells)
 * by flattening ExplainRow into a plain record per row.
 */

import { TableFormatter } from '@/formatters'
import type { ExplainAnnotation, ExplainPlan, ExplainRow } from '@/core/explain/types'

export function formatExplainTable(plans: ExplainPlan[]): string {
  const formatter = new TableFormatter()
  const isBulk = plans.length > 1
  const flattened = plans.flatMap((plan) => plan.rows.map((row) => toFlatRow(row, plan, isBulk)))
  if (flattened.length === 0) return '(no rows)'
  return formatter.format(flattened as unknown as Record<string, unknown>[])
}

function toFlatRow(row: ExplainRow, plan: ExplainPlan, isBulk: boolean): Record<string, string> {
  const base: Record<string, string> = {
    driving: row.driving || '-',
    type: row.accessType || '-',
    key: row.key === null ? 'null' : row.key,
    rows: String(row.rows),
    filtered: row.filtered === undefined ? '-' : String(row.filtered),
    extra: row.extra.length === 0 ? '-' : row.extra.join('; '),
    flags: row.annotations.length === 0 ? '-' : row.annotations.map(renderFlag).join(' '),
  }
  if (isBulk) {
    return { Query: plan.queryLabel ?? row.queryLabel ?? '-', ...base }
  }
  return base
}

function renderFlag(a: ExplainAnnotation): string {
  const prefix = a.severity === 'red' ? '!' : a.severity === 'yellow' ? '~' : '.'
  return `${prefix}${a.rule}`
}
