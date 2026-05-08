import type { Permission } from '@/types'

/** Stable contract version for the InspectSnapshot JSON. Bump on breaking shape change. */
export const INSPECT_SCHEMA_VERSION = 1 as const

export type SnapshotSystem =
  | 'postgresql'
  | 'mysql'
  | 'mariadb'
  | 'mongodb'
  | 'redis'
  | 'elasticsearch'

export interface ConnectionSection {
  /** V2 named connection name; `'default'` for V1 file-mode; `null` when no config */
  name: string | null
  /** Database / namespace / index pattern (no creds) */
  database: string | null
  /** Server version string when cheap probe succeeded; `null` otherwise */
  version: string | null
}

export interface PermissionSection {
  level: Permission
  canWrite: boolean
  canDestruct: boolean
}

export interface BlacklistSection {
  tables: number
  columnRules: number
}

export type ObjectKind = 'tables' | 'collections' | 'keys' | 'indices'

export interface ObjectsSection {
  kind: ObjectKind
  count?: number
  sample?: string[]
  unavailable?: true
  reason?: string
}

export interface SchemaCacheSection {
  available: boolean
  stale?: boolean
  lastRefreshed?: string
  totalTables?: number
  unavailable?: true
  reason?: string
}

export interface SnippetIntentBucket {
  intent: string
  count: number
}

export interface SnippetsSection {
  count: number
  engines: string[]
  intents: SnippetIntentBucket[]
}

export interface InspectSnapshot {
  schemaVersion: typeof INSPECT_SCHEMA_VERSION
  system: SnapshotSystem | null
  connection: ConnectionSection
  permission: PermissionSection
  blacklist: BlacklistSection
  objects: ObjectsSection
  schemaCache: SchemaCacheSection
  snippets: SnippetsSection
  suggestedCommands: string[]
  warnings: string[]
}

export interface InspectOptions {
  /** Workspace root (cwd) */
  workspace: string
  /** Resolved `.dbcli` path */
  configPath: string
  /** Skip the connect+version+listTables network calls */
  noConnect?: boolean
  /** Trim sample arrays for `--brief` */
  brief?: boolean
  /** Hard timeout for the cheap version/object probe in ms (default 1500) */
  probeTimeoutMs?: number
}
