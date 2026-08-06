import { describe, expect, test } from 'bun:test'
import { parseFieldSelection, projectRows, toMongoProjection } from '@/core/field-projection'

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
    expect(projected.rows).toEqual([{ 'profile.email': 'a@example.com', 'items.sku': ['a', 'b'] }])
    expect(projected.columnNames).toEqual(['profile.email', 'items.sku'])
  })

  test('prefers an exact dotted row key over nested traversal', () => {
    const projected = projectRows([{ 'profile.email': 'alias', profile: { email: 'nested' } }], {
      mode: 'include',
      paths: ['profile.email'],
    })
    expect(projected.rows).toEqual([{ 'profile.email': 'alias' }])
  })

  test('excludes top-level and dotted nested fields immutably', () => {
    const rows = [{ id: 1, secret: 'x', profile: { email: 'a@example.com', name: 'Ada' } }]
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

  test('excludes a mix of top-level, dotted, and array-nested paths in one pass', () => {
    // omitFieldPaths splits paths into top-level and dotted so it can rebuild a row
    // once instead of once per path. This pins the semantics that split must keep:
    // plain names, a literal dotted key, traversal into a nested record, and
    // traversal through an array all have to survive being handled together.
    const rows = [
      {
        id: 1,
        secret: 'top-level',
        'profile.email': 'literal dotted key',
        profile: { email: 'nested', city: 'Taipei' },
        orders: [
          { total: 10, card: 'a' },
          { total: 20, card: 'b' },
        ],
      },
    ]

    const projected = projectRows(rows, {
      mode: 'exclude',
      paths: ['secret', 'profile.email', 'orders.card', 'absent', 'nope.here'],
    })

    expect(projected.rows).toEqual([
      {
        id: 1,
        profile: { city: 'Taipei' },
        orders: [{ total: 10 }, { total: 20 }],
      },
    ])
    expect(projected.columnNames).toEqual(['id', 'profile', 'orders'])
    // Input untouched — the projection must copy, never mutate.
    expect(rows[0]!.secret).toBe('top-level')
    expect(rows[0]!['profile.email']).toBe('literal dotted key')
    expect(rows[0]!.orders).toEqual([
      { total: 10, card: 'a' },
      { total: 20, card: 'b' },
    ])
  })

  test('excluding a parent and its child is order-independent across the split', () => {
    // A top-level path and a dotted path sharing a head land in different buckets,
    // so the split changes the order they are applied in. That is only safe because
    // omission never creates a key; both orders must still collapse the whole parent.
    const rows = [{ id: 1, profile: { email: 'a@example.com', city: 'Taipei' } }]

    for (const paths of [
      ['profile', 'profile.email'],
      ['profile.email', 'profile'],
    ]) {
      const projected = projectRows(rows, { mode: 'exclude', paths })
      expect(projected.rows).toEqual([{ id: 1 }])
    }
  })

  test('excludes a prototype-polluting key without touching Object.prototype', () => {
    const rows = [Object.assign(Object.create(null), { __proto__: 'x', safe: 1 })]

    const projected = projectRows(rows, { mode: 'exclude', paths: ['__proto__'] })

    expect(projected.rows).toEqual([{ safe: 1 }])
    expect(Object.getPrototypeOf({})).toBe(Object.prototype)
    expect((Object.prototype as Record<string, unknown>).safe).toBeUndefined()
  })

  test('an empty-string path excludes the empty-string key and nothing else', () => {
    const rows = [{ '': 'blank', id: 1 }]

    const projected = projectRows(rows, { mode: 'exclude', paths: [''] })

    expect(projected.rows).toEqual([{ id: 1 }])
  })

  test('exclusion never emits a non-record row for callers to index into', () => {
    // Include mode already coerces a null row into a normalised record; exclusion
    // used to be the one path that leaked `null` into a Record<string, unknown>[].
    const projected = projectRows([null as any, { a: 1, b: 2 }], {
      mode: 'exclude',
      paths: ['b'],
    })

    expect(projected.rows).toEqual([{ a: null }, { a: 1 }])
    expect(projected.columnNames).toEqual(['a'])
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
      [
        { id: 1, secret: 'x' },
        { id: 2, name: 'Ada', secret: 'y' },
      ],
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
