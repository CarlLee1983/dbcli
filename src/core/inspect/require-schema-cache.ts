import { SchemaCacheMissingError } from '@/core/recovery'
import type { SchemaCacheSection, SnapshotSystem } from './types'

const SQL_SYSTEMS: ReadonlyArray<SnapshotSystem> = ['postgresql', 'mysql', 'mariadb']

/**
 * Throws SchemaCacheMissingError when the active SQL connection has no usable
 * schema cache. No-ops on non-SQL engines and when disconnected (system === null).
 *
 * Used by `dbcli inspect --require-schema-cache` to give the recovery
 * classifier an end-to-end SCHEMA_CACHE_MISSING path without touching live
 * driver code.
 */
export function requireSchemaCacheOrThrow(
  section: SchemaCacheSection,
  system: SnapshotSystem | null | undefined
): void {
  if (!system) return
  if (!SQL_SYSTEMS.includes(system)) return
  if (section.available === true) return
  throw new SchemaCacheMissingError(
    `Schema cache unavailable for ${system} connection; run 'dbcli schema --refresh' to populate it.`
  )
}
