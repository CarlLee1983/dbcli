import { describeGoal, listGoals } from './goal-map'
import type { GuideSnapshot, GuideStep } from './types'
import type { RenderOptions } from './render-json'

export function renderMarkdown(snap: GuideSnapshot, options: RenderOptions = {}): string {
  const brief = options.brief === true
  const lines: string[] = []

  lines.push(`# dbcli guide: ${snap.goal}`)
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

  lines.push('## Plan')
  if (snap.steps.length === 0) {
    lines.push('- (no steps generated)')
  } else {
    for (const step of snap.steps) {
      lines.push(...renderStep(step, brief))
    }
  }
  lines.push('')

  if (snap.warnings.length > 0) {
    lines.push('## Warnings')
    for (const w of snap.warnings) {
      const src = w.source ? ` (${w.source})` : ''
      lines.push(`- [${w.severity}]${src} ${w.message}`)
    }
    lines.push('')
  }

  return lines.join('\n')
}

function renderStep(step: GuideStep, brief: boolean): string[] {
  const out: string[] = []
  out.push(`${step.order}. \`${step.command}\``)
  out.push(`   - risk: \`${step.risk}\``)
  if (!brief) {
    out.push(`   - rationale: ${step.rationale}`)
    out.push(`   - expects: ${step.expects}`)
  }
  if (step.snippet) out.push(`   - snippet: \`${step.snippet}\``)
  if (step.intent) out.push(`   - intent: \`${step.intent}\``)
  return out
}

export function renderGoalList(): string {
  const lines: string[] = []
  lines.push('# dbcli guide goals')
  lines.push('')
  for (const id of listGoals()) {
    lines.push(`- \`${id}\` — ${describeGoal(id)}`)
  }
  lines.push('')
  return lines.join('\n')
}
