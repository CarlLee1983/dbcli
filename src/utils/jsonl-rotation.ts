/**
 * Shared append-only JSONL rotation primitives.
 *
 * Neutral utility reused by both the audit logger (src/core/audit) and the
 * observability proxy (src/proxy) so neither feature depends on the other.
 *
 * Model: keep exactly one rolling segment. When the next line would meet or
 * exceed either cap, rename current -> previous (overwriting previous) and
 * start a fresh current file. Rotation is a single OS-level rename (atomic
 * within one filesystem); no flush-to-disk or tmp+rename for the .jsonl itself.
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
 * Pure predicate. Returns true if writing the next line would meet OR exceed
 * either cap.
 * - Byte cap: (current + next line length) >= maxBytes
 * - Entry cap: (current + 1) > maxEntries
 * - OR relationship
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
 * (single rolling segment).
 *
 * Best-effort: a missing source file resolves silently. `rename` on POSIX is
 * atomic within the same filesystem and overwrites the target if it exists.
 */
export async function rotate(currentPath: string, previousPath: string): Promise<void> {
  try {
    await rename(currentPath, previousPath)
  } catch {
    // If currentPath doesn't exist, there's nothing to rotate. Treat as no-op.
  }
}
