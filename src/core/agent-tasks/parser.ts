import { parseYamlMini } from '@/core/saved-queries/yaml-mini'
import { DATABASE_SYSTEMS } from '@/adapters/types'
import { findCapability } from '@/core/capabilities'
import {
  AgentTaskError,
  type AgentTask,
  type AgentTaskEngine,
  type AgentTaskParam,
  type AgentTaskParamType,
  type AgentTaskRisk,
  type AgentTaskSource,
  type AgentTaskStep,
} from './types'

const VALID_ENGINES: readonly AgentTaskEngine[] = DATABASE_SYSTEMS
const VALID_PARAM_TYPES: AgentTaskParamType[] = ['string', 'number', 'boolean']
const VALID_RISKS: AgentTaskRisk[] = ['readonly', 'dry-run', 'write', 'unknown']

export interface ParseInput {
  /** Logical task name derived from path (e.g. `diag/long-running`) */
  name: string
  file: string
  source: AgentTaskSource
  text: string
}

export function parseAgentTask(input: ParseInput): AgentTask {
  const { frontmatter, body } = splitFrontmatter(input.text, input.file)
  if (!frontmatter.trim()) {
    throw new AgentTaskError(`Task '${input.name}' has no frontmatter`, 'PARSE_ERROR', input.file)
  }
  let raw: Record<string, unknown>
  try {
    raw = parseYamlMini(frontmatter) as Record<string, unknown>
  } catch (e) {
    throw new AgentTaskError(
      `Invalid frontmatter in '${input.name}': ${(e as Error).message}`,
      'PARSE_ERROR',
      input.file
    )
  }

  const declaredName = raw.name
  if (typeof declaredName !== 'string' || declaredName.trim() === '') {
    throw new AgentTaskError(
      `Task '${input.name}' is missing required field 'name'`,
      'PARSE_ERROR',
      input.file
    )
  }
  if (declaredName !== input.name) {
    throw new AgentTaskError(
      `Task name '${declaredName}' does not match expected '${input.name}' from filename`,
      'PARSE_ERROR',
      input.file
    )
  }

  const description = typeof raw.description === 'string' ? raw.description : undefined
  const tags = Array.isArray(raw.tags) ? raw.tags.map(String) : []
  const engines = parseEngines(raw.engines, input)
  const params = parseParams(raw.params, input)
  const safety = parseSafety(raw.safety, input)
  const steps = parseSteps(raw.steps, input)
  const notes = body.trim() ? body.trim() : undefined

  return {
    name: declaredName,
    description,
    tags,
    engines,
    params,
    safety,
    steps,
    notes,
    source: input.source,
    file: input.file,
  }
}

function splitFrontmatter(text: string, file: string): { frontmatter: string; body: string } {
  const lines = text.split('\n')
  if (lines[0]?.trim() !== '---') return { frontmatter: '', body: text }
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === '---')
  if (end === -1) {
    throw new AgentTaskError(`Unterminated frontmatter in ${file}`, 'PARSE_ERROR', file)
  }
  return {
    frontmatter: lines.slice(1, end).join('\n'),
    body: lines.slice(end + 1).join('\n'),
  }
}

function parseEngines(value: unknown, input: ParseInput): AgentTaskEngine[] | undefined {
  if (value === undefined || value === null) return undefined
  const list = Array.isArray(value) ? value : [value]
  const cleaned: AgentTaskEngine[] = []
  for (const v of list) {
    const supplied = String(v).toLowerCase()
    const s = supplied === 'postgres' ? 'postgresql' : supplied
    if (!VALID_ENGINES.includes(s as AgentTaskEngine)) {
      throw new AgentTaskError(
        `Unknown engine '${supplied}' in task '${input.name}' (allowed: ${VALID_ENGINES.join(', ')})`,
        'PARSE_ERROR',
        input.file
      )
    }
    cleaned.push(s as AgentTaskEngine)
  }
  return cleaned
}

