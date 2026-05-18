import type { NextResult } from './next-types'

export function renderNextMarkdown(result: NextResult): string {
  const lines: string[] = []
  lines.push('# dbcli recover --next')
  lines.push('')
  lines.push(`*Source:* \`${result.source.kind}\` → \`${result.source.path}\``)
  lines.push(`errorCode: \`${result.errorCode}\``)
  if (result.branchId !== undefined) {
    lines.push(`**Branch:** \`${result.branchId}\``)
    if (result.branchDescription !== undefined) {
      lines.push(`**Branch description:** ${result.branchDescription}`)
    }
  }
  lines.push('')

  if (result.kind === 'step' && result.step) {
    lines.push(`## Next step (${result.cursor} of ${result.totalSteps})`)
    lines.push(`${result.step.order}. \`${result.step.command}\``)
    lines.push(`   - risk: \`${result.step.risk}\``)
    lines.push(`   - rationale: ${result.step.rationale}`)
    lines.push(`   - expects: ${result.step.expects}`)
    if (result.step.placeholders && result.step.placeholders.length > 0) {
      lines.push(`   - placeholders: ${result.step.placeholders.join(', ')}`)
    }
    if (result.step.interactive === true) {
      lines.push('   - interactive: true')
    }
    lines.push('')
  } else {
    lines.push('## Done')
    lines.push(`All ${result.totalSteps} steps consumed; no further recovery suggestions.`)
    lines.push('')
  }

  return lines.join('\n')
}
