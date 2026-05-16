import type { RecoveryEnvelope } from './types'

export const APPLY_SCHEMA_VERSION = 1 as const

/** Tier opened by `--allow-write`. `none` is the safe default. */
export type AllowWrite = 'none' | 'readonly-cmd' | 'write-cmd'

/**
 * Code-owned tier classification of a parsed argv. Authoritative for
 * `dbcli recover --apply` gating; envelope `risk` / `dbWrite` hints are
 * **not** trusted.
 *
 * - `readonly`     — pure local read; safe under any allow-write tier.
 * - `dry-run`      — write subcommand invoked with `--dry-run`; safe under any tier.
 * - `local-write`  — writes only local config / cache / blacklist; needs `readonly-cmd`.
 * - `db-write`     — mutates the connected database; needs `write-cmd`.
 * - `interactive`  — requires a TTY (`dbcli init` family); never runs under `--apply`.
 */
export type ApplyTier = 'readonly' | 'dry-run' | 'local-write' | 'db-write' | 'interactive'

/** Result of classifying a parsed argv against the per-`error.code` allowlist. */
export type ArgvClassification =
  | { kind: 'allowed'; tier: ApplyTier }
  | { kind: 'unsafe'; reason: string }

/** Reason for a non-executed step. Matches the `status` discriminator suffix. */
export type SkipReason = 'risk' | 'interactive' | 'placeholder' | 'unsafe-command'

export type StepStatus = 'ok' | 'failed' | `skipped:${SkipReason}`

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

/** Heuristic verdict for the verify step (P4). See `verify-heuristic.ts`. */
export type VerifyStatus = 'passed' | 'failed' | 'indeterminate'

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
  /** P4: skip the verify step even when finalStatus is 'ok'. Default false. */
  noVerify?: boolean
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
  /** P4: present iff verify ran (i.e. finalStatus === 'ok' && !noVerify && envelope.verify). */
  verifyResult?: StepResult
  verifyStatus?: VerifyStatus
}

export interface SavedRecoveryEnvelope {
  schemaVersion: 1
  /** Phase 25 D-50/D-51: envelope-level UUID, pre-generated at emitRecoveryEnvelope() entry. Optional for backward compatibility with v1.17-v1.19 envelopes. */
  id?: string
  /** Phase 25 D-53: ID of the audit entry that recorded this failure. Omitted when audit is disabled or write failed (best-effort). */
  audit_ref?: string
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
