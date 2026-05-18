import type { RecoveryEnvelope, RecoveryCode } from './types'
import type { NextStepOutput, StepResultSummary } from './next-types'
import { matchConnectionBranch, type ResolverTraceLine } from './connection-branches'

export interface NextStepOptions {
  /** Names the branch being traversed. Omit = walking `recovery`. */
  branchId?: string
  /** Optional sink for verbose trace lines from the resolver (§6.3). */
  trace?: (line: string) => void
}

/** Registry mapping recovery codes to their branching resolver. v1: connection only. */
function resolverFor(
  code: RecoveryCode
):
  | ((prev: StepResultSummary, opts?: { trace?: (line: ResolverTraceLine) => void }) => string | null)
  | null {
  switch (code) {
    case 'CONN_REFUSED':
    case 'CONN_AUTH_FAILED':
    case 'CONN_TIMEOUT':
    case 'CONN_HOST_NOT_FOUND':
    case 'CONN_UNKNOWN':
      return (prev, opts) => matchConnectionBranch(prev, opts)
    default:
      return null
  }
}

function assertAfterStep(afterStep: number) {
  if (!Number.isInteger(afterStep)) {
    throw new RangeError(`afterStep must be an integer (got ${afterStep})`)
  }
  if (afterStep < 1) {
    throw new RangeError(`afterStep must be >= 1 (got ${afterStep})`)
  }
}

/**
 * Pure, deterministic stepper for the multi-turn `--next` protocol.
 *
 * Behavior:
 * - With no `branchId` option: walks `envelope.recovery` linearly. At step
 *   `envelope.branchFork?.after` it consults the resolver for `envelope.error.code`;
 *   on a match it returns the matched branch's first step. On no match it falls
 *   through to `recovery`.
 * - With a `branchId` option: walks `envelope.branches[branchId].steps` linearly.
 *
 * Throws RangeError on argument errors; the CLI converts these into exit 2.
 */
export function nextStepFromEnvelope(
  envelope: RecoveryEnvelope,
  afterStep: number,
  prevResult: StepResultSummary,
  options: NextStepOptions = {}
): NextStepOutput {
  assertAfterStep(afterStep)

  if (options.branchId !== undefined) {
    if (!envelope.branches || !envelope.branches[options.branchId]) {
      const valid = envelope.branches ? Object.keys(envelope.branches).join(', ') : '<none>'
      throw new RangeError(
        `Branch '${options.branchId}' not found in envelope (valid: ${valid}).`
      )
    }
    const plan = envelope.branches[options.branchId]!
    if (afterStep > plan.steps.length) {
      throw new RangeError(
        `afterStep ${afterStep} exceeds branch '${options.branchId}' length ${plan.steps.length}`
      )
    }
    if (afterStep === plan.steps.length) {
      return {
        kind: 'done',
        branchId: options.branchId,
        cursor: afterStep,
        totalSteps: plan.steps.length,
      }
    }
    return {
      kind: 'step',
      branchId: options.branchId,
      step: plan.steps[afterStep]!,
      cursor: afterStep + 1,
      totalSteps: plan.steps.length,
    }
  }

  if (afterStep > envelope.recovery.length) {
    throw new RangeError(
      `afterStep ${afterStep} exceeds plan length ${envelope.recovery.length}`
    )
  }

  if (envelope.branchFork?.after === afterStep && envelope.branches) {
    const resolver = resolverFor(envelope.error.code)
    if (resolver !== null) {
      const traceSink = options.trace
        ? (line: ResolverTraceLine) => {
            const tail = line.detail ?? line.branchId ?? ''
            options.trace!(`connection-branches: ${line.outcome}${tail ? ` ${tail}` : ''}`)
          }
        : undefined
      const branchId = resolver(prevResult, { trace: traceSink })
      if (branchId !== null) {
        const plan = envelope.branches[branchId]
        if (plan && plan.steps.length >= 1) {
          return {
            kind: 'step',
            branchId,
            step: plan.steps[0]!,
            cursor: 1,
            totalSteps: plan.steps.length,
          }
        }
      }
    }
    // fall through to linear walk
  }

  if (afterStep === envelope.recovery.length) {
    return { kind: 'done', cursor: afterStep, totalSteps: envelope.recovery.length }
  }
  return {
    kind: 'step',
    step: envelope.recovery[afterStep]!,
    cursor: afterStep + 1,
    totalSteps: envelope.recovery.length,
  }
}
