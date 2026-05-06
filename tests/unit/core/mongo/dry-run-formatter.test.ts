/**
 * MongoDryRunFormatter — pure preview-string formatters for mongo write ops.
 *
 * These previews surface in `--dry-run` output so a human can sanity-check
 * what would have been sent to mongo, in shell-flavored notation.
 */

import { describe, test, expect } from 'bun:test'
import { previewInsert, previewUpdate, previewDelete } from '@/core/mongo/dry-run-formatter'

describe('MongoDryRunFormatter', () => {
  describe('previewInsert', () => {
    test('formats an insertOne with pretty-printed JSON', () => {
      const out = previewInsert('users', { name: 'Alice', email: 'a@b.com' })
      expect(out).toBe('db.users.insertOne({\n  "name": "Alice",\n  "email": "a@b.com"\n})')
    })

    test('handles empty document', () => {
      expect(previewInsert('users', {})).toBe('db.users.insertOne({})')
    })

    test('handles nested document', () => {
      const out = previewInsert('orders', { id: 1, items: [{ sku: 'X' }] })
      expect(out).toContain('db.orders.insertOne(')
      expect(out).toContain('"items":')
      expect(out).toContain('"sku": "X"')
    })
  })

  describe('previewUpdate', () => {
    test('formats updateMany with $set wrap output', () => {
      const out = previewUpdate('users', { id: 1 }, { $set: { name: 'Bob' } })
      expect(out).toBe(
        'db.users.updateMany({\n  "id": 1\n}, {\n  "$set": {\n    "name": "Bob"\n  }\n})'
      )
    })

    test('handles replacement-style update doc', () => {
      const out = previewUpdate('users', { id: 1 }, { name: 'Bob' })
      expect(out).toContain('db.users.updateMany(')
      expect(out).toContain('"name": "Bob"')
    })

    test('handles complex filter and operator update', () => {
      const out = previewUpdate(
        'orders',
        { status: 'pending' },
        { $set: { status: 'shipped' }, $unset: { hold: '' } }
      )
      expect(out).toContain('"status": "shipped"')
      expect(out).toContain('"$unset"')
    })
  })

  describe('previewDelete', () => {
    test('formats deleteMany with pretty-printed filter', () => {
      const out = previewDelete('users', { id: 1 })
      expect(out).toBe('db.users.deleteMany({\n  "id": 1\n})')
    })

    test('handles complex filter', () => {
      const out = previewDelete('logs', { level: 'debug', age: { $lt: 30 } })
      expect(out).toContain('db.logs.deleteMany(')
      expect(out).toContain('"$lt": 30')
    })
  })
})
