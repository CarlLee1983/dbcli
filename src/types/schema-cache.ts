/**
 * Schema Cache System - Type Definitions
 *
 * 支援分層加載和 LRU 快取的型別定義
 * Supports layered loading and LRU caching
 */

/**
 * Schema 全局索引 - 記錄所有表的存儲位置和元數據
 * Metadata for all tables: location (hot/cold), file path, size estimates
 */
export interface SchemaIndex {
  // 表名 → 存儲位置對應
  tables: Record<
    string,
    {
      location: 'hot' | 'cold'
      file: string
      estimatedSize: number
      lastModified: string
    }
  >
  // 熱點表列表（前 20% 常用表）
  hotTables: string[]
  // 索引元數據
  metadata: {
    version: string
    lastRefreshed: string
    totalTables: number
  }
}

/**
 * 快取統計資訊 - 用於監控和性能追蹤
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
 * 分層加載選項 - 配置快取和加載行為
 * Loader configuration options for cache and loading behavior
 */
export interface LoaderOptions {
  maxCacheItems?: number
  maxCacheSize?: number
  hotTableThreshold?: number
  enableStreaming?: boolean
  streamingTimeout?: number
}

/**
 * 表 Schema 參考 - 用於索引中的表描述
 * Reference to a table schema in the index
 */
export interface TableSchemaRef {
  tableName: string
  location: 'hot' | 'cold'
  file: string
  estimatedSize: number
}
