/**
 * Schema Index Builder - Index Generation and Management
 *
 * Builds and manages fast lookup indices:
 * 1. Quickly locate table storage location (hot/cold)
 * 2. Calculate hot tables (sorted by size)
 * 3. Idempotency when rebuilding the index
 */

import type { SchemaIndex } from '@/types/schema-cache'
import type { DbcliConfig, TableSchema } from '@/types'
import { join } from 'path'
import { resolveSchemaPath } from '@/utils/schema-path'

/**
 * Schema Index Builder
 * Builds and persists schema indices for fast table lookup
 */
export class SchemaIndexBuilder {
  /**
   * Load existing index from .dbcli/schemas/index.json
   *
   * Performance: < 10ms for typical index files
   *
   * @param dbcliPath Path to .dbcli directory
   * @returns Parsed SchemaIndex or null if file doesn't exist
   */
  static async loadIndex(
    dbcliPath: string,
    connectionName?: string
  ): Promise<SchemaIndex | null> {
    try {
      const indexPath = join(resolveSchemaPath(dbcliPath, connectionName), 'index.json')
      const file = Bun.file(indexPath)

      if (!(await file.exists())) {
        return null
      }

      const content = await file.text()
      return JSON.parse(content) as SchemaIndex
    } catch (error) {
      console.error('Failed to load schema index:', error)
      return null
    }
  }

  /**
   * Build index from config
   *
   * Strategy: Classify hot/cold tables by schema file size
   * - Hot tables: Top hotTableThreshold% (default 20%)
   * - Cold tables: Remaining
   *
   * Rationale: File size ∝ field count ∝ query complexity ∝ usage frequency
   *
   * @param config DbcliConfig with schema definitions
   * @param options Builder options (hotTableThreshold)
   * @returns Complete SchemaIndex object
   */
  static async buildIndex(
    config: DbcliConfig,
    options?: { hotTableThreshold?: number }
  ): Promise<SchemaIndex> {
    const hotTableThreshold = options?.hotTableThreshold || 20
    const schema = config.schema || {}

    // Calculate estimated size for each table
    const tableEntries = Object.entries(schema).map(([tableName, tableData]) => {
      const size = JSON.stringify(tableData).length
      return { tableName, size, data: tableData }
    })

    // Sort by size descending (largest = most complex = hottest)
    tableEntries.sort((a, b) => b.size - a.size)

    // Determine hot table count
    const hotCount = Math.max(1, Math.ceil((tableEntries.length * hotTableThreshold) / 100))
    const hotTableNames = tableEntries.slice(0, hotCount).map((e) => e.tableName)

    // Build index
    const index: SchemaIndex = {
      tables: {},
      hotTables: hotTableNames,
      metadata: {
        version: '1.0',
        lastRefreshed: new Date().toISOString(),
        totalTables: tableEntries.length,
      },
    }

    // Populate table entries
    for (const { tableName, size } of tableEntries) {
      const location = hotTableNames.includes(tableName) ? 'hot' : 'cold'
      const file =
        location === 'hot' ? 'hot-schemas.json' : `cold/${this.getFileForTable(tableName)}`

      index.tables[tableName] = {
        location,
        file,
        estimatedSize: size,
        lastModified: new Date().toISOString(),
      }
    }

    return index
  }

  /**
   * Save index to .dbcli/schemas/index.json
   *
   * Creates directory structure if needed
   * Formats output as readable JSON
   *
   * @param dbcliPath Path to .dbcli directory
   * @param index SchemaIndex to persist
   */
  static async saveIndex(
    dbcliPath: string,
    index: SchemaIndex,
    connectionName?: string
  ): Promise<void> {
    try {
      const schemasDir = resolveSchemaPath(dbcliPath, connectionName)
      await this.ensureDir(schemasDir)

      const indexPath = join(schemasDir, 'index.json')
      const indexFile = Bun.file(indexPath)
      await indexFile.write(JSON.stringify(index, null, 2))
    } catch (error) {
      throw new Error(`Failed to save schema index: ${error}`)
    }
  }

  /**
   * Calculate file mapping from index
   *
   * Reverse lookup: Which tables belong to which files
   *
   * @param index SchemaIndex
   * @returns Mapping of hot/cold files to table names
   */
  static calculateFileMapping(
    index: SchemaIndex
  ): Record<'hot' | 'cold', Array<{ table: string; file: string }>> {
    const mapping: Record<'hot' | 'cold', Array<{ table: string; file: string }>> = {
      hot: [],
      cold: [],
    }

    for (const [tableName, tableInfo] of Object.entries(index.tables)) {
      mapping[tableInfo.location].push({
        table: tableName,
        file: tableInfo.file,
      })
    }

    return mapping
  }

  /**
   * Ensure directory exists
   * @private
   */
  private static async ensureDir(dirPath: string): Promise<void> {
    try {
      const dir = Bun.file(dirPath)
      if (!(await dir.exists())) {
        // Use mkdir -p via shell
        const proc = Bun.spawn(['mkdir', '-p', dirPath])
        const exitCode = await proc.exited
        if (exitCode !== 0) {
          throw new Error(`mkdir failed with code ${exitCode}`)
        }
      }
    } catch (error) {
      throw new Error(`Failed to ensure directory ${dirPath}: ${error}`)
    }
  }

  /**
   * Get appropriate file name for cold table
   * @private
   *
   * Strategy: Group by frequency
   * - Infrequent tables: cold/infrequent.json
   * - Legacy/old tables: cold/legacy.json (can be further subdivided)
   */
  private static getFileForTable(tableName: string): string {
    // Simple heuristic: tables starting with 'old_', 'legacy_', etc. go to legacy.json
    if (/^(old_|legacy_|archive_)/.test(tableName)) {
      return 'legacy.json'
    }
    return 'infrequent.json'
  }
}
