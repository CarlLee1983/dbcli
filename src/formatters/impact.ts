import type { ImpactReport } from '@/core/impact'

export type ImpactFormat = 'json' | 'markdown'

export function formatImpact(report: ImpactReport, format: ImpactFormat): string {
  return format === 'json' ? JSON.stringify(report, null, 2) : formatMarkdown(report)
}

function formatMarkdown(report: ImpactReport): string {
  const lines = [
    '# Impact assessment',
    '',
    `Scope: \`${escapeInline(report.scope.key)}\` (${escapeText(report.scope.system)})`,
    '',
    '## Findings',
    '',
  ]
  if (report.findings.length === 0) lines.push('No declared dependencies were found.')
  else {
    lines.push('| Severity | Code | Location |', '| --- | --- | --- |')
    for (const finding of report.findings) {
      lines.push(
        `| ${finding.severity} | ${finding.code} | ${escapeText(`${finding.location.artifact}#${finding.location.selector}`)} |`
      )
    }
  }
  lines.push('', '## Recommended verification', '')
  if (report.recommendedVerification.length === 0) lines.push('No additional declared verification is recommended.')
  else {
    for (const recommendation of report.recommendedVerification) {
      lines.push(
        `- ${recommendation.policy}: ${escapeText(`${recommendation.source.artifact}#${recommendation.source.selector}`)}`
      )
    }
  }
  lines.push('', '## Coverage', '', `Level: **${report.coverage.level}**`)
  if (report.coverage.gaps.length > 0) {
    lines.push('')
    for (const gap of report.coverage.gaps) lines.push(`- ${gap.severity}: ${gap.code}`)
  }
  lines.push(
    '',
    `Summary: ${report.summary.errors} error(s), ${report.summary.warns} warning(s), ${report.summary.infos} info(s).`
  )
  return `${lines.join('\n')}\n`
}

function escapeInline(value: string): string {
  return value.replace(/`/g, '\\`')
}

function escapeText(value: string): string {
  return value.replace(/[|\\`*_<>]/g, '\\$&')
}
