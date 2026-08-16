/**
 * Audit log rotation primitives.
 *
 * The implementation is the shared, feature-neutral JSONL rotation utility in
 * `src/utils/jsonl-rotation.ts` (also used by the observability proxy). This
 * module re-exports it to preserve the audit-local import surface and the
 * decisions recorded here:
 * - D-08: Single OS-level rename; no flush-to-disk syscall, no tmp+rename for the .jsonl itself.
 * - D-09: Rename current -> .1, overwriting any existing .1.
 * - D-10: Keep exactly one rolling segment.
 * - D-11: Thresholds passed in; defaults live in zod (Plan 21-01).
 */
export {
  shouldRotate,
  rotate,
  type RotationStats,
  type RotationThresholds,
} from '@/utils/jsonl-rotation'
