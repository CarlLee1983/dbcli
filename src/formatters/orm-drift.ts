import type { DriftReport } from '@/core/orm-drift/compare'

export type DriftFormat = 'json' | 'table' | 'markdown'

export function formatDrift(report: DriftReport, format: DriftFormat): string {
  if (format === 'json') return JSON.stringify(report, null, 2)
  if (format === 'markdown') return formatMarkdown(report)
  return formatTable(report)
}

function summaryLine(report: DriftReport): string {
  const { errors, warns, infos, unmanaged } = report.summary
  return `Summary: ${errors} error(s), ${warns} warn(s), ${infos} info(s), ${unmanaged} unmanaged`
}

function formatTable(report: DriftReport): string {
  const lines = [`Drift vs ${report.ormSource}:`]

  if (report.entries.length === 0) {
    lines.push('  No drift detected.')
  }

  for (const entry of report.entries) {
    lines.push(
      '',
      `[${entry.severity}] ${entry.category} ${entry.table}.${entry.object}`,
      `  ${entry.detail}`,
      ...entry.proposedCommands.map((command) => `  ${command}`)
    )
  }

  for (const unparsed of report.unparsed) {
    lines.push(`Unparsed: ${unparsed.location} — ${unparsed.reason}`)
  }

  lines.push('', summaryLine(report))
  return lines.join('\n')
}

function formatMarkdown(report: DriftReport): string {
  const lines = [`### Drift vs ${escapeMarkdownText(report.ormSource)}`, '']

  if (report.entries.length === 0) {
    lines.push('No drift detected.')
  } else {
    lines.push('| Severity | Category | Object | Detail |', '| --- | --- | --- | --- |')

    for (const entry of report.entries) {
      lines.push(
        markdownRow([
          entry.severity,
          entry.category,
          `${entry.table}.${entry.object}`,
          entry.detail,
        ])
      )
    }

    for (const entry of report.entries) {
      if (entry.proposedCommands.length === 0) continue
      const object = `${entry.table}.${entry.object}`
      lines.push(
        '',
        `**Proposal for ${inlineCode(object)}:**`,
        fencedCode(entry.proposedCommands.join('\n'), 'bash')
      )
    }
  }

  if (report.unparsed.length > 0) {
    lines.push('')
    for (const unparsed of report.unparsed) {
      lines.push(
        `- Unparsed: ${inlineCode(unparsed.location)} — ${escapeMarkdownText(unparsed.reason)}`
      )
    }
  }

  lines.push('', summaryLine(report))
  return lines.join('\n')
}

function markdownRow(cells: string[]): string {
  return `| ${cells.map(escapeMarkdownTableCell).join(' | ')} |`
}

function escapeMarkdownTableCell(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/\r\n|\r|\n/g, '<br>')
}

function escapeMarkdownText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/([`*_{}[\]()#+.!|>~-])/g, '\\$1')
    .replace(/\r\n|\r|\n/g, '<br>')
}

function inlineCode(value: string): string {
  const longestRun = Math.max(0, ...Array.from(value.matchAll(/`+/g), (match) => match[0].length))
  const delimiter = '`'.repeat(Math.max(1, longestRun + 1))
  const padded = value.startsWith('`') || value.endsWith('`') ? ` ${value} ` : value
  return `${delimiter}${padded}${delimiter}`
}

function fencedCode(value: string, language: string): string {
  const longestRun = Math.max(0, ...Array.from(value.matchAll(/`+/g), (match) => match[0].length))
  const fence = '`'.repeat(Math.max(3, longestRun + 1))
  return `${fence}${language}\n${value}\n${fence}`
}
