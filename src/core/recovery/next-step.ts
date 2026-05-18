import type { RecoveryEnvelope } from './types'
import type { NextStepOutput, StepResultSummary } from './next-types'

/**
 * Pure, deterministic stepper for the multi-turn `--next` protocol.
 *
 * v1 is a linear cursor walker: given the envelope and the 1-based order of
 * the step the agent just executed, return the next step or `done`.
 *
 * `prevResult` is unused in v1 but required by the signature so future
 * branching codes can dispatch on `prevResult.stdoutSummary` without breaking
 * callers. Branching is keyed on `envelope.error.code`; callers should not
 * encode any per-code logic outside this function.
 *
 * Throws RangeError when `afterStep` is outside `[1, envelope.recovery.length]`
 * or non-integer; the CLI converts these into exit 2 with a reason.
 */
export function nextStepFromEnvelope(
  envelope: RecoveryEnvelope,
  afterStep: number,
  // v1 is linear and ignores prevResult; future branching codes will dispatch on it.
  _prevResult: StepResultSummary
): NextStepOutput {
  if (!Number.isInteger(afterStep)) {
    throw new RangeError(`afterStep must be an integer (got ${afterStep})`)
  }
  if (afterStep < 1) {
    throw new RangeError(`afterStep must be >= 1 (got ${afterStep})`)
  }
  if (afterStep > envelope.recovery.length) {
    throw new RangeError(`afterStep ${afterStep} exceeds plan length ${envelope.recovery.length}`)
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
