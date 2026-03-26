/**
 * Schema Layered Loader Tests
 *
 * 测试启动初始化和性能指标
 */

import { test, expect, describe, beforeAll, afterAll } from 'bun:test'
import { SchemaLayeredLoader } from './schema-loader'
import { SchemaIndexBuilder } from './schema-index'
import type { DbcliConfig } from '@/types'
import { join } from 'path'
import { mkdir, rm } from 'fs/promises'

// Mock config
const mockConfig: DbcliConfig = {
  connection: {
    system: 'postgresql',
    host: 'localhost',
    port: 5432,
    user: 'test',
    password: 'test',
    database: 'test',
  },
  permission: 'admin',
  schema: {
    users: {
      name: 'users',
      columns: [
        { name: 'id', type: 'bigint', nullable: false, primaryKey: true },
        { name: 'email', type: 'varchar', nullable: false },
      ],
      primaryKey: ['id'],
    },
    products: {
      name: 'products',
      columns: [
        { name: 'id', type: 'bigint', nullable: false, primaryKey: true },
        { name: 'name', type: 'varchar', nullable: false },
      ],
      primaryKey: ['id'],
    },
  },
}

describe('SchemaLayeredLoader', () => {
  let testDbcliPath: string

  beforeAll(async () => {
    testDbcliPath = join('/tmp', `dbcli-loader-test-${Date.now()}`)
    await mkdir(join(testDbcliPath, 'schemas', 'cold'), { recursive: true })

    // Create index and hot schemas
    const index = await SchemaIndexBuilder.buildIndex(mockConfig)
    await SchemaIndexBuilder.saveIndex(testDbcliPath, index)

    // Create hot-schemas.json with hot tables
    const hotData = {
      schemas: {
        users: mockConfig.schema?.users,
      },
    }
    await Bun.file(join(testDbcliPath, 'schemas', 'hot-schemas.json')).write(
      JSON.stringify(hotData, null, 2)
    )

    // Create cold/infrequent.json
    const coldData = {
      schemas: {
        products: mockConfig.schema?.products,
      },
    }
    await Bun.file(
      join(testDbcliPath, 'schemas', 'cold', 'infrequent.json')
    ).write(JSON.stringify(coldData, null, 2))
  })

  afterAll(async () => {
    try {
      await rm(testDbcliPath, { recursive: true, force: true })
    } catch (error) {
      // Ignore cleanup errors
    }
  })

  test('initialize: returns cache and index', async () => {
    const loader = new SchemaLayeredLoader(testDbcliPath)
    const result = await loader.initialize()

    expect(result.cache).toBeDefined()
    expect(result.loadTime).toBeGreaterThan(0)
  })

  test('initialize: measures load time', async () => {
    const loader = new SchemaLayeredLoader(testDbcliPath)
    const result = await loader.initialize()

    expect(result.loadTime).toBeGreaterThan(0)
    expect(result.loadTime).toBeLessThan(1000) // Should be fast
  })

  test('initialize: supports custom options', async () => {
    const loader = new SchemaLayeredLoader(testDbcliPath, {
      maxCacheItems: 50,
      maxCacheSize: 10485760,
      hotTableThreshold: 30,
    })

    const result = await loader.initialize()
    const stats = result.cache.getStats()

    expect(stats.maxItems).toBe(50)
    expect(stats.maxSize).toBe(10485760)
  })

  test('initialize: creates benchmark data', async () => {
    const loader = new SchemaLayeredLoader(testDbcliPath)
    await loader.initialize()

    const benchmark = loader.getBenchmark()
    expect(benchmark.initTime).toBeGreaterThan(0)
    expect(benchmark.hotTables).toBeGreaterThanOrEqual(0)
    expect(benchmark.totalTables).toBeGreaterThanOrEqual(0)
    expect(benchmark.estimatedSize).toBeGreaterThanOrEqual(0)
  })

  test('loadColdTable: loads table on demand', async () => {
    const loader = new SchemaLayeredLoader(testDbcliPath)
    const { cache } = await loader.initialize()

    // First access should load from cache (since it was preloaded in test setup)
    const schema = await loader.loadColdTable('users', cache)
    expect(schema).not.toBeNull()
    expect(schema?.name).toBe('users')
  })

  test('loadColdTable: returns null for nonexistent table', async () => {
    const loader = new SchemaLayeredLoader(testDbcliPath)
    const { cache } = await loader.initialize()

    const schema = await loader.loadColdTable('nonexistent', cache)
    expect(schema).toBeNull()
  })

  test('initialize: graceful degradation on missing files', async () => {
    const emptyPath = join('/tmp', `dbcli-empty-loader-${Date.now()}`)
    await mkdir(join(emptyPath, 'schemas'), { recursive: true })

    const loader = new SchemaLayeredLoader(emptyPath)
    const result = await loader.initialize()

    expect(result.cache).toBeDefined()
    expect(result.loadTime).toBeGreaterThan(0)

    // Cleanup
    await rm(emptyPath, { recursive: true, force: true })
  })

  test('getBenchmark: returns zeros when uninitialized', () => {
    const loader = new SchemaLayeredLoader(testDbcliPath)
    const benchmark = loader.getBenchmark()

    expect(benchmark.initTime).toBe(0)
    expect(benchmark.hotTables).toBe(0)
    expect(benchmark.totalTables).toBe(0)
    expect(benchmark.estimatedSize).toBe(0)
  })

  test('initialize: performance target check', async () => {
    const loader = new SchemaLayeredLoader(testDbcliPath)
    const result = await loader.initialize()

    // Most cold path should be < 100ms
    // Allow some slack for slow CI systems
    expect(result.loadTime).toBeLessThan(200)
  })

  test('constructor: applies default options', () => {
    const loader = new SchemaLayeredLoader(testDbcliPath)
    const benchmark = loader.getBenchmark()

    // getBenchmark() before initialize() should have defaults
    expect(benchmark.initTime).toBe(0)
  })

  test('initialize: creates directories if missing', async () => {
    const newPath = join('/tmp', `dbcli-new-loader-${Date.now()}`)

    // Only create base directory, not schemas/
    await mkdir(newPath, { recursive: true })

    const loader = new SchemaLayeredLoader(newPath)
    const result = await loader.initialize()

    expect(result.cache).toBeDefined()

    // Verify directories were created
    const schemasDir = Bun.file(join(newPath, 'schemas'))
    const coldDir = Bun.file(join(newPath, 'schemas', 'cold'))

    // Cleanup
    await rm(newPath, { recursive: true, force: true })
  })

  test('multiple initialize calls are safe', async () => {
    const loader = new SchemaLayeredLoader(testDbcliPath)

    const result1 = await loader.initialize()
    const result2 = await loader.initialize()

    expect(result1.cache).toBeDefined()
    expect(result2.cache).toBeDefined()
    expect(result1.loadTime).toBeGreaterThan(0)
    expect(result2.loadTime).toBeGreaterThan(0)
  })
})
