import type { Option } from 'commander'
import {
  OPERATION_ENVELOPE_SCHEMA_VERSION,
  serializeOperationEnvelope,
  type OperationEnvelope,
  type OperationEnvelopeOperation,
} from '@/core/operation-envelope'

export const AGENT_OUTPUT_TOKEN = '--agent-output'

export type AgentOutputFailureCode =
  | 'INVALID_AGENT_OUTPUT_OPTIONS'
  | 'INVALID_CORRELATION_ID'
  | 'UNSUPPORTED_AGENT_OUTPUT_OPERATION'
  | 'INVALID_CAPABILITY_REQUIREMENTS'
  | 'INVALID_QUERY_INPUT'
  | 'AGENT_OUTPUT_INTERNAL_ERROR'

const FAILURE_MESSAGES: Readonly<Record<AgentOutputFailureCode, string>> = {
  INVALID_AGENT_OUTPUT_OPTIONS: 'Agent output options are invalid.',
  INVALID_CORRELATION_ID: 'Invalid correlation ID.',
  UNSUPPORTED_AGENT_OUTPUT_OPERATION: 'Agent output is not supported for this operation.',
  INVALID_CAPABILITY_REQUIREMENTS: 'Capability requirements are invalid.',
  INVALID_QUERY_INPUT: 'Query input is invalid.',
  AGENT_OUTPUT_INTERNAL_ERROR: 'Agent output failed safely.',
}

export interface AgentOutputPreflightFailure {
  readonly code:
    | 'INVALID_AGENT_OUTPUT_OPTIONS'
    | 'INVALID_CORRELATION_ID'
    | 'UNSUPPORTED_AGENT_OUTPUT_OPERATION'
  readonly exitCode: 2
  /** Replaces the generic message when the caller can act on a more specific one. */
  readonly message?: string
}

export type AgentOutputPreflight =
  | { readonly active: false }
  | {
      readonly active: true
      readonly operation: OperationEnvelopeOperation
      readonly failure?: AgentOutputPreflightFailure
    }

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
  readonly invalidCorrelationId: boolean
}

function scanRootOptions(args: readonly string[], rootOptions: readonly Option[]): RootOptionScan {
  const consumedIndexes = new Set<number>()
  let commandIndex = -1
  let invalid = false
  let invalidCorrelationId = false

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
    if (!option.required) continue

    if (token.includes('=')) {
      if (option.parseArg) {
        try {
          option.parseArg(token.slice(token.indexOf('=') + 1), option.defaultValue)
        } catch {
          invalid = true
          invalidCorrelationId ||= option.long === '--correlation-id'
        }
      }
      continue
    }

    const valueIndex = index + 1
    if (valueIndex >= args.length) {
      invalid = true
      invalidCorrelationId ||= option.long === '--correlation-id'
      continue
    }
    consumedIndexes.add(valueIndex)
    if (option.parseArg) {
      try {
        option.parseArg(args[valueIndex]!, option.defaultValue)
      } catch {
        invalid = true
        invalidCorrelationId ||= option.long === '--correlation-id'
      }
    }
    index = valueIndex
  }

  return { commandIndex, consumedIndexes, invalid, invalidCorrelationId }
}

function outputConflictFlag(args: readonly string[]): '--format' | '--for-agent' | undefined {
  for (const token of args) {
    if (token === '--format' || token.startsWith('--format=')) return '--format'
    if (token === '--for-agent' || token.startsWith('--for-agent=')) return '--for-agent'
  }
  return undefined
}

const QUERY_OPERATION_BY_COMMAND = {
  query: 'query.execute',
  q: 'saved-query.execute',
} as const satisfies Record<string, OperationEnvelopeOperation>

/**
 * Flags that ask for a second output contract (a recovery envelope, a browser
 * dashboard, a dry-run preview, a verification pass) and so cannot share
 * stdout with the one envelope `--agent-output` promises.
 */
const QUERY_INCOMPATIBLE_FLAGS = new Set(['--recovery', '--ui', '--dry-run', '--verify'])

function hasQueryIncompatibleFlag(args: readonly string[]): boolean {
  for (const token of args) {
    if (token === '--') return false
    if (QUERY_INCOMPATIBLE_FLAGS.has(token.split('=', 1)[0]!)) return true
  }
  return false
}

