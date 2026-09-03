/**
 * The permission ladder, on its own.
 *
 * `permissionAtLeast` lived in `permission-guard.ts`, which pulls in the i18n
 * catalogue and the SQL analyser. Anything wanting only "is this level at least
 * that one?" — the capability contract, for instance — had the choice of
 * dragging that graph in or re-declaring the ranks, and a re-declared ladder is
 * a second authority that drifts the first time a tier is added.
 *
 * `permission-guard.ts` re-exports these, so its callers are unaffected.
 */

import type { Permission } from '@/types'

/** Higher rank = more powerful tier. */
export const PERMISSION_RANK: Readonly<Record<Permission, number>> = Object.freeze({
  'query-only': 1,
  'read-write': 2,
  'data-admin': 3,
  admin: 4,
})

export function permissionAtLeast(actual: Permission, required: Permission): boolean {
  return PERMISSION_RANK[actual] >= PERMISSION_RANK[required]
}
