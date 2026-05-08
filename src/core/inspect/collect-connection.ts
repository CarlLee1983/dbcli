import type { DbcliConfig } from '@/types'
import type { ConnectionSection, SnapshotSystem } from './types'

export interface ConnectionCollectResult {
  system: SnapshotSystem | null
  section: ConnectionSection
}

/**
 * Pure: build the snapshot's connection section from an already-resolved DbcliConfig.
 * NEVER reads host/port/user/password; only emits system, name, database.
 */
export function collectConnection(
  config: DbcliConfig | null,
  connectionName?: string
): ConnectionCollectResult {
  if (!config?.connection) {
    return { system: null, section: { name: null, database: null, version: null } }
  }
  const system = config.connection.system as SnapshotSystem
  const databaseRaw = (config.connection as { database?: unknown }).database
  const database = typeof databaseRaw === 'string' && databaseRaw.length > 0 ? databaseRaw : null
  return {
    system,
    section: { name: connectionName ?? 'default', database, version: null },
  }
}
