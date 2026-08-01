import { describe, expect, test } from 'bun:test'
import {
  parseFieldSelection,
  projectRows,
  toMongoProjection,
} from '@/core/field-projection'

describe('field projection parser', () => {
  test('parses include and exclude lists in requested order', () => {
    expect(parseFieldSelection(' id, name,created_at ')).toEqual({
      mode: 'include',
      paths: ['id', 'name', 'created_at'],
    })
    expect(parseFieldSelection('-raw,-payload')).toEqual({
      mode: 'exclude',
      paths: ['raw', 'payload'],
    })
  })

  test('rejects empty, mixed, duplicate, and invalid dotted paths', () => {
    for (const raw of ['', 'a,', 'a,-b', 'a,a', '-', 'profile..email']) {
      expect(() => parseFieldSelection(raw)).toThrow()
    }
  })

  test('rejects prototype-polluting path segments', () => {
    for (const raw of ['__proto__', 'profile.constructor.email', '-profile.prototype']) {
      expect(() => parseFieldSelection(raw)).toThrow('unsafe')
    }
  })
})

describe('projectRows', () => {
  test('includes requested fields and order without mutating input', () => {
    const rows = [{ id: 1, name: 'Ada', extra: true }]
    const projected = projectRows(rows, { mode: 'include', paths: ['name', 'id'] })
    expect(projected).toEqual({
      rows: [{ name: 'Ada', id: 1 }],
      columnNames: ['name', 'id'],
    })
    expect(rows).toEqual([{ id: 1, name: 'Ada', extra: true }])
  })

  test('flattens dotted inclusion paths and traverses arrays', () => {
    const projected = projectRows(
      [{ profile: { email: 'a@example.com' }, items: [{ sku: 'a' }, { sku: 'b' }] }],
      { mode: 'include', paths: ['profile.email', 'items.sku'] }
    )
    expect(projected.rows).toEqual([
      { 'profile.email': 'a@example.com', 'items.sku': ['a', 'b'] },
    ])
    expect(projected.columnNames).toEqual(['profile.email', 'items.sku'])
  })

  test('prefers an exact dotted row key over nested traversal', () => {
    const projected = projectRows(
      [{ 'profile.email': 'alias', profile: { email: 'nested' } }],
      { mode: 'include', paths: ['profile.email'] }
    )
    expect(projected.rows).toEqual([{ 'profile.email': 'alias' }])
  })

  test('excludes top-level and dotted nested fields immutably', () => {
    const rows = [
      { id: 1, secret: 'x', profile: { email: 'a@example.com', name: 'Ada' } },
    ]
    const projected = projectRows(rows, {
      mode: 'exclude',
      paths: ['secret', 'profile.email'],
    })
    expect(projected.rows).toEqual([{ id: 1, profile: { name: 'Ada' } }])
    expect(projected.columnNames).toEqual(['id', 'profile'])
    expect(rows[0]!.profile).toEqual({ email: 'a@example.com', name: 'Ada' })
  })

  test('excludes both flattened and nested representations of one dotted path', () => {
    const rows = [
      {
        'profile.email': 'flattened@example.com',
        profile: { email: 'nested@example.com', city: 'Taipei' },
      },
    ]

    const projected = projectRows(rows, {
      mode: 'exclude',
      paths: ['profile.email'],
    })

    expect(projected.rows).toEqual([{ profile: { city: 'Taipei' } }])
    expect(rows).toEqual([
      {
        'profile.email': 'flattened@example.com',
        profile: { email: 'nested@example.com', city: 'Taipei' },
      },
    ])
  })

  test('normalizes sparse inclusion keys for JSON and preserves non-plain values', () => {
    const date = new Date('2026-08-01T00:00:00Z')
    const projected = projectRows([{ id: 1, date }, { id: 2 }], {
      mode: 'include',
      paths: ['date', 'missing'],
    })
    expect(Object.keys(projected.rows[1]!)).toEqual(['date', 'missing'])
    expect(projected.rows[0]!.date).toBe(date)
    expect(projected.rows[0]!.missing).toBeNull()
    expect(projected.rows[1]).toEqual({ date: null, missing: null })

    const serialized = JSON.parse(JSON.stringify(projected)) as typeof projected
    for (const row of serialized.rows) {
      expect(Object.keys(row)).toEqual(serialized.columnNames)
    }
  })

  test('normalizes sparse exclusion rows to the projected column union', () => {
    const projected = projectRows(
      [{ id: 1, secret: 'x' }, { id: 2, name: 'Ada', secret: 'y' }],
      { mode: 'exclude', paths: ['secret'] }
    )

    expect(projected).toEqual({
      rows: [
        { id: 1, name: null },
        { id: 2, name: 'Ada' },
      ],
      columnNames: ['id', 'name'],
    })
    for (const row of JSON.parse(JSON.stringify(projected.rows)) as Record<string, unknown>[]) {
      expect(Object.keys(row)).toEqual(projected.columnNames)
    }
  })
})

describe('toMongoProjection', () => {
  test('includes requested fields and excludes _id unless explicit', () => {
    expect(toMongoProjection({ mode: 'include', paths: ['name', 'profile.email'] })).toEqual({
      name: 1,
      'profile.email': 1,
      _id: 0,
    })
    expect(toMongoProjection({ mode: 'include', paths: ['_id', 'name'] })).toEqual({
      _id: 1,
      name: 1,
    })
  })

  test('excludes requested fields without changing _id', () => {
    expect(toMongoProjection({ mode: 'exclude', paths: ['raw', 'profile.secret'] })).toEqual({
      raw: 0,
      'profile.secret': 0,
    })
  })
})