/** Classify the exact opt-in before Commander can print prose or run an action. */
export function inspectAgentOutputInvocation(
  args: readonly string[],
  rootOptions: readonly Option[]
): AgentOutputPreflight {
  const agentIndexes = args.flatMap((token, index) => (token === AGENT_OUTPUT_TOKEN ? [index] : []))
  if (agentIndexes.length === 0) return { active: false }

  const scan = scanRootOptions(args, rootOptions)
  const commandName = scan.commandIndex === -1 ? undefined : args[scan.commandIndex]
  const isCapabilitiesCheck =
    commandName === 'capabilities' && args[scan.commandIndex + 1] === 'check'
  const isCapabilitiesList =
    commandName === 'capabilities' &&
    (args.length === scan.commandIndex + 1 ||
      args[scan.commandIndex + 1] === '--' ||
      args[scan.commandIndex + 1]?.startsWith('--'))
  const queryOperation =
    commandName !== undefined && Object.hasOwn(QUERY_OPERATION_BY_COMMAND, commandName)
      ? QUERY_OPERATION_BY_COMMAND[commandName as keyof typeof QUERY_OPERATION_BY_COMMAND]
      : undefined
  const operation: OperationEnvelopeOperation =
    queryOperation ??
    (isCapabilitiesList
      ? 'capabilities.list'
      : commandName === 'capabilities'
        ? 'capabilities.check'
        : 'cli.invocation')

  const misplaced = agentIndexes.some(
    (index) =>
      scan.consumedIndexes.has(index) || (scan.commandIndex !== -1 && index > scan.commandIndex)
  )
  const misplacedCorrelationId = args
    .slice(scan.commandIndex + 1)
    .some((token) => token === '--correlation-id' || token.startsWith('--correlation-id='))
  if (scan.invalidCorrelationId) {
    return {
      active: true,
      operation,
      failure: { code: 'INVALID_CORRELATION_ID', exitCode: 2 },
    }
  }
  const conflictFlag = outputConflictFlag(args)
  if (conflictFlag !== undefined) {
    return {
      active: true,
      operation,
      failure: {
        code: 'INVALID_AGENT_OUTPUT_OPTIONS',
        exitCode: 2,
        message: `--agent-output cannot be combined with ${conflictFlag}; remove ${conflictFlag}.`,
      },
    }
  }
  if (
    misplaced ||
    misplacedCorrelationId ||
    scan.invalid ||
    (queryOperation !== undefined && hasQueryIncompatibleFlag(args.slice(scan.commandIndex + 1)))
  ) {
    return {
      active: true,
      operation,
      failure: { code: 'INVALID_AGENT_OUTPUT_OPTIONS', exitCode: 2 },
    }
  }

  const meta = args.some(isMetaToken)
  const supported = isCapabilitiesCheck || isCapabilitiesList || queryOperation !== undefined
  if (meta || !supported) {
    return {
      active: true,
      operation,
      failure: { code: 'UNSUPPORTED_AGENT_OUTPUT_OPERATION', exitCode: 2 },
    }
  }

  return { active: true, operation }
}

export function createAgentOutputFailure(
  code: AgentOutputFailureCode,
  operation: OperationEnvelopeOperation = 'capabilities.check',
  message: string = FAILURE_MESSAGES[code]
): OperationEnvelope {
  return {
    schemaVersion: OPERATION_ENVELOPE_SCHEMA_VERSION,
    ok: false,
    operation,
    status: 'failed',
    context: null,
    data: null,
    warnings: [],
    evidence: [],
    recovery: null,
    error: { code, message },
  }
}

let writeEnvelope: (output: string) => void = (output) => {
  process.stdout.write(output)
}

/**
 * Make the envelope the only thing the process can put on stdout or stderr.
 *
 * Stream purity is enforced here, at the CLI boundary, rather than trusted to
 * every command: config loading, the audit sink, a driver or a library can all
 * print, and one stray line turns the envelope into unparseable output. The
 * envelope keeps the stdout writer captured before the mute, so whatever
 * synchronous redirected-stdout writer the runtime installed still delivers it
 * completely.
 */
export function silenceProcessOutputExceptEnvelope(): void {
  const stdoutWrite = process.stdout.write.bind(process.stdout)
  writeEnvelope = (output) => {
    stdoutWrite(output)
  }

  const swallow = ((
    _chunk: unknown,
    encodingOrCallback?: unknown,
    callback?: (error?: Error | null) => void
  ): boolean => {
    const onComplete = typeof encodingOrCallback === 'function' ? encodingOrCallback : callback
    ;(onComplete as ((error?: Error | null) => void) | undefined)?.()
    return true
  }) as typeof process.stdout.write
  process.stdout.write = swallow
  process.stderr.write = swallow

  const nothing = (): void => undefined
  console.log = nothing
  console.info = nothing
  console.debug = nothing
  console.warn = nothing
  console.error = nothing
}

/** Validate, serialize, and write exactly one complete envelope. */
export function emitAgentOutputEnvelope(envelope: OperationEnvelope, exitCode: number): number {
  try {
    const serialized = serializeOperationEnvelope(envelope)
    writeEnvelope(serialized.output)
    return serialized.exceededLimit ? 1 : exitCode
  } catch {
    const serialized = serializeOperationEnvelope(
      createAgentOutputFailure('AGENT_OUTPUT_INTERNAL_ERROR', envelope.operation)
    )
    writeEnvelope(serialized.output)
    return 1
  }
}

export function emitAgentOutputFailure(
  code: AgentOutputFailureCode,
  exitCode: 1 | 2,
  operation: OperationEnvelopeOperation = 'capabilities.check',
  message?: string
): number {
  return emitAgentOutputEnvelope(createAgentOutputFailure(code, operation, message), exitCode)
}
