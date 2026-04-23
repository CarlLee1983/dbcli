/**
 * Schema Cache Manager - LRU Memory Cache Management
 *
 * Implements a two-tier caching strategy:
 * 1. Hot tables in memory (< 1ms lookup)
 * 2. Cold tables loaded on-demand and cached (10-50ms)
 */

import { LRUCache } from 'lru-cache'
import type { SchemaIndex, CacheStats } from '@/types/schema-cache'
import type { TableSchema, ColumnSchema } from '@/adapters/types'
import { join } from 'path'
import { resolveSchemaPath } from '@/utils/schema-path'

/**
 * Schema Cache Manager
 * Manages hot/cold table schema storage with LRU eviction policy
 */
export class SchemaCacheManager {
  private cache: LRUCache<string, TableSchema>
  private index: SchemaIndex | null = null
  private hotSchemas: Map<string, TableSchema> = new Map()
  private dbcliPath: string
  /** Root for index.json, hot-schemas.json, cold/ (V2: per-connection subfolder) */
  private schemaRoot: string
  private maxItems: number
  private maxSize: number

  /**
   * Constructor
   * @param dbcliPath Path to .dbcli directory
   * @param options Cache configuration (optional `connectionName` for V2 isolation)
   */
  constructor(
    dbcliPath: string,
    options?: {
      maxCacheItems?: number
      maxCacheSize?: number
      connectionName?: string
    }
  ) {
    this.dbcliPath = dbcliPath
    this.schemaRoot = resolveSchemaPath(dbcliPath, options?.connectionName)
    this.maxItems = options?.maxCacheItems || 100
    this.maxSize = options?.maxCacheSize || 52428800 // 50MB

    // LRU Cache: O(1) lookup and eviction
    // sizeCalculation: estimate size by JSON serialization length
    this.cache = new LRUCache<string, TableSchema>({
      max: this.maxItems,
      maxSize: this.maxSize,
      sizeCalculation: (schema) => JSON.stringify(schema).length,
      allowStale: false,
      updateAgeOnGet: true,
      updateAgeOnHas: false,
    })
  }

  /**
   * Initialize: Load index and hot schemas
   *
   * Performance: < 10ms for typical cases (hot-schemas < 1MB)
   * Graceful degradation: If files missing, continues with empty cache
   */
  async initialize(): Promise<void> {
    try {
      // Load index from schemas root (V1: .dbcli/schemas/, V2: .dbcli/schemas/<name>/)
      const indexPath = join(this.schemaRoot, 'index.json')
      const indexFile = Bun.file(indexPath)
      if (await indexFile.exists()) {
        const indexContent = await indexFile.text()
        this.index = JSON.parse(indexContent)
      }

      const hotPath = join(this.schemaRoot, 'hot-schemas.json')
      const hotFile = Bun.file(hotPath)
      if (await hotFile.exists()) {
        const hotContent = await hotFile.text()
        const hotData = JSON.parse(hotContent)

        // Populate hot schemas map and cache
        const schemasObj = hotData.schemas || hotData
        for (const [tableName, schema] of Object.entries(schemasObj)) {
          const tableSchema = schema as TableSchema
          this.hotSchemas.set(tableName, tableSchema)
          this.cache.set(tableName, tableSchema)
        }
      }
    } catch (error) {
      // Graceful degradation: log warning but don't throw
      console.error('Failed to load schema index/hot-schemas:', error)
      this.index = null
    }
  }

  /**
   * Get table schema - Three-tier lookup strategy
   *
   * 1. Hot schemas (< 1ms) - in-memory map lookup
   * 2. LRU cache (< 5ms) - in-memory cache hit
   * 3. Cold load (10-50ms) - from file, then cache
   *
   * @param tableName Name of table to retrieve
   * @returns TableSchema or null if not found
   */
  async getTableSchema(tableName: string): Promise<TableSchema | null> {
    // Tier 1: Hot table lookup (fastest, < 1ms)
    if (this.hotSchemas.has(tableName)) {
      return this.hotSchemas.get(tableName)!
    }

    // Tier 2: LRU cache lookup (medium, < 5ms)
    const cached = this.cache.get(tableName)
    if (cached) {
      return cached
    }

    // Tier 3: Cold table load from file
    // Without index, cannot locate cold table
    if (!this.index) {
      return null
    }

    const tableInfo = this.index.tables[tableName]
    if (!tableInfo) {
      return null
    }

    try {
      // Load from cold storage file
      const filePath = join(this.schemaRoot, tableInfo.file)
      const file = Bun.file(filePath)

      if (!(await file.exists())) {
        console.error(`Cold table file not found: ${tableInfo.file} for table ${tableName}`)
        return null
      }

      const content = await file.text()
      const data = JSON.parse(content)
      const schema = data.schemas?.[tableName] || data[tableName]

      if (schema) {
        // Cache for next access
        this.cache.set(tableName, schema)
      }

      return schema || null
    } catch (error) {
      console.error(`Failed to load cold schema for table ${tableName}:`, error)
      return null
    }
  }

  /**
   * Find fields by name across hot tables
   *
   * Performance: < 1ms for typical field searches (O(n) over hot tables only)
   * Note: Cold tables not searched for efficiency
   *
   * @param fieldName Column name to search for
   * @returns Array of { table, column } matches
   */
  async findFieldsByName(
    fieldName: string
  ): Promise<Array<{ table: string; column: ColumnSchema }>> {
    const results: Array<{ table: string; column: ColumnSchema }> = []

    // Search only hot schemas (cold tables too many to iterate)
    for (const [tableName, schema] of this.hotSchemas.entries()) {
      const column = schema.columns.find((c) => c.name === fieldName)
      if (column) {
        results.push({ table: tableName, column })
      }
    }

    return results
  }

  /**
   * Get cache statistics
   *
   * @returns Cache stats including hit rate and capacity
   */
  /**
   * Remove a table from all cache tiers (hot + LRU)
   * Used after DROP TABLE to keep cache consistent
   */
  invalidateTable(tableName: string): void {
    this.hotSchemas.delete(tableName)
    this.cache.delete(tableName)
  }

  /**
   * Insert or update a table schema in cache
   * Used after CREATE TABLE or ALTER TABLE to keep cache consistent
   */
  refreshTable(tableName: string, schema: TableSchema): void {
    this.hotSchemas.set(tableName, schema)
    this.cache.set(tableName, schema)
  }

  getStats(): CacheStats {
    const cacheSize = this.cache.calculatedSize || 0
    const cacheHitRate =
      this.cache.max && this.cache.max > 0
        ? Math.round((this.cache.size / this.cache.max) * 100)
        : 0

    return {
      hotTables: this.hotSchemas.size,
      cachedTables: this.cache.size,
      cacheSize,
      cacheHitRate: `${cacheHitRate}%`,
      maxItems: this.maxItems,
      maxSize: this.maxSize,
    }
  }
}
