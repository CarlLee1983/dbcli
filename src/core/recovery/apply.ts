import { classifyStep } from './apply-gate'
import { executeStep, type ExecOutcome, type ExecOptions } from './apply-exec'
import {
  APPLY_SCHEMA_VERSION,
  type ApplyInput,
  type ApplyOptions,
  type ApplyResult,
  type FinalStatus,
  type StepResult,
} from './apply-types'

type Executor = (argv: string[], opts: ExecOptions) => Promise<ExecOutcome>

let executor: Executor = executeStep

/** @internal Test-only seam — overrides the child-process executor. */
export function __setExecutorForTests(impl: Executor): void {
  executor = impl
}

/** @internal Test-only seam — restore the real executor between suites. */
export function __resetExecutorForTests(): void {
  executor = executeStep
}

const DEFAULT_TIMEOUT_MS = 60_000

export async function runApply(input: ApplyInput, opts: ApplyOptions): Promise<ApplyResult> {
  const startedAt = new Date().toISOString()
  const results: StepResult[] = []
  let finalStatus: FinalStatus = 'skipped-only'
  let stoppedAt: number | null = null

  for (const step of input.envelope.recovery) {
    const decision = classifyStep(step, opts.allowWrite, input.envelope.error.code)
    if (decision.kind !== 'run') {
      results.push({
        order: step.order,
        command: step.command,
        status: decision.kind,
        reason: decision.reason,
      })
      continue
    }

    const outcome = await executor(decision.argv!, {
      cwd: input.cwd,
      env: process.env,
      timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      stdoutCap: opts.stdoutCap,
      stderrCap: opts.stderrCap,
    })

    const ok = outcome.exitCode === 0 && !outcome.timedOut
    results.push({
      order: step.order,
      command: step.command,
      status: ok ? 'ok' : 'failed',
      exitCode: outcome.exitCode,
      durationMs: outcome.durationMs,
      stdout: outcome.stdout,
      stderr: outcome.stderr,
      truncated: outcome.truncated,
    })

    if (!ok) {
      finalStatus = 'failed'
      stoppedAt = step.order
      break
    }
    finalStatus = 'ok'
  }

  return {
    schemaVersion: APPLY_SCHEMA_VERSION,
    startedAt,
    finishedAt: new Date().toISOString(),
    source: input.source,
    envelope: input.envelope,
    results,
    finalStatus,
    stoppedAt,
  }
}
