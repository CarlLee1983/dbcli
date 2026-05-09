import type { ApplyResult, StepResult } from './apply-types'

export function renderApplyMarkdown(result: ApplyResult): string {
  const lines: string[] = []
  lines.push('# dbcli recover --apply')
  lines.push('')
  lines.push(`*Source:* \`${result.source.kind}\` → \`${result.source.path}\``)
  lines.push(`*error.code:* \`${result.envelope.error.code}\``)
  lines.push(`*Started:* ${result.startedAt}`)
  lines.push(`*Finished:* ${result.finishedAt}`)
  lines.push('')
  lines.push('## Steps')
  for (const r of result.results) {
    lines.push(...renderStep(r))
  }
  lines.push('')
  lines.push('## Summary')
  lines.push(`- finalStatus: \`${result.finalStatus}\``)
  if (result.stoppedAt !== null) {
    lines.push(`- stoppedAt: \`${result.stoppedAt}\``)
  }
  lines.push('')
  return lines.join('\n')
}

function renderStep(r: StepResult): string[] {
  const out: string[] = []
  out.push(`${r.order}. \`${r.command}\` — \`${r.status}\``)
  if (r.reason) out.push(`   - ${r.reason}`)
  if (r.exitCode !== undefined) out.push(`   - exitCode: \`${r.exitCode}\``)
  if (r.durationMs !== undefined) out.push(`   - durationMs: ${r.durationMs}`)
  if (r.truncated) out.push(`   - truncated: true`)
  if (r.stderr && r.stderr.length > 0 && r.status === 'failed') {
    out.push('   - stderr:')
    out.push('     ```')
    for (const line of r.stderr.split('\n').slice(0, 20)) out.push(`     ${line}`)
    out.push('     ```')
  }
  return out
}
