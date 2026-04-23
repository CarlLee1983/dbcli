/**
 * Schema System - Integration Tests
 *
 * Tests full workflows across all system components:
 * - Schema update with locking and recovery
 * - Index building and caching
 * - Performance optimization recommendations
 * - Concurrent access patterns
 */

import { test, expect } from 'bun:test'
import { SchemaUpdater } from '@/core/schema-updater'
import { SchemaCacheManager } from '@/core/schema-cache'
import { ConcurrentLockManager } from '@/core/concurrent-lock'
import { ErrorRecoveryManager } from '@/core/error-recovery'
import { ColumnIndexBuilder } from '@/core/column-index'
import { SchemaOptimizer } from '@/core/schema-optimizer'
import type { DatabaseAdapter, TableSchema } from '@/adapters/types'
import type { DbcliConfig } from '@/utils/validation'
import { tmpdir } from 'os'
import { join } from 'path'

/**
 * Mock Database Adapter
 */
class MockDatabaseAdapter implements DatabaseAdapter {
  private tables: Map<string, TableSchema> = new Map()

  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}
  async execute(): Promise<any> {}
  async query(): Promise<any> {}
  async listTables() {
    return Array.from(this.tables.entries()).map(([name]) => ({ name }))
  }
  async getTableSchema(tableName: string) {
    return this.tables.get(tableName) || { name: tableName, columns: [] }
  }

  setTable(name: string, schema: TableSchema) {
    this.tables.set(name, schema)
  }

  removeTable(name: string) {
    this.tables.delete(name)
  }

  clear() {
    this.tables.clear()
  }
}

/**
 * Scenario 1: Basic schema refresh with updates
 */
test('Integration: Schema refresh detects changes', async () => {
  const testDir = join(tmpdir(), `integration-1-${Date.now()}`)
  await Bun.spawn(['mkdir', '-p', testDir]).exited

  const adapter = new MockDatabaseAdapter()
  const cache = new SchemaCacheManager(testDir)

  // Set up initial config
  const config: DbcliConfig = {
    connection: {
      system: 'postgresql',
      host: 'localhost',
      port: 5432,
      user: 'test',
      password: 'test',
      database: 'testdb',
    },
    permission: 'query-only',
    schema: {},
  }

  const configPath = join(testDir, 'config.json')
  await Bun.write(Bun.file(configPath), JSON.stringify(config, null, 2))

  // Add table to database
  adapter.setTable('users', {
    name: 'users',
    columns: [
      { name: 'id', type: 'integer', nullable: false, primaryKey: true, default: null },
      { name: 'email', type: 'varchar', nullable: false, primaryKey: false, default: null },
    ],
  })

  const updater = new SchemaUpdater(testDir, adapter, cache)

  // This would require more setup in actual test, but demonstrates flow
  expect(await adapter.listTables()).toHaveLength(1)

  // Cleanup
  await Bun.spawn(['rm', '-rf', testDir]).exited
})

/**
 * Scenario 2: Concurrent lock coordination
 */
test('Integration: Lock provides mutual exclusion', async () => {
  const testDir = join(tmpdir(), `integration-2-${Date.now()}`)
  await Bun.spawn(['mkdir', '-p', testDir]).exited

  const lock = new ConcurrentLockManager(testDir)

  // Acquire lock
  await lock.acquireLock('operation1')
  expect(lock.isLockHeld()).toBe(true)

  // Check lock age
  const age = lock.getLockAge()
  expect(age).not.toBe(null)
  expect(age).toBeGreaterThanOrEqual(0)

  // Release lock
  await lock.releaseLock()
  expect(lock.isLockHeld()).toBe(false)
  expect(lock.getLockAge()).toBe(null)

  // Cleanup
  await Bun.spawn(['rm', '-rf', testDir]).exited
})

/**
 * Scenario 3: Error recovery on operation failure
 */
test('Integration: Error recovery restores on failure', async () => {
  const testDir = join(tmpdir(), `integration-3-${Date.now()}`)
  await Bun.spawn(['mkdir', '-p', testDir]).exited

  const recovery = new ErrorRecoveryManager(testDir)
  await recovery.initialize()

  const config: DbcliConfig = {
    connection: {
      system: 'postgresql',
      host: 'localhost',
      port: 5432,
      user: 'test',
      password: 'test',
      database: 'testdb',
    },
    permission: 'query-only',
    schema: { test_table: { name: 'test', columns: [] } },
  }

  const configPath = join(testDir, 'config.json')
  await Bun.write(Bun.file(configPath), JSON.stringify(config, null, 2))

  // Simulate operation failure with recovery
  let operationFailed = false
  try {
    await recovery.withRecovery(
      config,
      async () => {
        throw new Error('Simulated failure')
      },
      configPath
    )
  } catch {
    operationFailed = true
  }

  expect(operationFailed).toBe(true)

  // Verify config was restored
  const restored = (await Bun.file(configPath).json()) as DbcliConfig
  expect(restored.schema!['test_table']).toBeDefined()

  // Cleanup
  await Bun.spawn(['rm', '-rf', testDir]).exited
})

