/**
 * Database adapters public API
 * Single source of truth for all adapter exports
 */

// Re-export types from types.ts
export type {
  ConnectionOptions,
  ColumnSchema,
  TableSchema,
  DatabaseAdapter,
  QueryableAdapter,
  ExecutionResult,
  DatabaseSystem,
  SqlDatabaseSystem,
  QueryableDatabaseSystem,
  SqlConnectionOptions,
  QueryableConnectionOptions,
} from './types'
export { ConnectionError } from './types'

// Re-export capability registry from capabilities.ts
export type {
  CapabilityStatus,
  CommandCapability,
  CommandCapabilityKey,
  EngineCapabilities,
  SideEffectTier,
} from './capabilities'
export {
  COMMAND_CAPABILITY_KEYS,
  ENGINE_CAPABILITIES,
  getEngineCapabilities,
  getEngineCapability,
  supportsCapability,
} from './capabilities'

// Re-export factory from factory.ts
export { AdapterFactory } from './factory'

// Re-export error mapper from error-mapper.ts
export { mapError } from './error-mapper'

// Re-export MongoDB adapter for direct use in commands
export { MongoDBAdapter } from './mongodb-adapter'
export { RedisAdapter } from './redis-adapter'
export { ElasticsearchAdapter } from './elasticsearch-adapter'
