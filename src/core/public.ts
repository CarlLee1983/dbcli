/**
 * Public API surface for external consumers (e.g. dbcli-gui sidecar).
 *
 * This is the ONLY contract exported via the `@carllee1983/dbcli/core` subpath.
 * Keep it intentional and stable — internal `src/core/index.ts` is NOT the
 * external contract and may change freely.
 */

// ── Engine ───────────────────────────────────────────────
export { AdapterFactory, ConnectionError } from '@/adapters'
export { QueryExecutor } from '@/core/query-executor'
export { SchemaLayeredLoader } from '@/core/schema-loader'

// ── Config (.dbcli resolution) ───────────────────────────
export {
  resolveConnection,
  listConnections,
  readV2Config,
  loadConnectionEnv,
  detectConfigVersion,
} from '@/core/config-v2'
export type { ResolvedConnection } from '@/core/config-v2'

// ── Config read (unified: binding-aware, v1/v2, {$env}-expanded) ──
import { configModule } from '@/core/config'
import type { DbcliConfig } from '@/utils/validation'

/**
 * Read and fully resolve a `.dbcli` project config: handles project-binding
 * indirection, v1/v2 formats, per-connection `.env` loading and `{$env}`
 * expansion. `path` is the `.dbcli` directory (or legacy file). Returns the
 * default config if none exists. Thin wrapper over the same entrypoint the
 * CLI commands use.
 */
export const readConfig = (path: string, connectionName?: string): Promise<DbcliConfig> =>
  configModule.read(path, connectionName)

export { resolveConfigStoragePath } from '@/core/config-binding'
export type { DbcliConfigV2 } from '@/utils/validation'

// ── Safety ───────────────────────────────────────────────
export { BlacklistManager } from '@/core/blacklist-manager'
export { BlacklistValidator, BlacklistError } from '@/core/blacklist-validator'

// ── Types ────────────────────────────────────────────────
export type {
  ConnectionOptions,
  DatabaseAdapter,
  DatabaseSystem,
  TableSchema,
  ColumnSchema,
  ExecutionResult,
} from '@/adapters'
export type { SqlConnectionOptions, QueryableConnectionOptions } from '@/adapters'
export type { Permission } from '@/types'
export type { DbcliConfig } from '@/utils/validation'
export type { QueryResult } from '@/types/query'
