import type { GuideStep } from '@/core/guide/types'
import {
  RECOVERY_CODES,
  RECOVERY_CODE_METADATA,
  type RecoveryEnvelope,
  type RecoveryRenderOptions,
} from './types'

export function renderMarkdown(env: RecoveryEnvelope, options: RecoveryRenderOptions = {}): string {
  const brief = options.brief === true
  const lines: string[] = []

  lines.push(`# dbcli recovery: ${env.error.code}`)
  lines.push('')
  lines.push(`*Schema version:* ${env.schemaVersion}`)
  lines.push(`*Generated:* ${env.generatedAt}`)
  lines.push('')

  lines.push('## Error')
  lines.push(`- code: \`${env.error.code}\``)
  lines.push(`- category: \`${env.error.category}\``)
  lines.push(`- message: ${env.error.message}`)
  if (env.error.details && Object.keys(env.error.details).length > 0) {
    lines.push('- details:')
    for (const [k, v] of Object.entries(env.error.details)) {
      if (v !== undefined && v !== null && v !== '') {
        lines.push(`  - ${k}: \`${v}\``)
      }
    }
  }
  lines.push('')

  lines.push('## Recovery')
  if (env.recovery.length === 0) {
    lines.push('- (no steps available)')
  } else {
    for (const step of env.recovery) {
      lines.push(...renderStep(step, brief))
    }
  }
  lines.push('')

  if (env.verify) {
    lines.push('## Verification')
    lines.push(...renderStep(env.verify, brief))
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

export function renderCodeList(): string {
  const lines: string[] = []
  lines.push('# dbcli recovery codes')
  lines.push('')
  for (const code of RECOVERY_CODES) {
    const meta = RECOVERY_CODE_METADATA[code]
    lines.push(`- \`${code}\` (${meta.category}) — ${meta.description}`)
  }
  lines.push('')
  return lines.join('\n')
}
