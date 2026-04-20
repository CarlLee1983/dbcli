/**
 * Schema Index Builder Tests
 *
 * 测试索引构建、保存和查询
 */

import { test, expect, describe, beforeAll, afterAll } from 'bun:test'
import { SchemaIndexBuilder } from '@/core/schema-index'
import type { DbcliConfig } from '@/types'
import { join } from 'path'
import { mkdir, rm } from 'fs/promises'

// Mock config with sample schemas
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
        { name: 'name', type: 'varchar', nullable: false },
        { name: 'created_at', type: 'timestamp', nullable: false },
        { name: 'updated_at', type: 'timestamp', nullable: false },
      ],
      primaryKey: ['id'],
    },
    products: {
      name: 'products',
      columns: [
        { name: 'id', type: 'bigint', nullable: false, primaryKey: true },
        { name: 'name', type: 'varchar', nullable: false },
        { name: 'price', type: 'numeric', nullable: false },
      ],
      primaryKey: ['id'],
    },
    legacy_data: {
      name: 'legacy_data',
      columns: [
        { name: 'id', type: 'bigint', nullable: false, primaryKey: true },
      ],
      primaryKey: ['id'],
    },
    old_cache: {
      name: 'old_cache',
      columns: [
        { name: 'key', type: 'varchar', nullable: false, primaryKey: true },
        { name: 'value', type: 'text', nullable: true },
      ],
      primaryKey: ['key'],
    },
  },
}

