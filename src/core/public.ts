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
export type { Permission } from '@/types'
export type { DbcliConfig } from '@/utils/validation'
export type { QueryResult } from '@/types/query'
