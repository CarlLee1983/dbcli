import type { RecoveryEnvelope } from './types'

export const APPLY_SCHEMA_VERSION = 1 as const

/** Tier opened by `--allow-write`. `none` is the safe default. */
export type AllowWrite = 'none' | 'readonly-cmd' | 'write-cmd'

/** Reason for a non-executed step. Matches the `status` discriminator suffix. */
export type SkipReason = 'risk' | 'interactive' | 'placeholder' | 'unsafe-command'

export type StepStatus =
  | 'ok'
  | 'failed'
  | `skipped:${SkipReason}`

export interface StepResult {
  order: number
  command: string
  status: StepStatus
  /** Set when `status === 'ok' | 'failed'`. */
  exitCode?: number
  /** Set when `status === 'ok' | 'failed'`. */
  durationMs?: number
  /** Set when `status === 'ok' | 'failed'`. May be empty string. */
  stdout?: string
  /** Set when `status === 'ok' | 'failed'`. */
  stderr?: string
  /** Set when stdout or stderr exceeded the per-step cap. */
  truncated?: boolean
  /** Human-readable reason; only set for `skipped:*`. */
  reason?: string
}

export type FinalStatus = 'ok' | 'failed' | 'skipped-only'

export interface ApplySource {
  kind: 'auto' | 'from'
  path: string
}

export interface ApplyInput {
  envelope: RecoveryEnvelope
  cwd: string
  source: ApplySource
}

export interface ApplyOptions {
  allowWrite: AllowWrite
  /** Wall-clock cap per step. Default 60_000. */
  timeoutMs?: number
  /** Stdout truncation cap (bytes). Default 65_536. */
  stdoutCap?: number
  /** Stderr truncation cap (bytes). Default 65_536. */
  stderrCap?: number
  /** Override clock for testing. */
  now?: () => number
}

export interface ApplyResult {
  schemaVersion: typeof APPLY_SCHEMA_VERSION
  startedAt: string
  finishedAt: string
  source: ApplySource
  envelope: RecoveryEnvelope
  results: StepResult[]
  finalStatus: FinalStatus
  /** 1-based `order` of the step that caused fail-fast; null otherwise. */
  stoppedAt: number | null
}

export interface SavedRecoveryEnvelope {
  schemaVersion: 1
  savedAt: string
  /** Sanitized command summary. Never a verbatim argv dump. */
  command: string
  cwd: string
  envelope: RecoveryEnvelope
}

export const EXIT_CODE = {
  ok: 0,
  failed: 1,
  malformed: 2,
  skippedOnly: 3,
} as const
