import type { ReportFinding, ReportSnapshot } from './types'
import type { RenderOptions } from './render-json'

const MAX_ROWS_IN_MD = 10

export function renderMarkdown(snap: ReportSnapshot, options: RenderOptions = {}): string {
  const brief = options.brief === true
  const lines: string[] = []

  lines.push('# dbcli report')
  lines.push('')
  lines.push(`*Schema version:* ${snap.schemaVersion}`)
  lines.push(`*Generated:* ${snap.generatedAt}`)
  lines.push('')

  lines.push('## Context')
  if (!snap.context.system) {
    lines.push('- No configuration found. Run `dbcli init`.')
  } else {
    lines.push(`- System: \`${snap.context.system}\``)
    lines.push(`- Connection: \`${snap.context.connection.name ?? 'default'}\``)
    lines.push(`- Database: \`${snap.context.connection.database ?? '(none)'}\``)
    lines.push(`- Permission: \`${snap.context.permission.level}\``)
    lines.push(`- Snippets available: ${snap.context.snippets.count}`)
  }
  lines.push('')

  for (const section of snap.sections) {
    lines.push(`## ${section.id}`)
    if (section.evidence.length === 0) {
      lines.push('- (no evidence collected)')
      lines.push('')
      continue
    }
    for (const ev of section.evidence) {
      lines.push(`### \`${ev.snippet}\``)
      lines.push(`- intent: \`${ev.intent}\``)
      lines.push(`- status: \`${ev.status}\``)
      lines.push(`- rowCount: ${ev.rowCount}`)
      lines.push(`- duration: ${ev.durationMs}ms`)
      if (ev.description) lines.push(`- ${ev.description}`)
      if (ev.reason) lines.push(`- reason: ${ev.reason}`)
      if (!brief && ev.rows.length > 0) {
        lines.push('')
        lines.push(...renderRowTable(ev))
      }
      lines.push('')
    }
  }

  if (snap.warnings.length > 0) {
    lines.push('## Warnings')
    for (const w of snap.warnings) {
      const src = w.source ? ` (${w.source})` : ''
      lines.push(`- [${w.severity}]${src} ${w.message}`)
    }
    lines.push('')
  }

  lines.push('## Suggested commands')
  for (const c of snap.suggestedCommands) lines.push(`- \`${c}\``)
  lines.push('')

  return lines.join('\n')
}

function renderRowTable(ev: ReportFinding): string[] {
  const rows = ev.rows.slice(0, MAX_ROWS_IN_MD)
  const cols = Array.from(
    rows.reduce((set, r) => {
      for (const k of Object.keys(r)) set.add(k)
      return set
    }, new Set<string>())
  )
  if (cols.length === 0) return []
  const out: string[] = []
  out.push(`| ${cols.join(' | ')} |`)
  out.push(`| ${cols.map(() => '---').join(' | ')} |`)
  for (const r of rows) {
    out.push(`| ${cols.map((c) => formatCell(r[c])).join(' | ')} |`)
  }
  if (ev.rowCount > rows.length) {
    out.push('')
    out.push(`*… ${ev.rowCount - rows.length} more rows truncated*`)
  }
  return out
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value.replace(/\|/g, '\\|')
  return String(value)
}
