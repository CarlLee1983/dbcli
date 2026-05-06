import { splitArgv } from './argv-split'
import {
  AgentTaskError,
  type AgentTask,
  type AgentTaskParam,
  type AgentTaskParamValues,
  type AgentTaskPlan,
  type AgentTaskPlanStep,
} from './types'

export interface PlanInput {
  task: AgentTask
  params: Record<string, string | number | boolean | undefined>
}

const TEMPLATE_RE = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g

export function planAgentTask(input: PlanInput): AgentTaskPlan {
  const warnings: string[] = []
  const resolved = resolveParams(input.task.params, input.params, warnings)
  const steps: AgentTaskPlanStep[] = input.task.steps.map((step) => {
    const resolvedCommand = applyTemplate(step.command, resolved, input.task)
    const argv = splitArgv(resolvedCommand)
    const out: AgentTaskPlanStep = {
      command: step.command,
      resolvedCommand,
      argv,
    }
    if (step.reason) out.reason = step.reason
    if (step.risk) out.risk = step.risk
    return out
  })

  return {
    name: input.task.name,
    source: input.task.source,
    file: input.task.file,
    description: input.task.description,
    mode: input.task.safety.mode,
    requires: input.task.safety.requires ?? [],
    parameters: resolved,
    steps,
    warnings,
  }
}

function resolveParams(
  spec: AgentTaskParam[],
  provided: Record<string, string | number | boolean | undefined>,
  warnings: string[]
): AgentTaskParamValues {
  const out: AgentTaskParamValues = {}
  const knownNames = new Set(spec.map((p) => p.name))

  for (const p of spec) {
    const raw = provided[p.name]
    if (raw === undefined || raw === '') {
      if (p.default !== undefined) {
        out[p.name] = p.default
        continue
      }
      if (p.required) {
        throw new AgentTaskError(
          `Missing required parameter '${p.name}'`,
          'PARAM_MISSING'
        )
      }
      continue
    }
    out[p.name] = coerce(p, raw)
  }

  for (const key of Object.keys(provided)) {
    if (!knownNames.has(key)) {
      warnings.push(`Unknown parameter '${key}' (ignored)`)
    }
  }
  return out
}

function coerce(p: AgentTaskParam, raw: string | number | boolean): string | number | boolean {
  let value: string | number | boolean
  if (p.type === 'number') {
    const n = typeof raw === 'number' ? raw : Number(raw)
    if (!Number.isFinite(n)) {
      throw new AgentTaskError(
        `Parameter '${p.name}' must be a number (got '${raw}')`,
        'PARAM_INVALID'
      )
    }
    value = n
  } else if (p.type === 'boolean') {
    if (typeof raw === 'boolean') value = raw
    else if (raw === 'true') value = true
    else if (raw === 'false') value = false
    else
      throw new AgentTaskError(
        `Parameter '${p.name}' must be a boolean (got '${raw}')`,
        'PARAM_INVALID'
      )
  } else {
    value = String(raw)
  }
  if (p.enum && !p.enum.includes(value)) {
    throw new AgentTaskError(
      `Parameter '${p.name}' must match enum [${p.enum.join(', ')}] (got '${value}')`,
      'PARAM_INVALID'
    )
  }
  return value
}

function applyTemplate(
  command: string,
  values: AgentTaskParamValues,
  task: AgentTask
): string {
  return command.replace(TEMPLATE_RE, (_match, key: string) => {
    if (!(key in values)) {
      throw new AgentTaskError(
        `Template references unknown parameter '${key}' in task '${task.name}'`,
        'TEMPLATE_SYNTAX',
        task.file
      )
    }
    return String(values[key])
  })
}

export function renderMarkdownPlan(plan: AgentTaskPlan): string {
  const lines: string[] = []
  lines.push(`# Task: ${plan.name}`)
  if (plan.description) lines.push('', plan.description)
  lines.push('', `- **source**: ${plan.source}`)
  lines.push(`- **file**: ${plan.file}`)
  lines.push(`- **mode**: ${plan.mode}`)
  if (plan.requires.length > 0) {
    lines.push(`- **requires**: ${plan.requires.join(', ')}`)
  }

  lines.push('', '## Parameters')
  if (Object.keys(plan.parameters).length === 0) {
    lines.push('_(none)_')
  } else {
    for (const [k, v] of Object.entries(plan.parameters)) {
      lines.push(`- ${k}: ${String(v)}`)
    }
  }

  lines.push('', '## Steps')
  plan.steps.forEach((s, i) => {
    lines.push(`### ${i + 1}. \`${s.resolvedCommand}\``)
    if (s.risk) lines.push(`- risk: ${s.risk}`)
    if (s.reason) lines.push(`- reason: ${s.reason}`)
    if (s.command !== s.resolvedCommand) {
      lines.push(`- template: \`${s.command}\``)
    }
    lines.push('')
  })

  if (plan.warnings.length > 0) {
    lines.push('## Warnings')
    for (const w of plan.warnings) lines.push(`- ${w}`)
  }
  return lines.join('\n')
}
