/**
 * Schema Layered Loader - Layered Loading and Initialization
 *
 * Layered loading logic at startup — the most critical module,
 * directly affecting startup performance and overall response time
 */

import { SchemaCacheManager } from './schema-cache'
import { SchemaIndexBuilder } from './schema-index'
import type { SchemaIndex, LoaderOptions } from '@/types/schema-cache'
import type { TableSchema } from '@/adapters/types'
import { join } from 'path'

/**
 * Schema Layered Loader
 * Manages hierarchical schema loading: hot on startup, cold on-demand
 */
export class SchemaLayeredLoader {
  private dbcliPath: string
  private options: Required<LoaderOptions>
  private cache: SchemaCacheManager | null = null
  private index: SchemaIndex | null = null
  private loadTime: number = 0

  /**
   * Constructor
   * @param dbcliPath Path to .dbcli directory
   * @param options Loader configuration
   */
  constructor(dbcliPath: string, options?: LoaderOptions) {
    this.dbcliPath = dbcliPath
    this.options = {
      maxCacheItems: options?.maxCacheItems || 100,
      maxCacheSize: options?.maxCacheSize || 52428800, // 50MB
      hotTableThreshold: options?.hotTableThreshold || 20,
      enableStreaming: options?.enableStreaming || false,
      streamingTimeout: options?.streamingTimeout || 30000,
    }
  }

  /**
   * Initialize: Main entry point for startup
   *
   * Performance Target: < 100ms (including file I/O, JSON parsing, hot-table preload)
   * For 100+ tables: Should still meet target through layered approach
   *
   * Flow:
   * 1. Load index (schemas/index.json)
   * 2. Initialize cache manager
   * 3. Preload hot tables
   * 4. Return cache, index, and timing
   *
   * @returns Initialization result with cache, index, and load time
   */
  async initialize(): Promise<{
    cache: SchemaCacheManager
    index: SchemaIndex | null
    loadTime: number
  }> {
    const startTime = performance.now()

    try {
      // Ensure directory structure exists
      await this.ensureDirectories()

      // Load index
      this.index = await SchemaIndexBuilder.loadIndex(this.dbcliPath)

      // Initialize cache manager with options
      this.cache = new SchemaCacheManager(this.dbcliPath, {
        maxCacheItems: this.options.maxCacheItems,
        maxCacheSize: this.options.maxCacheSize,
      })

      // Preload hot schemas and index
      await this.cache.initialize()

      this.loadTime = performance.now() - startTime

      // Log performance for monitoring
      if (this.loadTime > 50) {
        console.warn(
          `Schema initialization took ${this.loadTime.toFixed(2)}ms (target: < 100ms)`
        )
      }

      return {
        cache: this.cache,
        index: this.index,
        loadTime: this.loadTime,
      }
    } catch (error) {
      console.error('Failed to initialize schema loader:', error)
      this.loadTime = performance.now() - startTime

      // Graceful degradation: return empty cache even on failure
      if (!this.cache) {
        this.cache = new SchemaCacheManager(this.dbcliPath, {
          maxCacheItems: this.options.maxCacheItems,
          maxCacheSize: this.options.maxCacheSize,
        })
      }

      return {
        cache: this.cache,
        index: this.index,
        loadTime: this.loadTime,
      }
    }
  }

  /**
   * Load cold table on-demand
   *
   * Called when first querying a table not in hot cache
   *
   * @param tableName Name of cold table to load
   * @param cache SchemaCacheManager instance
   * @returns TableSchema or null if not found
   */
  async loadColdTable(
    tableName: string,
    cache: SchemaCacheManager
  ): Promise<TableSchema | null> {
    try {
      return await cache.getTableSchema(tableName)
    } catch (error) {
      console.error(`Failed to load cold table ${tableName}:`, error)
      return null
    }
  }

  /**
   * Ensure required directories exist
   *
   * Creates:
   * - .dbcli/schemas/
   * - .dbcli/schemas/cold/
   *
   * @private
   */
  private async ensureDirectories(): Promise<void> {
    const dirs = [
      join(this.dbcliPath, 'schemas'),
      join(this.dbcliPath, 'schemas', 'cold'),
    ]

    for (const dir of dirs) {
      try {
        const dirFile = Bun.file(dir)
        if (!(await dirFile.exists())) {
          const proc = Bun.spawn(['mkdir', '-p', dir])
          const exitCode = await proc.exited
          if (exitCode !== 0) {
            console.error(`Failed to create directory: ${dir}`)
          }
        }
      } catch (error) {
        console.error(`Error ensuring directory ${dir}:`, error)
      }
    }
  }

  /**
   * Get performance benchmark data
   *
   * Used for monitoring and tuning
   *
   * @returns Benchmark metrics
   */
  getBenchmark(): {
    initTime: number
    hotTables: number
    totalTables: number
    estimatedSize: number
  } {
    if (!this.cache || !this.index) {
      return {
        initTime: this.loadTime,
        hotTables: 0,
        totalTables: 0,
        estimatedSize: 0,
      }
    }

    // Calculate total estimated size from index
    const estimatedSize = Object.values(this.index.tables).reduce(
      (sum, table) => sum + (table.estimatedSize || 0),
      0
    )

    return {
      initTime: this.loadTime,
      hotTables: this.index.hotTables.length,
      totalTables: this.index.metadata.totalTables,
      estimatedSize,
    }
  }
}
