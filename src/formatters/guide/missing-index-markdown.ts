// src/formatters/guide/missing-index-markdown.ts
/**
 * PR-pasteable Markdown. Candidates render as a table; reasons + warnings as
 * bullet sections below so the table stays scannable.
 */

import type { MissingIndexReport } from '@/core/guide/missing-index/types'

export function formatMissingIndexMarkdown(report: MissingIndexReport): string {
  const out: string[] = []
  out.push('## Missing-index analysis', '')
  out.push('```sql', report.query.trim(), '```', '')

  if (report.candidates.length === 0) {
    out.push('_No index candidates produced._', '')
  } else {
    out.push('| Table | Columns | Confidence | Existing collision |')
    out.push('|---|---|---|---|')
    for (const c of report.candidates) {
      out.push(
        `| ${c.table} | \`(${c.columns.join(', ')})\` | ${c.confidence} | ${c.existingIndexCollision ?? '—'} |`
      )
    }
    out.push('')
    out.push('### Rationale', '')
    for (const c of report.candidates) {
      out.push(`- **${c.table} (${c.columns.join(', ')})** — ${c.reason}`)
      if (c.estimatedRowsReduction) out.push(`  - est. impact: ${c.estimatedRowsReduction}`)
    }
    out.push('')
  }

  if (report.warnings.length) {
    out.push('### Warnings', '')
    for (const w of report.warnings) {
      const head = w.column ? `\`${w.column}\` (${w.rule})` : w.rule
      out.push(`- **${head}** — ${w.detail}`)
    }
    out.push('')
  }
  return out.join('\n')
}
