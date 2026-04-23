import { test, expect, describe } from 'bun:test'
import { SchemaCacheManager } from 'src/core/schema-cache'
import type { TableSchema } from 'src/adapters/types'
import { tmpdir } from 'os'
import { join } from 'path'

const tmpPath = join(tmpdir(), `dbcli-cache-ddl-test-${Date.now()}`)

const mockSchema: TableSchema = {
  name: 'posts',
  columns: [
    { name: 'id', type: 'serial', nullable: false, primaryKey: true },
    { name: 'title', type: 'varchar(200)', nullable: false },
  ],
  primaryKey: ['id'],
}

describe('SchemaCacheManager.invalidateTable', () => {
  test('removes table from cache', async () => {
    const cache = new SchemaCacheManager(tmpPath)
    cache.refreshTable('posts', mockSchema)

    // Verify it's there
    const before = await cache.getTableSchema('posts')
    expect(before).not.toBeNull()

    // Invalidate
    cache.invalidateTable('posts')

    // Verify it's gone
    const after = await cache.getTableSchema('posts')
    expect(after).toBeNull()
  })

  test('no-op for non-existent table', () => {
    const cache = new SchemaCacheManager(tmpPath)
    expect(() => cache.invalidateTable('nonexistent')).not.toThrow()
  })
})

describe('SchemaCacheManager.refreshTable', () => {
  test('adds table to cache', async () => {
    const cache = new SchemaCacheManager(tmpPath)
    cache.refreshTable('posts', mockSchema)

    const result = await cache.getTableSchema('posts')
    expect(result).not.toBeNull()
    expect(result!.name).toBe('posts')
    expect(result!.columns.length).toBe(2)
  })

  test('updates existing table', async () => {
    const cache = new SchemaCacheManager(tmpPath)
    cache.refreshTable('posts', mockSchema)

    const updated: TableSchema = {
      ...mockSchema,
      columns: [...mockSchema.columns, { name: 'body', type: 'text', nullable: true }],
    }
    cache.refreshTable('posts', updated)

    const result = await cache.getTableSchema('posts')
    expect(result!.columns.length).toBe(3)
    expect(result!.columns[2]!.name).toBe('body')
  })

  test('reflects in stats', () => {
    const cache = new SchemaCacheManager(tmpPath)
    cache.refreshTable('t1', mockSchema)
    cache.refreshTable('t2', mockSchema)

    const stats = cache.getStats()
    expect(stats.hotTables).toBe(2)
  })
})
