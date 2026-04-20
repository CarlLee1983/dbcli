/**
 * Schema Cache System - Type Definitions
 *
 * Supports layered loading and LRU caching
 */

/**
 * Schema global index - records storage location and metadata for all tables
 * Metadata for all tables: location (hot/cold), file path, size estimates
 */
export interface SchemaIndex {
  // Table name → storage location mapping
  tables: Record<
    string,
    {
      location: 'hot' | 'cold'
      file: string
      estimatedSize: number
      lastModified: string
    }
  >
  // Hot table list (top 20% most-used tables)
  hotTables: string[]
  // Index metadata
  metadata: {
    version: string
    lastRefreshed: string
    totalTables: number
  }
}

/**
 * Cache statistics - for monitoring and performance tracking
 * Cache statistics for monitoring hit rates and capacity
 */
export interface CacheStats {
  hotTables: number
  cachedTables: number
  cacheSize: number
  cacheHitRate: string
  maxItems: number
  maxSize: number
}

/**
 * Layered loading options - configures cache and loading behavior
 * Loader configuration options for cache and loading behavior
 */
export interface LoaderOptions {
  maxCacheItems?: number
  maxCacheSize?: number
  hotTableThreshold?: number
  enableStreaming?: boolean
  streamingTimeout?: number
  /** V2 named connection — layered files under `.dbcli/schemas/<name>/` */
  connectionName?: string
}

/**
 * Table schema reference - used for table descriptions in the index
 * Reference to a table schema in the index
 */
export interface TableSchemaRef {
  tableName: string
  location: 'hot' | 'cold'
  file: string
  estimatedSize: number
}
