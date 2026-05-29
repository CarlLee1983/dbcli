/**
 * Markdown EXPLAIN formatter.
 * Bulk mode (multiple plans) prepends a Query column listing the queryLabel.
 * Single-plan mode omits Query.
 */

import type { ExplainAnnotation, ExplainPlan, ExplainRow } from '@/core/explain/types'

const SEVERITY_PREFIX: Record<ExplainAnnotation['severity'], string> = {
  red: '🔴',
  yellow: '🟡',
  gray: '⚪',
}

export function formatExplainMarkdown(plans: ExplainPlan[]): string {
  const isBulk = plans.length > 1
  const headers = isBulk
    ? ['Query', 'driving', 'type', 'key', 'rows', 'filtered', 'extra', 'flags']
    : ['driving', 'type', 'key', 'rows', 'filtered', 'extra', 'flags']

  const lines: string[] = []
  lines.push(`| ${headers.join(' | ')} |`)
  lines.push(`| ${headers.map(() => '---').join(' | ')} |`)

  for (const plan of plans) {
    for (const row of plan.rows) {
      const cells: string[] = []
      if (isBulk) cells.push(escapeCell(plan.queryLabel ?? row.queryLabel ?? '-'))
      cells.push(
        escapeCell(row.driving || '-'),
        escapeCell(row.accessType || '-'),
        row.key === null ? 'null' : escapeCell(row.key),
        String(row.rows),
        row.filtered === undefined ? '-' : String(row.filtered),
        row.extra.length === 0 ? '-' : escapeCell(row.extra.join('; ')),
        renderFlags(row)
      )
      lines.push(`| ${cells.join(' | ')} |`)
    }
  }
  return lines.join('\n')
}

function renderFlags(row: ExplainRow): string {
  if (row.annotations.length === 0) return '-'
  return row.annotations.map((a) => `${SEVERITY_PREFIX[a.severity]} ${a.rule}`).join(' ')
}

function escapeCell(s: string): string {
  // Markdown table cell: escape pipe chars to avoid breaking layout.
  return s.replace(/\|/g, '\\|')
}
