import { describe, it, expect } from 'vitest'
import { compareSnapshots, type SchemaSnapshot } from './diff'

describe('compareSnapshots', () => {
  const before: SchemaSnapshot = {
    tables: {
      users: {
        name: 'users',
        columns: [
          { name: 'id', type: 'bigint', nullable: false, primaryKey: true },
          { name: 'email', type: 'varchar(100)', nullable: false },
          { name: 'old_field', type: 'text', nullable: true },
        ],
        indexes: [{ name: 'uq_email', columns: ['email'], unique: true }],
      },
    },
    createdAt: '2026-03-25T00:00:00Z',
  }

  const after: SchemaSnapshot = {
    tables: {
      users: {
        name: 'users',
        columns: [
          { name: 'id', type: 'bigint', nullable: false, primaryKey: true },
          { name: 'email', type: 'varchar(255)', nullable: true },
          { name: 'phone', type: 'varchar(20)', nullable: true },
        ],
        indexes: [
          { name: 'uq_email', columns: ['email'], unique: true },
          { name: 'idx_phone', columns: ['phone'], unique: false },
        ],
      },
      orders: {
        name: 'orders',
        columns: [{ name: 'id', type: 'bigint', nullable: false }],
        indexes: [],
      },
    },
    createdAt: '2026-03-26T00:00:00Z',
  }

  it('detects added tables', () => {
    const result = compareSnapshots(before, after)
    expect(result.added.tables).toContain('orders')
  })

  it('detects removed columns', () => {
    const result = compareSnapshots(before, after)
    expect(result.removed.columns).toContainEqual({
      table: 'users',
      column: 'old_field',
      type: 'text',
    })
  })

  it('detects added columns', () => {
    const result = compareSnapshots(before, after)
    expect(result.added.columns).toContainEqual(
      expect.objectContaining({ table: 'users', column: 'phone' })
    )
  })

  it('detects modified columns', () => {
    const result = compareSnapshots(before, after)
    expect(result.modified.columns).toContainEqual(
      expect.objectContaining({ table: 'users', column: 'email' })
    )
  })

  it('detects added indexes', () => {
    const result = compareSnapshots(before, after)
    expect(result.modified.indexes).toContainEqual(
      expect.objectContaining({ table: 'users', name: 'idx_phone', change: 'added' })
    )
  })

  it('computes correct summary', () => {
    const result = compareSnapshots(before, after)
    expect(result.summary.added).toBeGreaterThan(0)
    expect(result.summary.modified).toBeGreaterThan(0)
  })
})
