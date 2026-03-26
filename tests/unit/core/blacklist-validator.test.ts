/**
 * BlacklistValidator unit tests
 */

import { describe, it, expect, beforeEach } from 'bun:test'
import { BlacklistManager } from '@/core/blacklist-manager'
import { BlacklistValidator } from '@/core/blacklist-validator'
import { BlacklistError } from '@/types/blacklist'
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

function makeValidator(blacklist?: any, overrideEnv?: string): BlacklistValidator {
  const manager = new BlacklistManager(makeConfig(blacklist), overrideEnv)
  return new BlacklistValidator(manager)
}

describe('BlacklistValidator', () => {
  describe('checkTableBlacklist()', () => {
    it('allows non-blacklisted table without throwing', () => {
      const validator = makeValidator({ tables: ['secrets'], columns: {} })
      expect(() => validator.checkTableBlacklist('SELECT', 'users', [])).not.toThrow()
    })

    it('throws BlacklistError for SELECT on blacklisted table', () => {
      const validator = makeValidator({ tables: ['audit_logs'], columns: {} })
      expect(() => validator.checkTableBlacklist('SELECT', 'audit_logs', [])).toThrow(BlacklistError)
    })

    it('throws BlacklistError for INSERT on blacklisted table', () => {
      const validator = makeValidator({ tables: ['audit_logs'], columns: {} })
      expect(() => validator.checkTableBlacklist('INSERT', 'audit_logs', [])).toThrow(BlacklistError)
    })

    it('throws BlacklistError for UPDATE on blacklisted table', () => {
      const validator = makeValidator({ tables: ['audit_logs'], columns: {} })
      expect(() => validator.checkTableBlacklist('UPDATE', 'audit_logs', [])).toThrow(BlacklistError)
    })

    it('throws BlacklistError for DELETE on blacklisted table', () => {
      const validator = makeValidator({ tables: ['audit_logs'], columns: {} })
      expect(() => validator.checkTableBlacklist('DELETE', 'audit_logs', [])).toThrow(BlacklistError)
    })

    it('error message includes table name and operation', () => {
      const validator = makeValidator({ tables: ['audit_logs'], columns: {} })
      try {
        validator.checkTableBlacklist('SELECT', 'audit_logs', [])
        expect(true).toBe(false) // should not reach
      } catch (e) {
        expect(e).toBeInstanceOf(BlacklistError)
        const err = e as BlacklistError
        expect(err.message).toContain('audit_logs')
        expect(err.message).toContain('SELECT')
        expect(err.tableName).toBe('audit_logs')
        expect(err.operation).toBe('SELECT')
      }
    })

    it('allows operation on blacklisted table when override is enabled', () => {
      const validator = makeValidator({ tables: ['audit_logs'], columns: {} }, 'true')
      // Should not throw
      expect(() => validator.checkTableBlacklist('SELECT', 'audit_logs', [])).not.toThrow()
    })
  })

  describe('filterColumns()', () => {
    it('returns all columns for non-blacklisted table', () => {
      const validator = makeValidator({ tables: [], columns: {} })
      const rows = [{ id: 1, name: 'Alice', email: 'alice@example.com' }]
      const { filteredRows, omittedColumns } = validator.filterColumns('users', rows, ['id', 'name', 'email'])
      expect(filteredRows).toEqual(rows)
      expect(omittedColumns).toEqual([])
    })

    it('removes one blacklisted column correctly', () => {
      const validator = makeValidator({ tables: [], columns: { users: ['password'] } })
      const rows = [{ id: 1, name: 'Alice', password: 'secret' }]
      const { filteredRows, omittedColumns } = validator.filterColumns('users', rows, ['id', 'name', 'password'])
      expect(omittedColumns).toEqual(['password'])
      expect(filteredRows[0]).not.toHaveProperty('password')
      expect(filteredRows[0]).toHaveProperty('id', 1)
      expect(filteredRows[0]).toHaveProperty('name', 'Alice')
    })

    it('removes multiple blacklisted columns', () => {
      const validator = makeValidator({ tables: [], columns: { users: ['password', 'api_key'] } })
      const rows = [{ id: 1, name: 'Alice', password: 'secret', api_key: 'key123' }]
      const { filteredRows, omittedColumns } = validator.filterColumns('users', rows, ['id', 'name', 'password', 'api_key'])
      expect(omittedColumns).toContain('password')
      expect(omittedColumns).toContain('api_key')
      expect(omittedColumns.length).toBe(2)
      expect(filteredRows[0]).not.toHaveProperty('password')
      expect(filteredRows[0]).not.toHaveProperty('api_key')
    })

    it('handles empty rows array', () => {
      const validator = makeValidator({ tables: [], columns: { users: ['password'] } })
      const { filteredRows, omittedColumns } = validator.filterColumns('users', [], ['id', 'password'])
      expect(filteredRows).toEqual([])
      expect(omittedColumns).toEqual(['password'])
    })

    it('preserves row data integrity (immutable - does not mutate original)', () => {
      const validator = makeValidator({ tables: [], columns: { users: ['password'] } })
      const originalRows = [{ id: 1, name: 'Alice', password: 'secret' }]
      const rowsCopy = JSON.parse(JSON.stringify(originalRows))
      validator.filterColumns('users', originalRows, ['id', 'name', 'password'])
      // Original rows should not be mutated
      expect(originalRows).toEqual(rowsCopy)
    })
  })

  describe('buildSecurityNotification()', () => {
    it('returns empty string when no columns omitted', () => {
      const validator = makeValidator({ tables: [], columns: {} })
      const notification = validator.buildSecurityNotification('users', [])
      expect(notification).toBe('')
    })

    it('returns notification with count=1', () => {
      const validator = makeValidator({ tables: [], columns: {} })
      const notification = validator.buildSecurityNotification('users', ['password'])
      expect(notification).toContain('1')
      expect(notification.length).toBeGreaterThan(0)
    })

    it('returns notification with count=2+', () => {
      const validator = makeValidator({ tables: [], columns: {} })
      const notification = validator.buildSecurityNotification('users', ['password', 'api_key'])
      expect(notification).toContain('2')
    })

    it('uses i18n t_vars() (returns non-empty string for omitted columns)', () => {
      const validator = makeValidator({ tables: [], columns: {} })
      const notification = validator.buildSecurityNotification('users', ['password'])
      // Should be a proper i18n message, not just the key
      expect(notification).not.toBe('security.columns_omitted')
    })
  })
})
