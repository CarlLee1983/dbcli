import { describe, expect, test } from 'bun:test'
import { MongoShellAdapter } from '@/adapters/mongo-shell-adapter'
import type { QueryableAdapter } from '@/adapters/types'

class MockQueryableAdapter implements QueryableAdapter {
  connected = false
  async connect() {
    this.connected = true
  }
  async disconnect() {
    this.connected = false
  }
  async execute<T>() {
    return { rows: [] as T[], affectedRows: 0 }
  }
  async listCollections() {
    return [{ name: 'users', documentCount: 2 }]
  }
  async testConnection() {
    return true
  }
  async getServerVersion() {
    return '7.0.0'
  }
}

describe('MongoShellAdapter', () => {
  test('maps collections to table-like rows for shell context', async () => {
    const adapter = new MongoShellAdapter(new MockQueryableAdapter())
    const tables = await adapter.listTables()
    expect(tables).toHaveLength(1)
    expect(tables[0].name).toBe('users')
    expect(tables[0].estimatedRowCount).toBe(2)
  })

  test('rejects raw SQL execution with a helpful error', async () => {
    const adapter = new MongoShellAdapter(new MockQueryableAdapter())
    await expect(adapter.execute('SELECT 1')).rejects.toThrow(
      'MongoDB shell does not support raw SQL'
    )
  })
})
