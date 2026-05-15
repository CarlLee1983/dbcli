import { describe, test, expect } from 'bun:test'
import { getOperationTarget, extractTableName } from '../../../src/utils/engine-hints'

describe('engine hints utils', () => {
  describe('extractTableName', () => {
    test('extracts from SELECT', () => {
      expect(extractTableName('SELECT * FROM users')).toBe('users')
      expect(extractTableName('SELECT * FROM "public"."orders"')).toBe('public') // First identifier
      expect(extractTableName('SELECT 1')).toBeNull()
    })

    test('extracts from INSERT/UPDATE/DELETE', () => {
      expect(extractTableName('INSERT INTO log ...')).toBe('log')
      expect(extractTableName('UPDATE settings SET ...')).toBe('settings')
      expect(extractTableName('DELETE FROM session')).toBe('session')
    })
  })

  describe('getOperationTarget', () => {
    test('resolves MongoDB collection', () => {
      expect(getOperationTarget('mongodb', 'query', { collection: 'users' })).toBe('users')
    })

    test('resolves Elasticsearch index', () => {
      expect(getOperationTarget('elasticsearch', 'query', { index: 'logs' })).toBe('logs')
      expect(getOperationTarget('elasticsearch', 'query', { collection: 'metrics' })).toBe(
        'metrics'
      )
    })

    test('resolves Redis key', () => {
      expect(getOperationTarget('redis', 'query', { table: 'user:1' })).toBe('user:1')
    })

    test('resolves SQL table from SQL string', () => {
      expect(getOperationTarget('postgresql', 'query', {}, 'SELECT * FROM products')).toBe(
        'products'
      )
    })
  })
})