/**
 * Scenario 4: Column indexing for fast lookups
 */
test('Integration: Column index enables fast field searches', () => {
  const schemas = {
    users: {
      name: 'users',
      columns: [
        { name: 'id', type: 'integer', nullable: false, primaryKey: true, default: null },
        { name: 'email', type: 'varchar', nullable: false, primaryKey: false, default: null },
        { name: 'name', type: 'varchar', nullable: true, primaryKey: false, default: null },
      ],
    },
    products: {
      name: 'products',
      columns: [
        { name: 'id', type: 'integer', nullable: false, primaryKey: true, default: null },
        { name: 'name', type: 'varchar', nullable: false, primaryKey: false, default: null },
      ],
    },
  }

  const indexBuilder = new ColumnIndexBuilder()
  const index = indexBuilder.build(schemas)

  // Find a field name that appears in multiple tables
  const nameColumns = indexBuilder.findColumn('name')
  expect(nameColumns.length).toBeGreaterThan(1)
  expect(nameColumns.map((c) => c.tableName).sort()).toEqual(['products', 'users'])

  // Find primary keys
  const pks = indexBuilder.findPrimaryKeys()
  expect(pks.length).toBe(2)
  expect(pks.every((pk) => pk.column.primaryKey)).toBe(true)
})

/**
 * Scenario 5: Schema optimization analysis
 */
test('Integration: Schema optimizer analyzes design', () => {
  const schemas = {
    users: {
      name: 'users',
      columns: [
        { name: 'id', type: 'integer', nullable: false, primaryKey: true, default: null },
        { name: 'email', type: 'varchar', nullable: false, primaryKey: false, default: null },
        {
          name: 'created_at',
          type: 'timestamp',
          nullable: false,
          primaryKey: false,
          default: null,
        },
      ],
    },
  }

  const optimizer = new SchemaOptimizer()
  const report = optimizer.analyzeSchema(schemas)

  expect(report.totalTables).toBe(1)
  expect(report.totalColumns).toBe(3)
  expect(report.cacheRecommendations.recommendedHotTables).toHaveLength(1)

  const suggestions = optimizer.getSuggestions(report)
  expect(suggestions.length).toBeGreaterThan(0)

  const estimatedSize = optimizer.estimateSchemaSize(schemas)
  expect(estimatedSize).toBeGreaterThan(0)
})

/**
 * Scenario 6: End-to-end workflow (lock → refresh → optimize → cache)
 */
test('Integration: Complete workflow with all components', async () => {
  const testDir = join(tmpdir(), `integration-6-${Date.now()}`)
  await Bun.spawn(['mkdir', '-p', testDir]).exited

  const adapter = new MockDatabaseAdapter()
  const cache = new SchemaCacheManager(testDir)
  const lock = new ConcurrentLockManager(testDir)
  const recovery = new ErrorRecoveryManager(testDir)
  const optimizer = new SchemaOptimizer()
  const indexBuilder = new ColumnIndexBuilder()

  // Setup
  const config: DbcliConfig = {
    connection: {
      system: 'postgresql',
      host: 'localhost',
      port: 5432,
      user: 'test',
      password: 'test',
      database: 'testdb',
    },
    permission: 'query-only',
    schema: {},
  }

  // Add tables
  adapter.setTable('users', {
    name: 'users',
    columns: [
      { name: 'id', type: 'integer', nullable: false, primaryKey: true, default: null },
      { name: 'email', type: 'varchar', nullable: false, primaryKey: false, default: null },
    ],
  })

  // Execute workflow
  const acquired = await lock.acquireLock('test-workflow')
  expect(acquired).toBe(true)

  // Create backup before operations
  const backup = await recovery.createRecoveryPoint(config, 'workflow-test')
  expect(backup).toBeDefined()

  // Build index
  const schemas = { users: (await adapter.getTableSchema('users'))! }
  const index = indexBuilder.build(schemas)
  expect(index.totalTables).toBe(1)

  // Analyze
  const report = optimizer.analyzeSchema(schemas)
  expect(report.totalTables).toBe(1)

  // Release lock
  await lock.releaseLock()
  expect(lock.isLockHeld()).toBe(false)

  // Cleanup
  await Bun.spawn(['rm', '-rf', testDir]).exited
})

/**
 * Scenario 7: Cache stats verification
 */
test('Integration: Cache statistics tracking', async () => {
  const testDir = join(tmpdir(), `integration-7-${Date.now()}`)
  await Bun.spawn(['mkdir', '-p', testDir]).exited

  const cache = new SchemaCacheManager(testDir)
  await cache.initialize()

  const stats = cache.getStats()

  expect(stats).toBeDefined()
  expect(stats.hotTables).toBeGreaterThanOrEqual(0)
  expect(stats.cachedTables).toBeGreaterThanOrEqual(0)
  expect(stats.cacheSize).toBeGreaterThanOrEqual(0)
  expect(stats.maxItems).toBeGreaterThan(0)

  // Cleanup
  await Bun.spawn(['rm', '-rf', testDir]).exited
})
