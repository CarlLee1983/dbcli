import type { Option } from 'commander'
import {
  OPERATION_ENVELOPE_SCHEMA_VERSION,
  serializeOperationEnvelope,
  type OperationEnvelope,
} from '@/core/operation-envelope'

export const AGENT_OUTPUT_TOKEN = '--agent-output'

export type AgentOutputFailureCode =
  | 'INVALID_AGENT_OUTPUT_OPTIONS'
  | 'UNSUPPORTED_AGENT_OUTPUT_OPERATION'
  | 'INVALID_CAPABILITY_REQUIREMENTS'
  | 'AGENT_OUTPUT_INTERNAL_ERROR'

const FAILURE_MESSAGES: Readonly<Record<AgentOutputFailureCode, string>> = {
  INVALID_AGENT_OUTPUT_OPTIONS: 'Agent output options are invalid.',
  UNSUPPORTED_AGENT_OUTPUT_OPERATION: 'Agent output is not supported for this operation.',
  INVALID_CAPABILITY_REQUIREMENTS: 'Capability requirements are invalid.',
  AGENT_OUTPUT_INTERNAL_ERROR: 'Agent output failed safely.',
}

export interface AgentOutputPreflightFailure {
  readonly code: 'INVALID_AGENT_OUTPUT_OPTIONS' | 'UNSUPPORTED_AGENT_OUTPUT_OPERATION'
  readonly exitCode: 2
}

export type AgentOutputPreflight =
  | { readonly active: false }
  | { readonly active: true; readonly failure?: AgentOutputPreflightFailure }

function optionFor(options: readonly Option[], token: string): Option | undefined {
  const flag = token.split('=', 1)[0]
  return options.find((option) => option.long === flag || option.short === flag)
}

function isMetaShortCluster(token: string): boolean {
  return /^-[qvhV]+$/.test(token) && /[hV]/.test(token)
}

const META_OPTIONS = new Set(['--help', '-h', '--version', '-V'])

function isMetaToken(token: string): boolean {
  return META_OPTIONS.has(token) || isMetaShortCluster(token)
}

interface RootOptionScan {
  readonly commandIndex: number
  readonly consumedIndexes: ReadonlySet<number>
  readonly invalid: boolean
}

function scanRootOptions(args: readonly string[], rootOptions: readonly Option[]): RootOptionScan {
  const consumedIndexes = new Set<number>()
  let commandIndex = -1
  let invalid = false

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index]!
    if (token === '--') break
    if (!token.startsWith('-')) {
      commandIndex = index
      break
    }
    if (isMetaToken(token) || /^-[qv]+$/.test(token)) continue

    const option = optionFor(rootOptions, token)
    if (!option) {
      invalid = true
      continue
    }
    if (!option.required || token.includes('=')) continue

    const valueIndex = index + 1
    if (valueIndex >= args.length) {
      invalid = true
      continue
    }
    consumedIndexes.add(valueIndex)
    if (option.parseArg) {
      try {
        option.parseArg(args[valueIndex]!, option.defaultValue)
      } catch {
        invalid = true
      }
    }
    index = valueIndex
  }

  return { commandIndex, consumedIndexes, invalid }
}

function hasOutputConflict(args: readonly string[]): boolean {
  return args.some(
    (token) =>
      token === '--format' ||
      token.startsWith('--format=') ||
      token === '--for-agent' ||
      token.startsWith('--for-agent=')
  )
}

/** Classify the exact opt-in before Commander can print prose or run an action. */
export function inspectAgentOutputInvocation(
  args: readonly string[],
  rootOptions: readonly Option[]
): AgentOutputPreflight {
  const agentIndexes = args.flatMap((token, index) => (token === AGENT_OUTPUT_TOKEN ? [index] : []))
  if (agentIndexes.length === 0) return { active: false }

  const scan = scanRootOptions(args, rootOptions)

  const misplaced = agentIndexes.some(
    (index) =>
      scan.consumedIndexes.has(index) || (scan.commandIndex !== -1 && index > scan.commandIndex)
  )
  if (misplaced || hasOutputConflict(args) || scan.invalid) {
    return {
      active: true,
      failure: { code: 'INVALID_AGENT_OUTPUT_OPTIONS', exitCode: 2 },
    }
  }

  const meta = args.some(isMetaToken)
  const supported =
    scan.commandIndex !== -1 &&
    args[scan.commandIndex] === 'capabilities' &&
    args[scan.commandIndex + 1] === 'check'
  if (meta || !supported) {
    return {
      active: true,
      failure: { code: 'UNSUPPORTED_AGENT_OUTPUT_OPERATION', exitCode: 2 },
    }
  }

  return { active: true }
}

export function createAgentOutputFailure(code: AgentOutputFailureCode): OperationEnvelope {
  return {
    schemaVersion: OPERATION_ENVELOPE_SCHEMA_VERSION,
    ok: false,
    operation: 'capabilities.check',
    status: 'failed',
    context: null,
    data: null,
    warnings: [],
    evidence: [],
    recovery: null,
    error: { code, message: FAILURE_MESSAGES[code] },
  }
}

/** Validate, serialize, and write exactly one complete envelope. */
export function emitAgentOutputEnvelope(envelope: OperationEnvelope, exitCode: number): number {
  try {
    const serialized = serializeOperationEnvelope(envelope)
    process.stdout.write(serialized.output)
    return serialized.exceededLimit ? 1 : exitCode
  } catch {
    const serialized = serializeOperationEnvelope(
      createAgentOutputFailure('AGENT_OUTPUT_INTERNAL_ERROR')
    )
    process.stdout.write(serialized.output)
    return 1
  }
}

export function emitAgentOutputFailure(code: AgentOutputFailureCode, exitCode: 1 | 2): number {
  return emitAgentOutputEnvelope(createAgentOutputFailure(code), exitCode)
}
