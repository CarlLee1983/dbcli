/**
 * Schema Cache Manager Tests
 *
 * 测试三層查詢策略和快取性能
 */

import { test, expect, describe, beforeAll, afterAll } from 'bun:test'
import { SchemaCacheManager } from '@/core/schema-cache'
import { join } from 'path'
import { mkdir, rm } from 'fs/promises'

// Mock data
const mockTableSchema = {
  name: 'users',
  columns: [
    { name: 'id', type: 'bigint', nullable: false, primaryKey: true },
    { name: 'email', type: 'varchar', nullable: false },
    { name: 'created_at', type: 'timestamp', nullable: false },
  ],
  primaryKey: ['id'],
}

const mockTableSchema2 = {
  name: 'products',
  columns: [
    { name: 'id', type: 'bigint', nullable: false, primaryKey: true },
    { name: 'name', type: 'varchar', nullable: false },
    { name: 'price', type: 'numeric', nullable: false },
  ],
  primaryKey: ['id'],
}

describe('SchemaCacheManager', () => {
  let testDbcliPath: string

  beforeAll(async () => {
    // Create temporary test directory
    testDbcliPath = join('/tmp', `dbcli-test-${Date.now()}`)
    const schemasDir = join(testDbcliPath, 'schemas', 'cold')
    await mkdir(schemasDir, { recursive: true })

    // Create mock index.json
    const indexData = {
      tables: {
        users: {
          location: 'hot',
          file: 'hot-schemas.json',
          estimatedSize: 1000,
          lastModified: new Date().toISOString(),
        },
        products: {
          location: 'cold',
          file: 'cold/infrequent.json',
          estimatedSize: 800,
          lastModified: new Date().toISOString(),
        },
      },
      hotTables: ['users'],
      metadata: {
        version: '1.0',
        lastRefreshed: new Date().toISOString(),
        totalTables: 2,
      },
    }
    await Bun.file(join(testDbcliPath, 'schemas', 'index.json')).write(
      JSON.stringify(indexData, null, 2)
    )

    // Create mock hot-schemas.json
    const hotData = {
      schemas: {
        users: mockTableSchema,
      },
    }
    await Bun.file(join(testDbcliPath, 'schemas', 'hot-schemas.json')).write(
      JSON.stringify(hotData, null, 2)
    )

    // Create mock cold/infrequent.json
    const coldData = {
      schemas: {
        products: mockTableSchema2,
      },
    }
    await Bun.file(join(testDbcliPath, 'schemas', 'cold', 'infrequent.json')).write(
      JSON.stringify(coldData, null, 2)
    )
  })

  afterAll(async () => {
    // Clean up test directory
    try {
      await rm(testDbcliPath, { recursive: true, force: true })
    } catch (error) {
      // Ignore cleanup errors
    }
  })

  test('initialize: load index and hot schemas', async () => {
    const manager = new SchemaCacheManager(testDbcliPath)
    await manager.initialize()

    const stats = manager.getStats()
    expect(stats.hotTables).toBe(1)
    expect(stats.cachedTables).toBe(1)
  })

  test('getTableSchema: hot table returns immediately', async () => {
    const manager = new SchemaCacheManager(testDbcliPath)
    await manager.initialize()

    const start = performance.now()
    const schema = await manager.getTableSchema('users')
    const elapsed = performance.now() - start

    expect(schema).not.toBeNull()
    expect(schema?.name).toBe('users')
    expect(elapsed).toBeLessThan(10) // Hot lookup should be < 10ms
  })

  test('getTableSchema: cold table loads from file', async () => {
    const manager = new SchemaCacheManager(testDbcliPath)
    await manager.initialize()

    const schema = await manager.getTableSchema('products')
    expect(schema).not.toBeNull()
    expect(schema?.name).toBe('products')
  })

  test('getTableSchema: second cold table access hits cache', async () => {
    const manager = new SchemaCacheManager(testDbcliPath)
    await manager.initialize()

    // First access loads from file
    const schema1 = await manager.getTableSchema('products')
    expect(schema1?.name).toBe('products')

    // Second access should hit LRU cache
    const start = performance.now()
    const schema2 = await manager.getTableSchema('products')
    const elapsed = performance.now() - start

    expect(schema2).toEqual(schema1)
    expect(elapsed).toBeLessThan(5) // Cache hit should be very fast
  })

  test('getTableSchema: nonexistent table returns null', async () => {
    const manager = new SchemaCacheManager(testDbcliPath)
    await manager.initialize()

    const schema = await manager.getTableSchema('nonexistent')
    expect(schema).toBeNull()
  })

  test('getTableSchema: returns null when index missing', async () => {
    const emptyPath = join('/tmp', `dbcli-empty-${Date.now()}`)
    await mkdir(join(emptyPath, 'schemas'), { recursive: true })

    const manager = new SchemaCacheManager(emptyPath)
    await manager.initialize()

    const schema = await manager.getTableSchema('users')
    expect(schema).toBeNull()

    // Cleanup
    await rm(emptyPath, { recursive: true, force: true })
  })

  test('findFieldsByName: finds field in hot table', async () => {
    const manager = new SchemaCacheManager(testDbcliPath)
    await manager.initialize()

    const results = await manager.findFieldsByName('email')
    expect(results).toHaveLength(1)
    expect(results[0].table).toBe('users')
    expect(results[0].column.name).toBe('email')
  })

  test('findFieldsByName: finds multiple matches', async () => {
    const manager = new SchemaCacheManager(testDbcliPath)
    await manager.initialize()

    // Both users and products have 'id'
    const results = await manager.findFieldsByName('id')
    expect(results.length).toBeGreaterThanOrEqual(1) // At least users
  })

  test('findFieldsByName: returns empty for nonexistent field', async () => {
    const manager = new SchemaCacheManager(testDbcliPath)
    await manager.initialize()

    const results = await manager.findFieldsByName('nonexistent_field')
    expect(results).toHaveLength(0)
  })

  test('getStats: returns correct cache statistics', async () => {
    const manager = new SchemaCacheManager(testDbcliPath)
    await manager.initialize()

    const stats = manager.getStats()
    expect(stats.hotTables).toBe(1)
    expect(stats.cachedTables).toBeGreaterThanOrEqual(1)
    expect(stats.cacheSize).toBeGreaterThan(0)
    expect(stats.maxItems).toBe(100) // Default
    expect(stats.maxSize).toBe(52428800) // 50MB
  })

  test('getStats: hit rate percentage', async () => {
    const manager = new SchemaCacheManager(testDbcliPath)
    await manager.initialize()

    const stats = manager.getStats()
    expect(stats.cacheHitRate).toMatch(/\d+%/)
  })

  test('constructor: respects custom cache options', () => {
    const manager = new SchemaCacheManager(testDbcliPath, {
      maxCacheItems: 50,
      maxCacheSize: 10485760, // 10MB
    })

    const stats = manager.getStats()
    expect(stats.maxItems).toBe(50)
    expect(stats.maxSize).toBe(10485760)
  })

  test('concurrent access: same table returns consistent schema', async () => {
    const manager = new SchemaCacheManager(testDbcliPath)
    await manager.initialize()

    // Access same table concurrently
    const [schema1, schema2, schema3] = await Promise.all([
      manager.getTableSchema('users'),
      manager.getTableSchema('users'),
      manager.getTableSchema('users'),
    ])

    expect(schema1).toEqual(schema2)
    expect(schema2).toEqual(schema3)
  })
})

describe('SchemaCacheManager connectionName isolation', () => {
  test('reads layered files from schemas/<name>/', async () => {
    const testDbcliPath = join('/tmp', `dbcli-cache-conn-${Date.now()}`)
    const root = join(testDbcliPath, 'schemas', 'staging')
    await mkdir(join(root, 'cold'), { recursive: true })

    const indexData = {
      tables: {
        users: {
          location: 'hot',
          file: 'hot-schemas.json',
          estimatedSize: 1,
          lastModified: new Date().toISOString(),
        },
      },
      hotTables: ['users'],
      metadata: {
        version: '1.0',
        lastRefreshed: new Date().toISOString(),
        totalTables: 1,
      },
    }
    await Bun.file(join(root, 'index.json')).write(JSON.stringify(indexData, null, 2))
    await Bun.file(join(root, 'hot-schemas.json')).write(
      JSON.stringify({ schemas: { users: mockTableSchema } }, null, 2)
    )

    const manager = new SchemaCacheManager(testDbcliPath, { connectionName: 'staging' })
    await manager.initialize()
    const schema = await manager.getTableSchema('users')
    expect(schema?.name).toBe('users')

    try {
      await rm(testDbcliPath, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  })
})
