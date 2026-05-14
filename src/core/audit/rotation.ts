/**
 * Audit log rotation primitives.
 *
 * Decisions (see .planning/phases/21-audit-writer-foundation/21-CONTEXT.md):
 * - D-08: Single OS-level rename; no flush-to-disk syscall, no tmp+rename for the .jsonl itself.
 * - D-09: Rename current -> .1, overwriting any existing .1.
 * - D-10: Keep exactly one rolling segment.
 * - D-11: Thresholds passed in; defaults live in zod (Plan 21-01).
 */
import { rename } from 'node:fs/promises'

export interface RotationStats {
  currentSizeBytes: number
  currentEntryCount: number
}

export interface RotationThresholds {
  maxBytes: number
  maxEntries: number
}

/**
 * Pure predicate. Returns true if writing the next line would meet OR exceed either cap.
 * - Byte cap: (current + next line length) >= maxBytes
 * - Entry cap: (current + 1) > maxEntries
 * - OR relationship (D-11)
 */
export function shouldRotate(
  stats: RotationStats,
  thresholds: RotationThresholds,
  nextLineByteLength: number
): boolean {
  const bytesAfter = stats.currentSizeBytes + nextLineByteLength
  const entriesAfter = stats.currentEntryCount + 1
  return bytesAfter >= thresholds.maxBytes || entriesAfter > thresholds.maxEntries
}

/**
 * Rename current segment to previous. Overwrites previous if it exists
 * (D-10 single rolling segment).
 *
 * Best-effort: a missing source file resolves silently — audit must never
 * propagate errors upstream. `rename` on POSIX is atomic within the same
 * filesystem and overwrites the target if it exists.
 */
export async function rotate(currentPath: string, previousPath: string): Promise<void> {
  try {
    await rename(currentPath, previousPath)
  } catch {
    // If currentPath doesn't exist, there's nothing to rotate. Treat as no-op.
  }
}
