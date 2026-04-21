/**
 * Database adapters public API
 * Single source of truth for all adapter exports
 */

// Re-export types from types.ts
export type { ConnectionOptions, ColumnSchema, TableSchema, DatabaseAdapter, QueryableAdapter } from './types'
export { ConnectionError } from './types'

// Re-export factory from factory.ts
export { AdapterFactory } from './factory'

// Re-export error mapper from error-mapper.ts
export { mapError } from './error-mapper'

// Re-export MongoDB adapter for direct use in commands
export { MongoDBAdapter } from './mongodb-adapter'