describe('SchemaIndexBuilder', () => {
  let testDbcliPath: string

  beforeAll(async () => {
    testDbcliPath = join('/tmp', `dbcli-index-test-${Date.now()}`)
    await mkdir(join(testDbcliPath, 'schemas'), { recursive: true })
  })

  afterAll(async () => {
    try {
      await rm(testDbcliPath, { recursive: true, force: true })
    } catch (error) {
      // Ignore cleanup errors
    }
  })

  test('buildIndex: classifies tables into hot/cold', async () => {
    const index = await SchemaIndexBuilder.buildIndex(mockConfig)

    expect(index.tables).not.toBeNull()
    expect(index.hotTables.length).toBeGreaterThan(0)
    expect(index.metadata.version).toBe('1.0')
    expect(index.metadata.totalTables).toBe(4)
  })

  test('buildIndex: hot table threshold 20% = 1 table', async () => {
    const index = await SchemaIndexBuilder.buildIndex(mockConfig, {
      hotTableThreshold: 20,
    })

    // With 4 tables, 20% = ~1 table (top by size)
    expect(index.hotTables.length).toBeGreaterThanOrEqual(1)
    expect(index.hotTables.length).toBeLessThanOrEqual(2)
  })

  test('buildIndex: respects custom threshold', async () => {
    const index = await SchemaIndexBuilder.buildIndex(mockConfig, {
      hotTableThreshold: 50,
    })

    // With 4 tables, 50% = 2 tables
    expect(index.hotTables.length).toBeGreaterThanOrEqual(2)
  })

  test('buildIndex: marks tables with correct location', async () => {
    const index = await SchemaIndexBuilder.buildIndex(mockConfig)

    // All tables should have location
    for (const tableInfo of Object.values(index.tables)) {
      expect(['hot', 'cold']).toContain(tableInfo.location)
      expect(tableInfo.file).toBeDefined()
      expect(tableInfo.estimatedSize).toBeGreaterThan(0)
    }
  })

  test('buildIndex: legacy tables go to legacy.json', async () => {
    const index = await SchemaIndexBuilder.buildIndex(mockConfig)

    const legacyTable = index.tables['legacy_data']
    expect(legacyTable?.file).toContain('legacy')

    const oldTable = index.tables['old_cache']
    expect(oldTable?.file).toContain('legacy')
  })

  test('saveIndex: persists index to file', async () => {
    const index = await SchemaIndexBuilder.buildIndex(mockConfig)
    await SchemaIndexBuilder.saveIndex(testDbcliPath, index)

    const indexPath = join(testDbcliPath, 'schemas', 'index.json')
    const file = Bun.file(indexPath)
    const exists = await file.exists()

    expect(exists).toBe(true)
  })

  test('loadIndex: reads persisted index', async () => {
    const originalIndex = await SchemaIndexBuilder.buildIndex(mockConfig)
    await SchemaIndexBuilder.saveIndex(testDbcliPath, originalIndex)

    const loadedIndex = await SchemaIndexBuilder.loadIndex(testDbcliPath)

    expect(loadedIndex).not.toBeNull()
    expect(loadedIndex?.metadata.totalTables).toBe(originalIndex.metadata.totalTables)
    expect(loadedIndex?.hotTables.length).toBe(originalIndex.hotTables.length)
  })

  test('saveIndex/loadIndex: connectionName nests under schemas/<name>/', async () => {
    const index = await SchemaIndexBuilder.buildIndex(mockConfig)
    await SchemaIndexBuilder.saveIndex(testDbcliPath, index, 'prod')

    const indexPath = join(testDbcliPath, 'schemas', 'prod', 'index.json')
    expect(await Bun.file(indexPath).exists()).toBe(true)

    const loaded = await SchemaIndexBuilder.loadIndex(testDbcliPath, 'prod')
    expect(loaded?.metadata.totalTables).toBe(index.metadata.totalTables)
  })

  test('loadIndex: returns null for missing index', async () => {
    const emptyPath = join('/tmp', `dbcli-empty-index-${Date.now()}`)
    await mkdir(join(emptyPath, 'schemas'), { recursive: true })

    const index = await SchemaIndexBuilder.loadIndex(emptyPath)
    expect(index).toBeNull()

    // Cleanup
    await rm(emptyPath, { recursive: true, force: true })
  })

  test('calculateFileMapping: generates correct hot/cold mapping', async () => {
    const index = await SchemaIndexBuilder.buildIndex(mockConfig)
    const mapping = SchemaIndexBuilder.calculateFileMapping(index)

    expect(mapping.hot).toBeDefined()
    expect(mapping.cold).toBeDefined()
    expect(mapping.hot.length + mapping.cold.length).toBe(4)
  })

  test('calculateFileMapping: all tables mapped', async () => {
    const index = await SchemaIndexBuilder.buildIndex(mockConfig)
    const mapping = SchemaIndexBuilder.calculateFileMapping(index)

    const allMappedTables = new Set<string>()
    mapping.hot.forEach((m) => allMappedTables.add(m.table))
    mapping.cold.forEach((m) => allMappedTables.add(m.table))

    expect(allMappedTables.size).toBe(4)
  })

  test('index metadata: contains version and timestamp', async () => {
    const index = await SchemaIndexBuilder.buildIndex(mockConfig)

    expect(index.metadata.version).toBe('1.0')
    expect(index.metadata.lastRefreshed).toBeDefined()
    expect(new Date(index.metadata.lastRefreshed).getTime()).toBeLessThanOrEqual(
      Date.now()
    )
  })

  test('buildIndex: handles empty config', async () => {
    const emptyConfig: DbcliConfig = {
      connection: {
        system: 'postgresql',
        host: 'localhost',
        port: 5432,
        user: 'test',
        password: 'test',
        database: 'test',
      },
      permission: 'admin',
    }

    const index = await SchemaIndexBuilder.buildIndex(emptyConfig)

    expect(index.metadata.totalTables).toBe(0)
    expect(index.hotTables).toHaveLength(0)
    expect(Object.keys(index.tables)).toHaveLength(0)
  })

  test('buildIndex: sorts tables by size correctly', async () => {
    const index = await SchemaIndexBuilder.buildIndex(mockConfig)

    // First hot table should be one of the larger ones
    const hotTableName = index.hotTables[0]
    const hotTableInfo = index.tables[hotTableName]

    // Hot table should have size comparable to largest tables
    const allSizes = Object.values(index.tables).map((t) => t.estimatedSize)
    const sortedSizes = [...allSizes].sort((a, b) => b - a)

    expect(hotTableInfo?.estimatedSize).toBeGreaterThanOrEqual(
      sortedSizes[Math.ceil(sortedSizes.length * 0.2)]
    )
  })
})
