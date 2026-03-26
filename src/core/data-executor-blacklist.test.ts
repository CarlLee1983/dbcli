/**
 * DataExecutor integration tests with table-level blacklist enforcement
 */

import { describe, it, expect } from 'bun:test'
import { DataExecutor } from '@/core/data-executor'
import { BlacklistManager } from '@/core/blacklist-manager'
import { BlacklistValidator } from '@/core/blacklist-validator'
import { BlacklistError } from '@/types/blacklist'
import type { DatabaseAdapter, TableSchema } from '@/adapters/types'
import type { DbcliConfig } from '@/types'

// Mock database adapter
function createMockAdapter(): DatabaseAdapter {
  return {
    connect: async () => {},
    disconnect: async () => {},
    execute: async <T = unknown>(_sql: string, _params?: any[]) => [] as T[],
    listTables: async () => [],
    getTableSchema: async () => ({ name: '', columns: [], rowCount: 0, primaryKey: null, foreignKeys: [] }),
    ping: async () => {}
  }
}

const mockSchema: TableSchema = {
  name: 'audit_logs',
  columns: [
    { name: 'id', type: 'integer', nullable: false, defaultValue: null, isPrimaryKey: true, foreignKey: null },
    { name: 'action', type: 'varchar', nullable: false, defaultValue: null, isPrimaryKey: false, foreignKey: null }
  ],
  rowCount: 0,
  primaryKey: 'id',
  foreignKeys: []
}

const usersSchema: TableSchema = {
  name: 'users',
  columns: [
    { name: 'id', type: 'integer', nullable: false, defaultValue: null, isPrimaryKey: true, foreignKey: null },
    { name: 'name', type: 'varchar', nullable: false, defaultValue: null, isPrimaryKey: false, foreignKey: null }
  ],
  rowCount: 0,
  primaryKey: 'id',
  foreignKeys: []
}

const baseConfig: DbcliConfig = {
  connection: { system: 'postgresql', host: 'localhost', port: 5432, user: 'u', password: 'p', database: 'db' },
  permission: 'admin'
}

function makeValidator(blacklist?: any, overrideEnv?: string): BlacklistValidator {
  const config = { ...baseConfig, blacklist }
  const manager = new BlacklistManager(config as any, overrideEnv)
  return new BlacklistValidator(manager)
}

describe('DataExecutor with blacklist enforcement', () => {
  describe('INSERT on blacklisted table', () => {
    it('throws BlacklistError before SQL is built', async () => {
      const adapter = createMockAdapter()
      const validator = makeValidator({ tables: ['audit_logs'], columns: {} })
      const executor = new DataExecutor(adapter, 'admin', 'postgresql', validator)

      await expect(
        executor.executeInsert('audit_logs', { action: 'test' }, mockSchema, { force: true })
      ).rejects.toThrow(BlacklistError)
    })

    it('error message includes table name and operation', async () => {
      const adapter = createMockAdapter()
      const validator = makeValidator({ tables: ['audit_logs'], columns: {} })
      const executor = new DataExecutor(adapter, 'admin', 'postgresql', validator)

      try {
        await executor.executeInsert('audit_logs', { action: 'test' }, mockSchema, { force: true })
        expect(true).toBe(false) // should not reach
      } catch (e) {
        expect(e).toBeInstanceOf(BlacklistError)
        const err = e as BlacklistError
        expect(err.message).toContain('audit_logs')
        expect(err.operation).toBe('INSERT')
      }
    })

    it('allows INSERT on non-blacklisted table', async () => {
      const adapter = createMockAdapter()
      const validator = makeValidator({ tables: ['audit_logs'], columns: {} })
      const executor = new DataExecutor(adapter, 'admin', 'postgresql', validator)

      // users is not blacklisted - should not throw BlacklistError
      const result = await executor.executeInsert('users', { name: 'Alice' }, usersSchema, { force: true })
      expect(result.status).toBe('success')
    })
  })

  describe('UPDATE on blacklisted table', () => {
    it('throws BlacklistError before SQL is built', async () => {
      const adapter = createMockAdapter()
      const validator = makeValidator({ tables: ['audit_logs'], columns: {} })
      const executor = new DataExecutor(adapter, 'admin', 'postgresql', validator)

      await expect(
        executor.executeUpdate('audit_logs', { action: 'new' }, { id: 1 }, mockSchema, { force: true })
      ).rejects.toThrow(BlacklistError)
    })

    it('allows UPDATE on non-blacklisted table', async () => {
      const adapter = createMockAdapter()
      const validator = makeValidator({ tables: ['audit_logs'], columns: {} })
      const executor = new DataExecutor(adapter, 'admin', 'postgresql', validator)

      const result = await executor.executeUpdate('users', { name: 'Bob' }, { id: 1 }, usersSchema, { force: true })
      expect(result.status).toBe('success')
    })
  })

  describe('DELETE on blacklisted table', () => {
    it('throws BlacklistError before SQL is built', async () => {
      const adapter = createMockAdapter()
      const validator = makeValidator({ tables: ['audit_logs'], columns: {} })
      const executor = new DataExecutor(adapter, 'admin', 'postgresql', validator)

      await expect(
        executor.executeDelete('audit_logs', { id: 1 }, mockSchema, { force: true })
      ).rejects.toThrow(BlacklistError)
    })

    it('allows DELETE on non-blacklisted table', async () => {
      const adapter = createMockAdapter()
      const validator = makeValidator({ tables: ['audit_logs'], columns: {} })
      const executor = new DataExecutor(adapter, 'admin', 'postgresql', validator)

      const result = await executor.executeDelete('users', { id: 1 }, usersSchema, { force: true })
      expect(result.status).toBe('success')
    })
  })

  describe('No blacklist configured', () => {
    it('INSERT proceeds normally when no blacklist', async () => {
      const adapter = createMockAdapter()
      const executor = new DataExecutor(adapter, 'admin', 'postgresql')

      const result = await executor.executeInsert('users', { name: 'Alice' }, usersSchema, { force: true })
      expect(result.status).toBe('success')
    })

    it('UPDATE proceeds normally when no blacklist', async () => {
      const adapter = createMockAdapter()
      const executor = new DataExecutor(adapter, 'admin', 'postgresql')

      const result = await executor.executeUpdate('users', { name: 'Bob' }, { id: 1 }, usersSchema, { force: true })
      expect(result.status).toBe('success')
    })

    it('DELETE proceeds normally when no blacklist', async () => {
      const adapter = createMockAdapter()
      const executor = new DataExecutor(adapter, 'admin', 'postgresql')

      const result = await executor.executeDelete('users', { id: 1 }, usersSchema, { force: true })
      expect(result.status).toBe('success')
    })
  })
})
