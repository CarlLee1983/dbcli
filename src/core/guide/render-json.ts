import type { GuideSnapshot, GuideStep } from './types'

export interface RenderOptions {
  brief?: boolean
}

export function renderJson(snap: GuideSnapshot, options: RenderOptions = {}): string {
  const out = options.brief ? toBrief(snap) : snap
  return JSON.stringify(out, null, 2)
}

function toBrief(snap: GuideSnapshot): GuideSnapshot {
  const steps = snap.steps.map(stripVerbose)
  return { ...snap, steps }
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
