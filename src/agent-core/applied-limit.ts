export interface AppliedLimitMetadata {
  /** True only when the caller fetched and removed an additional row. */
  truncated: boolean
  /** User-facing row limit, never the internal lookahead size. */
  limitApplied: number
}

export interface AppliedLimitResult<T> {
  rows: T[]
  metadata: AppliedLimitMetadata
}

/** Trim a one-row lookahead without mutating the input. */
export function trimAppliedLimit<T>(rows: readonly T[], limit: number): AppliedLimitResult<T> {
  const truncated = rows.length > limit

  return {
    rows: truncated ? rows.slice(0, limit) : [...rows],
    metadata: { truncated, limitApplied: limit },
  }
}
