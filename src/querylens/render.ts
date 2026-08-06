import type { QuerylensReport } from './analyze'

function sqlInline(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim().replace(/`/g, '\\`')
}

function none(lines: string[], values: readonly unknown[]): void {
  if (values.length === 0) lines.push('_None._')
}

/** Render a concise, deterministic report suitable for a pull-request comment. */
export function renderQuerylensMarkdown(report: QuerylensReport, top: number): string {
  const lines: string[] = [
    '# QueryLens report',
    '',
    '## Summary',
    '',
    `- Sessions: ${report.summary.sessions}`,
    `- Queries: ${report.summary.queries}`,
    `- Errors: ${report.summary.errors} (${(report.summary.errorRate * 100).toFixed(2)}%)`,
    `- Slow queries: ${report.summary.slowCount}`,
    `- Latency: p50 ${report.summary.latencyMs.p50}ms, p95 ${report.summary.latencyMs.p95}ms, p99 ${report.summary.latencyMs.p99}ms, max ${report.summary.latencyMs.max}ms`,
    '',
    '## Top expensive fingerprints',
    '',
  ]
  const fingerprints = report.byFingerprint.slice(0, top)
  none(lines, fingerprints)
  for (const item of fingerprints) {
    lines.push(
      `- ${item.count}× · ${item.durationMs.total}ms total · ${item.durationMs.avg}ms avg · \`${sqlInline(item.fingerprint)}\``
    )
  }

  lines.push('', '## Slowest queries', '')
  const slowest = report.slowest.slice(0, top)
  none(lines, slowest)
  for (const query of slowest) lines.push(`- ${query.durationMs}ms · \`${sqlInline(query.sql)}\``)

  lines.push('', '## Errors', '')
  const errors = report.errors.slice(0, top)
  none(lines, errors)
  for (const error of errors) {
    lines.push(
      `- ${error.count}× · [${error.code ?? '?'}] ${error.message} · \`${sqlInline(error.fingerprint)}\``
    )
  }

  lines.push('', '## N+1 suspects', '')
  const repetition = report.repetition.slice(0, top)
  none(lines, repetition)
  for (const item of repetition) {
    lines.push(
      `- ${item.count}× in session ${item.sessionId} over ${item.spanMs}ms · \`${sqlInline(item.fingerprint)}\``
    )
  }

  return `${lines.join('\n')}\n`
}
