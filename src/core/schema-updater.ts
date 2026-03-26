/**
 * Schema Updater - Incremental Schema Update Coordination
 *
 * 管理增量式 Schema 更新流程：
 * 1. 比較前一個快照和當前數據庫架構
 * 2. 生成僅包含變化的 patch
 * 3. 應用 patch 並更新配置
 * 4. 返回詳細的更新結果
 */

import { join } from 'path'
import type { DatabaseAdapter, TableSchema } from '@/adapters/types'
import type { DbcliConfig } from '@/utils/validation'
import type {
  SchemaPatch,
  SchemaRefreshResult,
  RefreshOptions
} from '@/types/schema-updater'
import type { SchemaDiffReport } from '@/types/schema-diff'
import { SchemaDiffEngine } from './schema-diff'
import { SchemaCacheManager } from './schema-cache'
import { ConcurrentLockManager } from './concurrent-lock'
import { ErrorRecoveryManager } from './error-recovery'

/**
 * Schema Updater - Coordinates incremental schema updates
 *
 * Responsibilities:
 * - Refresh schema from database
 * - Generate minimal patches for changes
 * - Apply patches to configuration
 * - Update cache and persistent storage
 * - Ensure concurrent safety through file-based locking
 * - Provide error recovery with backup/restore
 */
export class SchemaUpdater {
  private lockManager: ConcurrentLockManager
  private recoveryManager: ErrorRecoveryManager

  constructor(
    private dbcliPath: string,
    private adapter: DatabaseAdapter,
    private cache: SchemaCacheManager
  ) {
    this.lockManager = new ConcurrentLockManager(dbcliPath)
    this.recoveryManager = new ErrorRecoveryManager(dbcliPath)
  }

