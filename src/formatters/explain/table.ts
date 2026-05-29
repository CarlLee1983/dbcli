/**
 * Plain-text table EXPLAIN formatter — flattens each ExplainRow into a record
 * and renders an aligned, padded column table (no external table dep).
 *
 * NOTE: the project's TableFormatter is schema-specific (ColumnSchema[]), so it
 * cannot render arbitrary EXPLAIN records — we align columns ourselves, mirroring
 * the approach used by `dbcli queries list`.
 */

import type { ExplainAnnotation, ExplainPlan, ExplainRow } from '@/core/explain/types'

export function formatExplainTable(plans: ExplainPlan[]): string {
  const isBulk = plans.length > 1
  const records = plans.flatMap((plan) => plan.rows.map((row) => toFlatRow(row, plan, isBulk)))
  if (records.length === 0) return '(no rows)'

  const headers = Object.keys(records[0]!)
  const widths = headers.map((h) => Math.max(h.length, ...records.map((r) => (r[h] ?? '').length)))
  const fmtLine = (cells: string[]) =>
    cells.map((c, i) => (c ?? '').padEnd(widths[i] ?? 0)).join('  ')
  const separator = widths.map((w) => '-'.repeat(w)).join('  ')

  const lines = [
    fmtLine(headers),
    separator,
    ...records.map((r) => fmtLine(headers.map((h) => r[h] ?? ''))),
  ]
  return lines.join('\n')
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
