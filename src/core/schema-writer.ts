/**
 * Schema Writer - Layered Schema Persistence
 *
 * Persists schema data into the layered storage format:
 * 1. index.json for fast lookup
 * 2. hot-schemas.json for frequently used tables
 * 3. cold/*.json for infrequent/legacy tables
 */

import { join } from 'path'
import { SchemaIndexBuilder } from './schema-index'
import { AtomicFileWriter } from './atomic-writer'
import { resolveSchemaPath } from '@/utils/schema-path'
import type { TableSchema } from '@/adapters/types'

/**
 * Schema Writer - Handles persisting schema data into layered storage
 */
export class SchemaWriter {
  private writer: AtomicFileWriter

  /**
   * Constructor
   * @param dbcliPath Path to .dbcli directory
   */
  constructor(private dbcliPath: string) {
    this.writer = new AtomicFileWriter()
  }

  /**
   * Save schema to layered storage
   *
   * @param schema Complete schema data map
   * @param connectionName Optional connection name for isolation (V2)
   */
  async save(schema: Record<string, TableSchema>, connectionName?: string): Promise<void> {
    const schemaRoot = resolveSchemaPath(this.dbcliPath, connectionName)

    // 1. Build Index using the existing builder
    // We wrap schema in a partial config object as expected by the builder
    const index = await SchemaIndexBuilder.buildIndex({ schema } as any)

    // 2. Save Index file
    await SchemaIndexBuilder.saveIndex(this.dbcliPath, index, connectionName)

    // 3. Calculate file mapping
    const mapping = SchemaIndexBuilder.calculateFileMapping(index)

    // 4. Persist Hot Schemas
    const hotSchemas: Record<string, TableSchema> = {}
    for (const item of mapping.hot) {
      hotSchemas[item.table] = schema[item.table]
    }
    await this.writer.writeJSON(join(schemaRoot, 'hot-schemas.json'), hotSchemas)

    // 5. Persist Cold Schemas (grouped by their respective files)
    const coldGroups: Record<string, Record<string, TableSchema>> = {}
    for (const item of mapping.cold) {
      if (!coldGroups[item.file]) {
        coldGroups[item.file] = {}
      }
      coldGroups[item.file][item.table] = schema[item.table]
    }

    // Ensure cold/ directory exists
    const coldDir = join(schemaRoot, 'cold')
    await this.ensureDir(coldDir)

    // Write each cold group file
    for (const [fileName, tables] of Object.entries(coldGroups)) {
      const filePath = join(schemaRoot, fileName)
      await this.writer.writeJSON(filePath, tables)
    }
  }

  /**
   * Clear all layered schema data for a connection
   *
   * @param connectionName Connection name
   */
  async clear(connectionName?: string): Promise<void> {
    const schemaRoot = resolveSchemaPath(this.dbcliPath, connectionName)
    try {
      const dir = Bun.file(schemaRoot)
      // Check if directory exists via stat since exists() returns false for dirs
      const s = await dir.stat()
      if (s.isDirectory()) {
        await Bun.spawn(['rm', '-rf', schemaRoot]).exited
      }
    } catch {
      // Ignore if directory doesn't exist
    }
  }

  /**
   * Ensure directory exists
   * @private
   */
  private async ensureDir(path: string): Promise<void> {
    const { mkdirSync } = await import('fs')
    try {
      mkdirSync(path, { recursive: true })
    } catch (error) {
      if ((error as any).code !== 'EEXIST') {
        throw new Error(`Error ensuring directory ${path}: ${error}`)
      }
    }
  }
}
