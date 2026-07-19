import type { LintFinding, LintReport } from '@/core/lint/types'

export type LintFormat = 'text' | 'json' | 'markdown'

export function formatLint(reports: LintReport[], format: LintFormat): string {
  if (format === 'json') return JSON.stringify(reports, null, 2)
  if (reports.length === 0) return 'No queries.'

  switch (format) {
    case 'text':
      return reports.map(formatTextReport).join('\n\n')
    case 'markdown':
      return reports.map(formatMarkdownReport).join('\n\n---\n\n')
    default:
      throw new Error(`Unknown lint format: '${format as string}'`)
  }
}

function formatTextReport(report: LintReport): string {
  const lines = [
    ...(report.label ? [`Label: ${report.label}`] : []),
    `SQL: ${report.sql}`,
    `Dialect: ${report.dialect}`,
  ]

  if (report.parseError) {
    lines.push(`Parse error: ${report.parseError}`)
  } else if (report.findings.length === 0) {
    lines.push('No findings.')
  } else {
    for (const finding of report.findings) {
      const schemaStatus = finding.schemaVerified ? 'schema-verified' : 'not schema-verified'
      lines.push('', `[${finding.severity}] ${finding.rule} (${schemaStatus})`)
      lines.push(`  ${finding.message}`)
      lines.push(`  Span: ${finding.span.start}..${finding.span.end}`)
      if (finding.rewrite) {
        lines.push(`  Rewrite (${finding.rewrite.confidence}): ${finding.rewrite.sql}`)
      }
      if (finding.verifyCommand) lines.push(`  Verify: ${finding.verifyCommand}`)
    }
  }

  for (const skipped of report.skippedRules) {
    lines.push(`Skipped: ${skipped.rule} — ${skipped.reason}`)
  }
  if (report.relatedCommands.length > 0) {
    lines.push('', 'Related:', ...report.relatedCommands.map((command) => `  ${command}`))
  }

  return lines.join('\n')
}

function formatMarkdownReport(report: LintReport): string {
  const lines = [
    `### ${escapeMarkdown(report.label ?? 'Query')}`,
    '',
    '**SQL:**',
    fencedCode(report.sql, 'sql'),
    '',
    `**Dialect:** ${escapeMarkdown(report.dialect)}`,
  ]

  if (report.parseError) {
    lines.push('', `**Parse error:** ${escapeMarkdown(report.parseError)}`)
  } else if (report.findings.length === 0) {
    lines.push('', 'No findings.')
  } else {
    lines.push(
      '',
      '| Severity | Rule | Message | Span | Schema verified |',
      '| --- | --- | --- | --- | --- |'
    )
    for (const finding of report.findings) {
      lines.push(formatFindingRow(finding))
    }

    for (const finding of report.findings) {
      if (!finding.rewrite && !finding.verifyCommand) continue
      if (finding.rewrite) {
        lines.push(
          '',
          `**Rewrite** (${escapeMarkdown(finding.rule)}, ${finding.rewrite.confidence}):`,
          fencedCode(finding.rewrite.sql, 'sql')
        )
      }
      if (finding.verifyCommand) {
        lines.push('', '**Verify:**', fencedCode(finding.verifyCommand, 'sh'))
      }
    }
  }

  if (report.skippedRules.length > 0) {
    lines.push('', '**Skipped rules:**')
    for (const skipped of report.skippedRules) {
      lines.push(`- ${escapeMarkdown(skipped.rule)} — ${escapeMarkdown(skipped.reason)}`)
    }
  }

  if (report.relatedCommands.length > 0) {
    lines.push('', '**Related commands:**')
    for (const command of report.relatedCommands) {
      lines.push('', fencedCode(command, 'sh'))
    }
  }

  return lines.join('\n')
}

function formatFindingRow(finding: LintFinding): string {
  const cells = [
    escapeMarkdown(finding.severity),
    escapeMarkdown(finding.rule),
    escapeMarkdown(finding.message),
    `${finding.span.start}..${finding.span.end}`,
    finding.schemaVerified ? 'yes' : 'no',
  ]
  return `| ${cells.join(' | ')} |`
}

function escapeMarkdown(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\\/g, '\\\\')
    .replace(/([`*_{}[\]()#+.!|])/g, '\\$1')
    .replace(/\r\n|\r|\n/g, '<br>')
}

function fencedCode(value: string, language: string): string {
  const longestRun = Math.max(0, ...Array.from(value.matchAll(/`+/g), (match) => match[0].length))
  const fence = '`'.repeat(Math.max(3, longestRun + 1))
  return `${fence}${language}\n${value}\n${fence}`
}
