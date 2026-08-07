import type { PerformanceAdvisory, QueryResult } from '@/types/query'

export const DEFAULT_SLOW_QUERY_MS = 1000

/**
 * Systems whose `guide slow-query` plan resolves to real diagnostic snippets.
 * Kept static so the query path performs no snippet I/O; a unit test re-derives
 * it from `assets/snippets/diag` so it cannot drift silently.
 */
export const GUIDE_SLOW_QUERY_SYSTEMS = ['mariadb', 'mysql', 'postgresql', 'redis'] as const

const NO_EXTRA_WORK = 'This hint runs no additional database diagnostics.'

/** Options a command already holds; the advisory derives everything from them. */
export interface SlowQueryAdvisoryOptions {
  /** `--slow-ms`; `0` disables the hint. */
  slowMs?: number
  /** `--recovery` output is a machine contract, so the hint is suppressed. */
  recovery?: boolean
  /** Connection system, used only to pick a next step that exists for it. */
  system?: string
}

/**
 * Single place deriving the effective threshold from command options, so the
 * recovery rule cannot be spelled differently at different call sites.
 */
export function slowQueryThresholdFor(options: SlowQueryAdvisoryOptions): number {
  if (options.recovery === true) return 0
  const threshold = options.slowMs ?? DEFAULT_SLOW_QUERY_MS
  assertValidSlowQueryThreshold(threshold)
  return threshold
}

/** Throws on a threshold a command must reject before connecting. */
export function assertValidSlowQueryThreshold(value: number | undefined): void {
  if (value === undefined) return
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error('slow-ms must be a non-negative integer')
  }
}

export function parseSlowQueryThreshold(value: string): number {
  if (!/^\d+$/.test(value)) {
    throw new Error('slow-ms must be a non-negative integer')
  }
  const parsed = Number(value)
  assertValidSlowQueryThreshold(parsed)
  return parsed
}

function recommendationFor(system: string | undefined): string {
  const covered =
    system === undefined ||
    (GUIDE_SLOW_QUERY_SYSTEMS as readonly string[]).includes(system)

  return covered
    ? `Review safely with: dbcli guide slow-query --format markdown. ${NO_EXTRA_WORK}`
    : `Re-check the query shape and the filters it scans; dbcli ships no slow-query diagnostics for ${system}. ${NO_EXTRA_WORK}`
}

/**
 * Builds a passive performance hint from time already measured for a completed
 * query. It never runs EXPLAIN, inspects a schema, or starts another request.
 */
export function buildSlowQueryAdvisory(
  executionTimeMs: number | undefined,
  options: SlowQueryAdvisoryOptions
): PerformanceAdvisory | undefined {
  const thresholdMs = slowQueryThresholdFor(options)
  if (thresholdMs === 0 || executionTimeMs === undefined || executionTimeMs < thresholdMs) {
    return undefined
  }

  return {
    code: 'SLOW_QUERY',
    executionTimeMs,
    thresholdMs,
    recommendation: recommendationFor(options.system),
  }
}

/**
 * Adds an advisory to an already-completed result. This deliberately does not
 * cause a second database interaction, so it is safe on the normal query path.
 */
export function attachSlowQueryAdvisory<T>(
  result: QueryResult<T>,
  options: SlowQueryAdvisoryOptions
): QueryResult<T> {
  const advisory = buildSlowQueryAdvisory(result.executionTimeMs, options)
  if (!advisory) return result

  return {
    ...result,
    metadata: {
      statement: result.metadata?.statement ?? 'UNKNOWN',
      ...result.metadata,
      performanceAdvisory: advisory,
    },
  }
}
