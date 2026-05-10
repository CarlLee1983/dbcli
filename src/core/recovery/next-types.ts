import type { GuideStep } from '@/core/guide/types'
import type { RecoveryCode } from './types'

/** Stable contract version for NextResult JSON. Bump on breaking shape change. */
export const NEXT_SCHEMA_VERSION = 1 as const

/**
 * Caller-supplied result for the step the agent just executed.
 *
 * v1 stepper is linear and does not inspect this payload; future branching
 * codes will dispatch on `stdoutSummary`. Schema is locked now so agent
 * integrations can rely on it without break-fix churn.
 */
export interface StepResultSummary {
  status: 'ok' | 'failed' | 'skipped'
  exitCode?: number
  /** Last 4 KB of stdout. Strict cap; longer input rejected at parse time. */
  stdoutSummary?: string
  /** Last 4 KB of stderr. Strict cap; longer input rejected at parse time. */
  stderrSummary?: string
}

export const STEP_RESULT_SUMMARY_FIELD_CAP = 4096

/** Output of `nextStepFromEnvelope`. */
export type NextStepOutput = { kind: 'step'; step: GuideStep } | { kind: 'done' }

/** Top-level shape rendered to stdout by `dbcli recover --next`. */
export interface NextResult {
  schemaVersion: typeof NEXT_SCHEMA_VERSION
  kind: 'step' | 'done'
  source: { kind: 'auto' | 'from'; path: string }
  errorCode: RecoveryCode
  /** 1-based order of `step` when kind === 'step'; equals totalSteps when 'done'. */
  cursor: number
  totalSteps: number
  /** Set iff kind === 'step'. */
  step?: GuideStep
}
