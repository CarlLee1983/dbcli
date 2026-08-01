import type { AppliedLimitMetadata } from '@/types/query'

export interface AppliedLimitResult<T> {
  rows: T[]
  metadata: AppliedLimitMetadata
}

/**
 * Trim the one-row lookahead used by dbcli-owned limits.
 * The input array is never mutated.
 */
export function trimAppliedLimit<T>(rows: readonly T[], limit: number): AppliedLimitResult<T> {
  const truncated = rows.length > limit

  return {
    rows: truncated ? rows.slice(0, limit) : [...rows],
    metadata: {
      truncated,
      limitApplied: limit,
    },
  }
}
