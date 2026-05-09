import type { InspectSnapshot } from '@/core/inspect/types'

/** Stable contract version for GuideSnapshot JSON. Bump on breaking shape change. */
export const GUIDE_SCHEMA_VERSION = 1 as const

/** Fixed list of v1.14.0 goals — intentionally small and deterministic. */
export const ALLOWED_GOALS = [
  'slow-query',
  'capacity',
  'health',
  'index-usage',
  'permissions',
  'schema-overview',
] as const
export type GuideGoalId = (typeof ALLOWED_GOALS)[number]

/**
 * Risk vocabulary aligned with `src/core/agent-tasks/types.ts` so AI agents
 * see the same labels across both planners.
 * - `readonly`  — command does not mutate the remote database. Local cache writes
 *                 (e.g. `dbcli schema --refresh` updating `.dbcli/schemas/index.json`)
 *                 still count as readonly. All v1.14.0 steps fall in this bucket.
 * - `dry-run`   — write command that should be invoked with `--dry-run` first.
 * - `write`     — mutating command against the remote database; user/agent
 *                 confirmation expected.
 * - `unknown`   — risk could not be inferred; treat as write.
 */
export type GuideRisk = 'readonly' | 'dry-run' | 'write' | 'unknown'

export interface GuideStep {
  /** 1-based ordinal in the emitted plan. */
  order: number
  /** Exact dbcli command the agent should run next, e.g. `dbcli q @diag/long-running --format json`. */
  command: string
  /** One-sentence justification for this step. */
  rationale: string
  /** Forward-compatible risk tag; v1.14.0 always emits `readonly`. */
  risk: GuideRisk
  /** Short description of expected output shape (helps agents know when to bail). */
  expects: string
  /** Snippet key when the step came from a saved query (e.g. `@diag/long-running`). */
  snippet?: string
  /** Snippet `intent` taxonomy slot when applicable. */
  intent?: string
  /** v1.17.0+: step requires interactive TTY (e.g. `dbcli init`). `dbcli recover --apply` skips these. */
  interactive?: boolean
  /** v1.17.0+: true when the step mutates the connected database. Gates `--apply --allow-write=write-cmd`. */
  dbWrite?: boolean
  /** v1.17.0+: placeholder tokens that must be resolved before `--apply` can execute this step (e.g. `['<table>']`). */
  placeholders?: string[]
}

export interface GuideWarning {
  severity: 'info' | 'warn' | 'error'
  message: string
  /** Optional source: 'config' | 'inspect' | 'snippets' | `goal:<id>`. */
  source?: string
}

export interface GuideSnapshot {
  schemaVersion: typeof GUIDE_SCHEMA_VERSION
  /** ISO-8601 UTC timestamp at snapshot start (e.g. "2026-05-09T10:00:00.000Z"). */
  generatedAt: string
  /** The validated goal that produced this plan. */
  goal: GuideGoalId
  /** Reused inspect snapshot for environment context. */
  context: InspectSnapshot
  /** Ordered list of next-command steps. Capped by `MAX_STEPS` in `build-plan.ts`. */
  steps: GuideStep[]
  warnings: GuideWarning[]
}

export interface GuideOptions {
  workspace: string
  configPath: string
  goal: GuideGoalId
  /** Refresh inspect context via live probe; default false (cache-first). */
  probe?: boolean
  /** Trim `rationale` and `expects` strings for compact output. */
  brief?: boolean
  /** Inspect probe timeout when `probe` is true (default 1500). */
  probeTimeoutMs?: number
}