function parseParams(value: unknown, input: ParseInput): AgentTaskParam[] {
  if (value === undefined || value === null) return []
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new AgentTaskError(
      `'params' in task '${input.name}' must be a map`,
      'PARSE_ERROR',
      input.file
    )
  }
  return Object.entries(value as Record<string, Record<string, unknown> | undefined>).map(
    ([name, spec]) => {
      const type = String(spec?.type ?? 'string') as AgentTaskParamType
      if (!VALID_PARAM_TYPES.includes(type)) {
        throw new AgentTaskError(
          `Param '${name}' in task '${input.name}': invalid type '${type}' (allowed: ${VALID_PARAM_TYPES.join(', ')})`,
          'PARSE_ERROR',
          input.file
        )
      }
      const hasDefault = spec && Object.prototype.hasOwnProperty.call(spec, 'default')
      const required = spec?.required === true ? true : !hasDefault && spec?.required !== false
      const out: AgentTaskParam = { name, type, required }
      if (typeof spec?.description === 'string') out.description = spec.description
      if (hasDefault) out.default = spec!.default as AgentTaskParam['default']
      if (Array.isArray(spec?.enum)) out.enum = spec.enum as AgentTaskParam['enum']
      return out
    }
  )
}

function parseSafety(value: unknown, input: ParseInput): AgentTask['safety'] {
  if (!value || typeof value !== 'object') {
    throw new AgentTaskError(
      `Task '${input.name}' is missing required field 'safety'`,
      'PARSE_ERROR',
      input.file
    )
  }
  const obj = value as Record<string, unknown>
  if (obj.mode !== 'plan-only') {
    throw new AgentTaskError(
      `Task '${input.name}' has invalid safety.mode '${String(obj.mode)}' (only 'plan-only' is supported)`,
      'PARSE_ERROR',
      input.file
    )
  }
  if (obj.requires === undefined) return { mode: 'plan-only' }
  if (
    !Array.isArray(obj.requires) ||
    obj.requires.some((requirement) => typeof requirement !== 'string')
  ) {
    throw new AgentTaskError(
      `Task '${input.name}' has invalid safety.requires (expected capability ids)`,
      'PARSE_ERROR',
      input.file
    )
  }
  const requires = obj.requires.map((requirement) => requirement.trim())
  for (const requirement of requires) {
    const replacement = LEGACY_REQUIREMENTS[requirement]
    if (replacement) {
      throw new AgentTaskError(
        `Task '${input.name}' uses legacy safety.requires '${requirement}'; replace it with '${replacement}'`,
        'PARSE_ERROR',
        input.file
      )
    }
    if (!findCapability(requirement)) {
      throw new AgentTaskError(
        `Task '${input.name}' requires unknown capability '${requirement}'`,
        'PARSE_ERROR',
        input.file
      )
    }
  }
  return { mode: 'plan-only', requires }
}

/** Legacy command names are rejected with their one-to-one capability migration. */
const LEGACY_REQUIREMENTS: Record<string, string> = {
  'blacklist-list': 'blacklist.manage',
  'schema-check': 'schema.read',
}

function parseSteps(value: unknown, input: ParseInput): AgentTaskStep[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new AgentTaskError(
      `Task '${input.name}' must declare at least one step`,
      'PARSE_ERROR',
      input.file
    )
  }
  return value.map((raw, idx) => {
    if (!raw || typeof raw !== 'object') {
      throw new AgentTaskError(
        `Task '${input.name}' step #${idx + 1} is not an object`,
        'PARSE_ERROR',
        input.file
      )
    }
    const obj = raw as Record<string, unknown>
    if (obj.type !== 'command') {
      throw new AgentTaskError(
        `Task '${input.name}' step #${idx + 1} has unsupported type '${String(obj.type)}' (only 'command' is supported)`,
        'PARSE_ERROR',
        input.file
      )
    }
    if (typeof obj.command !== 'string' || obj.command.trim() === '') {
      throw new AgentTaskError(
        `Task '${input.name}' step #${idx + 1} is missing 'command'`,
        'PARSE_ERROR',
        input.file
      )
    }
    const risk = obj.risk === undefined ? undefined : (String(obj.risk) as AgentTaskRisk)
    if (risk !== undefined && !VALID_RISKS.includes(risk)) {
      throw new AgentTaskError(
        `Task '${input.name}' step #${idx + 1} has invalid risk '${risk}'`,
        'PARSE_ERROR',
        input.file
      )
    }
    const step: AgentTaskStep = { type: 'command', command: obj.command.trim() }
    if (typeof obj.reason === 'string') step.reason = obj.reason
    if (risk !== undefined) step.risk = risk
    return step
  })
}
