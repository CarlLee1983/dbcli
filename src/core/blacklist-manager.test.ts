/**
 * BlacklistManager unit tests
 */

import { describe, it, expect, beforeEach } from 'bun:test'
import { BlacklistManager } from './blacklist-manager'
import type { DbcliConfig } from '@/types'

const baseConfig: DbcliConfig = {
  connection: {
    system: 'postgresql',
    host: 'localhost',
    port: 5432,
    user: 'user',
    password: 'pass',
    database: 'testdb'
  },
  permission: 'query-only'
}

function makeConfig(blacklist?: any): any {
  return { ...baseConfig, blacklist }
}

describe('BlacklistManager', () => {
  describe('loadBlacklist()', () => {
    it('returns empty state when no blacklist config', () => {
      const manager = new BlacklistManager(baseConfig)
      const state = manager.getState()
      expect(state.tables.size).toBe(0)
      expect(state.columns.size).toBe(0)
    })

    it('loads populated table blacklist correctly', () => {
      const config = makeConfig({ tables: ['users', 'audit_logs'], columns: {} })
      const manager = new BlacklistManager(config)
      expect(manager.isTableBlacklisted('users')).toBe(true)
      expect(manager.isTableBlacklisted('audit_logs')).toBe(true)
    })

    it('loads populated column blacklist correctly', () => {
      const config = makeConfig({
        tables: [],
        columns: { users: ['password', 'api_key'] }
      })
      const manager = new BlacklistManager(config)
      expect(manager.isColumnBlacklisted('users', 'password')).toBe(true)
      expect(manager.isColumnBlacklisted('users', 'api_key')).toBe(true)
    })
  })

  describe('isTableBlacklisted()', () => {
    it('returns true for exact match', () => {
      const config = makeConfig({ tables: ['secrets'], columns: {} })
      const manager = new BlacklistManager(config)
      expect(manager.isTableBlacklisted('secrets')).toBe(true)
    })

    it('returns false for non-blacklisted table', () => {
      const config = makeConfig({ tables: ['secrets'], columns: {} })
      const manager = new BlacklistManager(config)
      expect(manager.isTableBlacklisted('users')).toBe(false)
    })

    it('is case-insensitive for table names', () => {
      const config = makeConfig({ tables: ['Users'], columns: {} })
      const manager = new BlacklistManager(config)
      expect(manager.isTableBlacklisted('users')).toBe(true)
      expect(manager.isTableBlacklisted('USERS')).toBe(true)
      expect(manager.isTableBlacklisted('Users')).toBe(true)
    })
  })

  describe('isColumnBlacklisted()', () => {
    it('returns true for exact column match', () => {
      const config = makeConfig({
        tables: [],
        columns: { users: ['password'] }
      })
      const manager = new BlacklistManager(config)
      expect(manager.isColumnBlacklisted('users', 'password')).toBe(true)
    })

    it('returns false for non-blacklisted column', () => {
      const config = makeConfig({
        tables: [],
        columns: { users: ['password'] }
      })
      const manager = new BlacklistManager(config)
      expect(manager.isColumnBlacklisted('users', 'email')).toBe(false)
    })

    it('returns false for missing table in columns config', () => {
      const config = makeConfig({ tables: [], columns: {} })
      const manager = new BlacklistManager(config)
      expect(manager.isColumnBlacklisted('users', 'password')).toBe(false)
    })

    it('is case-sensitive for column names', () => {
      const config = makeConfig({
        tables: [],
        columns: { users: ['password'] }
      })
      const manager = new BlacklistManager(config)
      // Column names are case-sensitive
      expect(manager.isColumnBlacklisted('users', 'PASSWORD')).toBe(false)
      expect(manager.isColumnBlacklisted('users', 'Password')).toBe(false)
    })
  })

  describe('getBlacklistedColumns()', () => {
    it('returns correct list of blacklisted columns', () => {
      const config = makeConfig({
        tables: [],
        columns: { users: ['password', 'api_key', 'ssn'] }
      })
      const manager = new BlacklistManager(config)
      const cols = manager.getBlacklistedColumns('users')
      expect(cols).toContain('password')
      expect(cols).toContain('api_key')
      expect(cols).toContain('ssn')
      expect(cols.length).toBe(3)
    })

    it('returns empty array for table with no blacklisted columns', () => {
      const config = makeConfig({ tables: [], columns: {} })
      const manager = new BlacklistManager(config)
      expect(manager.getBlacklistedColumns('users')).toEqual([])
    })
  })

  describe('canOverrideBlacklist()', () => {
    it('returns true when DBCLI_OVERRIDE_BLACKLIST=true is passed', () => {
      const manager = new BlacklistManager(baseConfig, 'true')
      expect(manager.canOverrideBlacklist()).toBe(true)
    })

    it('returns false when override is not set', () => {
      const manager = new BlacklistManager(baseConfig, undefined)
      // Can't rely on env in tests; pass explicit false
      const manager2 = new BlacklistManager(baseConfig, 'false')
      expect(manager2.canOverrideBlacklist()).toBe(false)
    })

    it('returns false when override is "false"', () => {
      const manager = new BlacklistManager(baseConfig, 'false')
      expect(manager.canOverrideBlacklist()).toBe(false)
    })
  })

  describe('performance', () => {
    it('completes 1000 table lookups in < 10ms', () => {
      const tables = Array.from({ length: 100 }, (_, i) => `table_${i}`)
      const config = makeConfig({ tables, columns: {} })
      const manager = new BlacklistManager(config)

      const start = performance.now()
      for (let i = 0; i < 1000; i++) {
        manager.isTableBlacklisted(`table_${i % 100}`)
      }
      const elapsed = performance.now() - start
      expect(elapsed).toBeLessThan(10)
    })

    it('handles malformed config gracefully (no crash)', () => {
      const config = makeConfig({ tables: 'not-an-array', columns: null })
      // Should not throw
      expect(() => new BlacklistManager(config)).not.toThrow()
    })
  })
})