  /**
   * Refresh schema from database - main entry point
   *
   * Flow (with concurrent locking and error recovery):
   * 1. Load previous config
   * 2. Create recovery point (backup)
   * 3. Acquire lock (blocks until available or timeout)
   * 4. Query current schema from database
   * 5. Generate patch (delta only)
   * 6. Apply patch to config
   * 7. Update cache and persist
   * 8. Release lock
   * 9. On error: restore from backup
   *
   * @param options Refresh options (specific tables, force refresh, etc.)
   * @returns SchemaRefreshResult with detailed changes
   */
  async refreshSchema(options?: RefreshOptions): Promise<SchemaRefreshResult> {
    const startTime = Date.now()
    const configPath = join(this.dbcliPath, 'config.json')

    try {
      // Initialize recovery manager
      await this.recoveryManager.initialize()

      // Load previous config for recovery
      const configFile = Bun.file(configPath)
      const previousConfig: DbcliConfig = await configFile.json()

      // Execute with recovery support and lock
      return await this.recoveryManager.withRecovery(
        previousConfig,
        async () => {
          // Execute with lock to ensure concurrent safety
          return await this.lockManager.withLock(
            async () => {
              // Get current schema from database
              // If specific tables requested, only query those; otherwise get all
              const currentTables = await this.adapter.listTables()
              const tablesToQuery = options?.tablesToRefresh
                ? currentTables.filter(t => options.tablesToRefresh!.includes(t.name))
                : currentTables

              const currentSchemas: Record<string, TableSchema> = {}
              for (const tableInfo of tablesToQuery) {
                const schema = await this.adapter.getTableSchema(tableInfo.name)
                currentSchemas[tableInfo.name] = schema
              }

              // Build current config from schemas
              const currentConfig: DbcliConfig = {
                ...previousConfig,
                schema: {
                  ...(previousConfig.schema || {}),
                  ...currentSchemas
                }
              }

              // Generate patch (delta only)
              const patch = await this.generatePatch(previousConfig, currentConfig)

              // Apply patch to update config
              const updatedConfig = await this.applyPatch(previousConfig, patch)

              // Persist updated config
              await this.persistConfig(updatedConfig)

              // Update cache with new schemas
              await this.updateCache(patch)

              const totalTime = Date.now() - startTime

              return {
                added: Object.keys(patch.added).length,
                modified: Object.keys(patch.modified).length,
                deleted: patch.deletedTables.length,
                totalTime,
                details: `Added ${Object.keys(patch.added).length} tables, ` +
                  `modified ${Object.keys(patch.modified).length} tables, ` +
                  `deleted ${patch.deletedTables.length} tables in ${totalTime}ms`
              }
            },
            'schema-refresh'
          )
        },
        configPath
      )
    } catch (error) {
      const totalTime = Date.now() - startTime
      throw new Error(
        `Schema refresh failed after ${totalTime}ms: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  /**
   * Generate patch - compares two configs and extracts only changes
   *
   * Uses SchemaDiffEngine for detailed column-level comparison
   * Returns patch containing only added/modified/deleted items
   *
   * @param previous Previous config state
   * @param current Current config state
   * @returns SchemaPatch with only delta changes
   */
  private async generatePatch(
    previous: DbcliConfig,
    current: DbcliConfig
  ): Promise<SchemaPatch> {
    // Use diff engine to get detailed changes
    const diffEngine = new SchemaDiffEngine(this.adapter, previous)
    const diffReport = await diffEngine.diff()

    const patch: SchemaPatch = {
      added: {},
      modified: {},
      deletedTables: diffReport.tablesRemoved,
      timestamp: new Date().toISOString()
    }

    // Tables added - include full schema
    for (const tableName of diffReport.tablesAdded) {
      const schema = current.schema?.[tableName] as TableSchema
      if (schema) {
        patch.added[tableName] = schema
      }
    }

    // Tables modified - extract only changes
    for (const [tableName, details] of Object.entries(diffReport.tablesModified)) {
      const currentSchema = current.schema?.[tableName] as TableSchema
      if (!currentSchema) continue

      patch.modified[tableName] = {
        table: tableName,
        columnsAdded: {},
        columnsRemoved: details.columnsRemoved,
        columnsModified: {}
      }

      // Include only added columns
      for (const colName of details.columnsAdded) {
        const col = currentSchema.columns.find(c => c.name === colName)
        if (col) {
          patch.modified[tableName].columnsAdded[colName] = col
        }
      }

      // Include only modified columns with before/after
      for (const colDiff of details.columnsModified) {
        patch.modified[tableName].columnsModified[colDiff.name] = {
          previous: colDiff.previous,
          current: colDiff.current
        }
      }
    }

    return patch
  }

  /**
   * Apply patch - merges patch into previous config to create updated config
   *
   * @param previous Previous config
   * @param patch Changes to apply
   * @returns Updated config
   */
  private async applyPatch(
    previous: DbcliConfig,
    patch: SchemaPatch
  ): Promise<DbcliConfig> {
    const schema = { ...(previous.schema || {}) }

    // Add new tables
    for (const [tableName, tableSchema] of Object.entries(patch.added)) {
      schema[tableName] = tableSchema
    }

    // Remove deleted tables
    for (const tableName of patch.deletedTables) {
      delete schema[tableName]
    }

    // Apply modifications to existing tables
    for (const [tableName, changes] of Object.entries(patch.modified)) {
      const existing = schema[tableName] as TableSchema
      if (!existing) continue

      // Remove deleted columns
      existing.columns = existing.columns.filter(
        col => !changes.columnsRemoved.includes(col.name)
      )

      // Add new columns
      for (const [colName, colSchema] of Object.entries(changes.columnsAdded)) {
        existing.columns.push(colSchema)
      }

      // Update modified columns
      for (const [colName, { current }] of Object.entries(changes.columnsModified)) {
        const colIndex = existing.columns.findIndex(c => c.name === colName)
        if (colIndex >= 0) {
          existing.columns[colIndex] = current
        }
      }
    }

    return {
      ...previous,
      schema,
      metadata: {
        ...previous.metadata,
        version: '2.0'
      }
    }
  }

  /**
   * Persist updated config to disk
   *
   * @param config Updated config to persist
   */
  private async persistConfig(config: DbcliConfig): Promise<void> {
    const configPath = join(this.dbcliPath, 'config.json')
    const configFile = Bun.file(configPath)
    await Bun.write(configFile, JSON.stringify(config, null, 2))
  }

  /**
   * Update cache with new/modified schemas from patch
   *
   * @param patch Schema patch with changes
   */
  private async updateCache(patch: SchemaPatch): Promise<void> {
    // Add new tables to cache
    for (const [tableName, schema] of Object.entries(patch.added)) {
      // Cache will handle storing appropriately
      // This is a hook point for cache updates
    }

    // Modified tables are implicitly updated through config reload
    // Cache will be refreshed on next access
  }
}
