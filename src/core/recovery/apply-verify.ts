import type { GuideStep } from '@/core/guide/types'
import type { RecoveryCode } from './types'
import { classifyStep } from './apply-gate'
import { executeStep, type ExecOptions, type ExecOutcome } from './apply-exec'
import { evaluateVerify } from './verify-heuristic'
import type { StepResult, VerifyStatus } from './apply-types'

type Executor = (argv: string[], opts: ExecOptions) => Promise<ExecOutcome>

let executor: Executor = executeStep

/** @internal Test-only seam — overrides the verify executor. */
export function __setVerifyExecutorForTests(impl: Executor): void {
  executor = impl
}

/** @internal Test-only seam — restore the real executor between suites. */
export function __resetVerifyExecutorForTests(): void {
  executor = executeStep
}

const DEFAULT_TIMEOUT_MS = 60_000
const VERIFY_ORDER_SENTINEL = 0

export interface VerifyContext {
  code: RecoveryCode
  cwd: string
  env: NodeJS.ProcessEnv
  timeoutMs?: number
  stdoutCap?: number
  stderrCap?: number
}

export interface VerifyOutcome {
  result: StepResult
  status: VerifyStatus
}

/**
 * Run the envelope's verify step under the same gate + executor used for the
 * main plan. Always read-only by construction (verify-steps invariant).
 *
 * Allow-write tier is hard-coded to `'none'` — verifiers must pass the
 * `readonly` / `dry-run` lane to run; anything else is treated as unsafe and
 * surfaces as `indeterminate`.
 */
export async function runVerifyStep(step: GuideStep, ctx: VerifyContext): Promise<VerifyOutcome> {
  const decision = classifyStep(step, 'none', ctx.code)
  if (decision.kind !== 'run') {
    return {
      result: {
        order: VERIFY_ORDER_SENTINEL,
        command: step.command,
        status: decision.kind,
        reason: decision.reason,
      },
      status: 'indeterminate',
    }
  }

  const outcome = await executor(decision.argv!, {
    cwd: ctx.cwd,
    env: ctx.env,
    timeoutMs: ctx.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    stdoutCap: ctx.stdoutCap,
    stderrCap: ctx.stderrCap,
  })

  const ok = outcome.exitCode === 0 && !outcome.timedOut
  const result: StepResult = {
    order: VERIFY_ORDER_SENTINEL,
    command: step.command,
    status: ok ? 'ok' : 'failed',
    exitCode: outcome.exitCode,
    durationMs: outcome.durationMs,
    stdout: outcome.stdout,
    stderr: outcome.stderr,
    truncated: outcome.truncated,
  }

  return { result, status: evaluateVerify(ctx.code, outcome) }
}
