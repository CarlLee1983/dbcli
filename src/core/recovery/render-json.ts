import type { GuideStep } from '@/core/guide/types'
import type { RecoveryEnvelope, RecoveryRenderOptions } from './types'

export function renderJson(env: RecoveryEnvelope, options: RecoveryRenderOptions = {}): string {
  const out = options.brief ? toBrief(env) : env
  return JSON.stringify(out, null, 2)
}

function toBrief(env: RecoveryEnvelope): RecoveryEnvelope {
  return { ...env, recovery: env.recovery.map(stripVerbose) }
}

function stripVerbose(step: GuideStep): GuideStep {
  const compact: GuideStep = {
    order: step.order,
    command: step.command,
    risk: step.risk,
  } as GuideStep
  if (step.snippet) compact.snippet = step.snippet
  if (step.intent) compact.intent = step.intent
  return compact
}
