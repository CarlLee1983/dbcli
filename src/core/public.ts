/**
 * Public API surface for external consumers (e.g. dbcli-gui sidecar).
 *
 * This is the ONLY contract exported via the `@carllee1983/dbcli/core` subpath.
 * Keep it intentional and stable — internal `src/core/index.ts` is NOT the
 * external contract and may change freely.
 */

// ── Engine ───────────────────────────────────────────────
// `AdapterFactory` 曾經在這裡。它回傳的 adapter 的 `request()` / `execute()`
// 是 public，所以拿到它就等於拿到一條不經 permission、不經 blacklist、
// 不寫 audit 的路徑——CLI 的每一道門都繞過去了。`QueryExecutor` 與
// `DataExecutor` 才是這個表面該給的東西：它們自己帶著 gate。
//
// 未來要重新開放建構 adapter 的能力時，開放的必須是包好 gate 的 façade，
// 不是工廠本身。
export { ConnectionError } from '@/adapters'
export { QueryExecutor } from '@/core/query-executor'
export { DataExecutor } from '@/core/data-executor'
export { SchemaLayeredLoader } from '@/core/schema-loader'

// ── Config (.dbcli resolution) ───────────────────────────
export {
  resolveConnection,
  listConnections,
  readV2Config,
  writeV2Config,
  loadConnectionEnv,
  detectConfigVersion,
} from '@/core/config-v2'

// ── Config write (連線管理:GUI/CLI 共用) ──
export {
  envVarNameFor,
  upsertConnection,
  removeConnection,
  setDefaultConnection,
  migrateV1ToV2,
} from '@/core/config-v2-mutations'
export type { ConnectionInput, SqlSystem } from '@/core/config-v2-mutations'
export { setConnectionPassword, resolvePasswordTarget } from '@/core/connection-credential'
export type { PasswordTarget } from '@/core/connection-credential'
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

export {
  resolveConfigStoragePath,
  writeProjectBinding,
  getProjectStoragePath,
  getDbcliConfigHome,
  getGlobalConfigPath,
  isGlobalConfigPath,
} from '@/core/config-binding'
export type { DbcliConfigV2 } from '@/utils/validation'

// ── Capability contract (agent-facing discovery) ─────────
// Pure data and pure functions: no adapter, no filesystem, no environment.
// It lives here rather than in `agent-core` because the catalog names engines
// and `check-agent-core-purity.ts` forbids that word there — see ADR-0022.
export {
  CAPABILITY_CONTRACT_SCHEMA_VERSION,
  CAPABILITIES,
  buildCapabilityCatalog,
  findCapability,
  listCapabilityIds,
  checkCapabilities,
  parseRequirements,
  parseCapabilityCatalog,
  parseCapabilityCheckReport,
  CapabilityRequirementError,
  CapabilityContractError,
} from '@/core/capabilities'
export type {
  Capability,
  CapabilityCatalog,
  CapabilityRisk,
  CapabilityCheckContext,
  CapabilityContextFailure,
  CapabilityCheckReport,
  CapabilityCheckResultEntry,
  CapabilityCheckStatus,
  CapabilityUnavailableReason,
} from '@/core/capabilities'

// ── Operation Envelope (agent-facing invocation result) ─
export {
  OPERATION_ENVELOPE_SCHEMA_VERSION,
  parseOperationEnvelope,
} from '@/core/operation-envelope'
export type {
  OperationEnvelope,
  OperationEnvelopeCapabilitiesCheckData,
  OperationEnvelopeCapabilityResult,
  OperationEnvelopeContext,
  OperationEnvelopeError,
  OperationEnvelopeEvidenceKind,
  OperationEnvelopeEvidenceReference,
  OperationEnvelopeParseResult,
  OperationEnvelopeStatus,
  OperationEnvelopeWarning,
} from '@/core/operation-envelope'

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
// MutationConfirmer and its request come with the other two deliberately:
// DataExecutionOptions.confirm is now required for any unforced write — the
// executor throws rather than deciding on the caller's behalf — so an embedder
// that cannot name the callback's type cannot write one.
export type {
  DataExecutionResult,
  DataExecutionOptions,
  MutationConfirmer,
  MutationConfirmationRequest,
} from '@/types/data'
