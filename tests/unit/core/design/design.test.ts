import { describe, expect, test } from 'bun:test'
import {
  compileDesignSchema,
  parseDesignSpec,
  reviewDesign,
  DesignValidationError,
} from '@/core/design'
import { compareNormalized } from '@/core/orm-drift/compare'

const valid = {
  version: 1,
  dialect: 'postgresql',
  models: [
    {
      name: 'customers',
      table: 'customers',
      fields: [
        { name: 'id', type: 'uuid', nullable: false, primaryKey: true },
        { name: 'email', type: 'varchar(320)', nullable: false, unique: true },
      ],
    },
    {
      name: 'orders',
      table: 'orders',
      fields: [
        { name: 'id', type: 'uuid', nullable: false, primaryKey: true },
        { name: 'customer_id', type: 'uuid', nullable: false },
        { name: 'created_at', type: 'timestamp', nullable: false },
      ],
      indexes: [{ columns: ['customer_id', 'created_at'] }],
    },
  ],
  relationships: [
    {
      name: 'order-customer',
      from: { model: 'orders', field: 'customer_id' },
      to: { model: 'customers', field: 'id' },
      cardinality: 'many-to-one',
    },
  ],
  accessPatterns: [{ model: 'orders', filters: ['customer_id'], sort: ['created_at'] }],
  decisions: [],
}

describe('design artifact', () => {
  test('parses and reviews a complete SQL design without findings', () => {
    const spec = parseDesignSpec(valid)
    expect(reviewDesign(spec)).toEqual({ findings: [], summary: { errors: 0, warns: 0, infos: 0 } })
  })

  test('rejects unbounded SQL or connection data in descriptions and unknown fields', () => {
    expect(() =>
      parseDesignSpec({
        ...valid,
        models: [{ ...valid.models[0], description: 'SELECT * FROM customers' }],
      })
    ).toThrow(DesignValidationError)
    expect(() =>
      parseDesignSpec({ ...valid, connection: 'postgres://secret@host/db' })
    ).toThrow(DesignValidationError)
  })

  test('reports physical relationship and access-pattern design errors deterministically', () => {
    const spec = parseDesignSpec({
      ...valid,
      models: [
        ...valid.models,
        {
          name: 'profiles',
          table: 'profiles',
          fields: [
            { name: 'id', type: 'uuid', nullable: false, primaryKey: true },
            { name: 'customer_id', type: 'varchar(36)', nullable: false },
          ],
        },
      ],
      relationships: [
        ...valid.relationships,
        {
          name: 'profile-customer',
          from: { model: 'profiles', field: 'customer_id' },
          to: { model: 'customers', field: 'id' },
          cardinality: 'one-to-one',
        },
        {
          name: 'customer-products',
          from: { model: 'customers', field: 'id' },
          to: { model: 'orders', field: 'id' },
          cardinality: 'many-to-many',
        },
      ],
      accessPatterns: [{ model: 'orders', filters: ['created_at'], sort: ['customer_id'] }],
    })

    expect(reviewDesign(spec).findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'ONE_TO_ONE_REQUIRES_UNIQUE_FK', severity: 'error' }),
        expect.objectContaining({ code: 'RELATIONSHIP_TYPE_MISMATCH', severity: 'error' }),
        expect.objectContaining({ code: 'MANY_TO_MANY_REQUIRES_BRIDGE', severity: 'error' }),
        expect.objectContaining({ code: 'ACCESS_PATTERN_INDEX', severity: 'warn' }),
      ])
    )
  })

  test('compiles the design to the shared normalized-schema shape', () => {
    const compiled = compileDesignSchema(parseDesignSpec(valid))
    expect(compiled).toMatchObject({
      source: 'json',
      defaultSchema: 'public',
      tables: [
        expect.objectContaining({ identity: { table: 'customers' } }),
        expect.objectContaining({
          identity: { table: 'orders' },
          foreignKeys: [
            {
              columns: ['customer_id'],
              refTable: { table: 'customers' },
              refColumns: ['id'],
            },
          ],
        }),
      ],
    })
  })

  test('surfaces foreign-key drift rather than silently dropping a design relationship', () => {
    const desired = compileDesignSchema(parseDesignSpec(valid))
    const actual = {
      ...desired,
      source: 'db' as const,
      tables: desired.tables.map((table) => ({ ...table, foreignKeys: [] })),
    }
    const report = compareNormalized(desired, actual, { ignore: [] })
    expect(report.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: 'missing_in_db',
          object: 'foreign key (customer_id)',
        }),
      ])
    )
  })
})
