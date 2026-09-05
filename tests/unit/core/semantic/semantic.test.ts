import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  inspectSemanticDrift,
  loadSemanticContext,
  migrateSemanticContext,
  searchSemanticContext,
  SemanticSearchError,
  SemanticValidationError,
  type SemanticSchemaTable,
} from '@/core/semantic'

const schema: Record<string, SemanticSchemaTable> = {
  orders: { columns: [{ name: 'id' }, { name: 'total' }, { name: 'created_at' }] },
  customers: { columns: [{ name: 'id' }, { name: 'email' }] },
}
const snippets = [{ key: '@analytics/revenue' }]
const workspaces: string[] = []

function workspace(): string {
  const path = mkdtempSync(join(tmpdir(), 'dbcli-semantic-'))
  workspaces.push(path)
  return path
}

async function writeSemantic(root: string, value: unknown): Promise<string> {
  const path = join(root, 'dbcli.semantic.json')
  await Bun.file(path).write(JSON.stringify(value, null, 2))
  return path
}

const valid = {
  version: 1,
  models: [
    {
      name: 'orders',
      table: 'orders',
      description: 'Completed purchases.',
      aliases: ['purchases'],
      fields: [{ column: 'created_at', aliases: ['order date'] }],
    },
  ],
  metrics: [{ name: 'daily-revenue', description: 'Revenue by day.', query: '@analytics/revenue' }],
}

afterEach(() => {
  for (const path of workspaces.splice(0)) rmSync(path, { recursive: true, force: true })
})

describe('semantic context', () => {
  test('loads a bounded context from visible schema and saved query names', async () => {
    const root = workspace()
    await writeSemantic(root, valid)

    await expect(loadSemanticContext({ workspaceRoot: root, schema, snippets })).resolves.toEqual({
      version: 1,
      models: [
        {
          name: 'orders',
          table: 'orders',
          description: 'Completed purchases.',
          aliases: ['purchases'],
          fields: [{ column: 'created_at', aliases: ['order date'] }],
        },
      ],
      relationships: [],
      metrics: [
        { name: 'daily-revenue', description: 'Revenue by day.', query: '@analytics/revenue' },
      ],
    })
  })

  test('loads v2 relationships only through declared, visible model fields', async () => {
    const root = workspace()
    await writeSemantic(root, {
      version: 2,
      models: [
        { name: 'orders', table: 'orders', fields: [{ column: 'id' }, { column: 'total' }] },
        { name: 'customers', table: 'customers', fields: [{ column: 'id' }] },
      ],
      relationships: [
        {
          name: 'order-customer',
          from: { model: 'orders', field: 'id' },
          to: { model: 'customers', field: 'id' },
          cardinality: 'many-to-one',
          description: 'Each order belongs to one customer.',
        },
      ],
      metrics: [],
    })

    await expect(
      loadSemanticContext({ workspaceRoot: root, schema, snippets })
    ).resolves.toMatchObject({
      version: 2,
      relationships: [
        expect.objectContaining({
          name: 'order-customer',
          cardinality: 'many-to-one',
          from: { model: 'orders', field: 'id' },
          to: { model: 'customers', field: 'id' },
        }),
      ],
    })
  })

  test('enforces the semantic context version boundary', async () => {
    const root = workspace()

    await writeSemantic(root, { ...valid, relationships: [] })
    await expect(
      loadSemanticContext({ workspaceRoot: root, schema, snippets })
    ).rejects.toMatchObject({
      issues: expect.arrayContaining([
        expect.objectContaining({ path: '$', message: 'contains an unknown property' }),
      ]),
    })

    for (const context of [
      { ...valid, version: 3 },
      { ...valid, version: '2' },
      { models: valid.models, metrics: valid.metrics },
    ]) {
      await writeSemantic(root, context)
      await expect(
        loadSemanticContext({ workspaceRoot: root, schema, snippets })
      ).rejects.toMatchObject({
        issues: expect.arrayContaining([
          expect.objectContaining({ path: '$.version', message: 'must equal 1 or 2' }),
        ]),
      })
    }

    await writeSemantic(root, { ...valid, version: 2, relationships: [] })
    await expect(
      migrateSemanticContext({ workspaceRoot: root, schema, snippets })
    ).rejects.toMatchObject({
      issues: [
        expect.objectContaining({
          path: '$.version',
          message: 'must equal 1 to migrate to version 2',
        }),
      ],
    })
  })

  test('rejects duplicate relationships and endpoints outside a declared model field', async () => {
    const root = workspace()
    await writeSemantic(root, {
      version: 2,
      models: [
        { name: 'orders', table: 'orders', fields: [{ column: 'id' }] },
        { name: 'customers', table: 'customers', fields: [{ column: 'id' }] },
      ],
      relationships: [
        {
          name: 'order-customer',
          from: { model: 'orders', field: 'total' },
          to: { model: 'customers', field: 'id' },
          cardinality: 'many-to-one',
        },
        {
          name: 'order-customer-copy',
          from: { model: 'orders', field: 'total' },
          to: { model: 'customers', field: 'id' },
          cardinality: 'many-to-one',
        },
      ],
      metrics: [],
    })

    await expect(
      loadSemanticContext({ workspaceRoot: root, schema, snippets })
    ).rejects.toMatchObject({
      issues: expect.arrayContaining([
        expect.objectContaining({ path: '$.relationships[0].from.field' }),
        expect.objectContaining({ path: '$.relationships[1]' }),
      ]),
    })
  })

  test('requires reversed relationships to document distinct business meanings', async () => {
    const root = workspace()
    await writeSemantic(root, {
      version: 2,
      models: [
        { name: 'orders', table: 'orders', fields: [{ column: 'id' }] },
        { name: 'customers', table: 'customers', fields: [{ column: 'id' }] },
      ],
      relationships: [
        {
          name: 'order-customer',
          from: { model: 'orders', field: 'id' },
          to: { model: 'customers', field: 'id' },
          cardinality: 'many-to-one',
          description: 'An order belongs to a customer.',
        },
        {
          name: 'customer-order',
          from: { model: 'customers', field: 'id' },
          to: { model: 'orders', field: 'id' },
          cardinality: 'one-to-many',
          description: 'An order belongs to a customer.',
        },
      ],
      metrics: [],
    })

    await expect(
      loadSemanticContext({ workspaceRoot: root, schema, snippets })
    ).rejects.toMatchObject({
      issues: expect.arrayContaining([
        expect.objectContaining({
          path: '$.relationships[1]',
          message: 'reverse relationships must have distinct descriptions',
        }),
      ]),
    })
  })

  test('rejects SQL, join conditions, and connection data in relationship descriptions', async () => {
    const root = workspace()
    await writeSemantic(root, {
      version: 2,
      models: [
        { name: 'orders', table: 'orders', fields: [{ column: 'id' }] },
        { name: 'customers', table: 'customers', fields: [{ column: 'id' }] },
      ],
      relationships: [
        {
          name: 'order-customer',
          from: { model: 'orders', field: 'id' },
          to: { model: 'customers', field: 'id' },
          cardinality: 'many-to-one',
          description: 'SELECT * FROM orders',
        },
      ],
      metrics: [],
    })

    await expect(
      loadSemanticContext({ workspaceRoot: root, schema, snippets })
    ).rejects.toMatchObject({
      issues: expect.arrayContaining([
        expect.objectContaining({
          path: '$.relationships[0].description',
          message: 'must not contain SQL, a join condition, or connection data',
        }),
      ]),
    })
  })

  test('reports invalid, stale, and unavailable drift without returning hidden identifiers', async () => {
    const root = workspace()
    await writeSemantic(root, {
      version: 2,
      models: [{ name: 'orders', table: 'orders', fields: [{ column: 'total' }] }],
      relationships: [],
      metrics: [{ name: 'daily-revenue', query: '@analytics/revenue' }],
    })

    await expect(
      inspectSemanticDrift({
        workspaceRoot: root,
        schema: { orders: { columns: [{ name: 'id' }] } },
        snippets: [],
      })
    ).resolves.toMatchObject({ status: 'stale', issues: expect.any(Array) })
    await expect(
      inspectSemanticDrift({
        workspaceRoot: root,
        schema: {},
        snippets: [],
        schemaAvailable: false,
      })
    ).resolves.toMatchObject({ status: 'unavailable' })

    await writeSemantic(root, {
      version: 2,
      models: [],
      relationships: [{ name: 'bad' }],
      metrics: [],
    })
    await expect(
      inspectSemanticDrift({ workspaceRoot: root, schema, snippets })
    ).resolves.toMatchObject({
      status: 'invalid',
    })
  })

  test('migrates a valid v1 context deterministically to v2 without writing the source file', async () => {
    const root = workspace()
    const filePath = await writeSemantic(root, valid)

    await expect(
      migrateSemanticContext({ workspaceRoot: root, schema, snippets })
    ).resolves.toMatchObject({
      version: 2,
      relationships: [],
    })
    await expect(Bun.file(filePath).json()).resolves.toEqual(valid)
  })

  test('searches governed entities with deterministic relevance and safe result fields', () => {
    const results = searchSemanticContext(
      {
        version: 2,
        models: [
          {
            name: 'orders',
            table: 'orders',
            description: 'Completed purchases.',
            aliases: ['purchases'],
            fields: [
              {
                column: 'created_at',
                description: 'Order creation time.',
                aliases: ['order date'],
              },
            ],
          },
          {
            name: 'customers',
            table: 'customers',
            aliases: [],
            fields: [{ column: 'email', aliases: [] }],
          },
        ],
        relationships: [
          {
            name: 'order-customer',
            from: { model: 'orders', field: 'created_at' },
            to: { model: 'customers', field: 'email' },
            cardinality: 'many-to-one',
            description: 'Each order belongs to a customer.',
          },
        ],
        metrics: [
          { name: 'daily-revenue', description: 'Revenue by day.', query: '@analytics/revenue' },
        ],
      },
      ['orders']
    )

    expect(results).toEqual([
      {
        kind: 'model',
        reference: 'orders',
        matchedTerms: ['orders'],
        description: 'Completed purchases.',
        aliases: ['purchases'],
      },
    ])
    expect(JSON.stringify(results)).not.toContain('@analytics/revenue')
  })

  test('search supports aliases, kind filtering, limits, and rejects invalid input', () => {
    const context = {
      version: 1 as const,
      models: [
        {
          name: 'orders',
          table: 'orders',
          aliases: ['purchases'],
          fields: [{ column: 'created_at', aliases: ['order date'] }],
        },
      ],
      relationships: [],
      metrics: [{ name: 'daily-revenue', query: '@analytics/revenue' }],
    }

    expect(searchSemanticContext(context, ['purchases'], { kind: 'model' })).toMatchObject([
      { kind: 'model', reference: 'orders', matchedTerms: ['purchases'] },
    ])
    expect(searchSemanticContext(context, ['order'], { limit: 1 })).toHaveLength(1)
    expect(() => searchSemanticContext(context, [])).toThrow(SemanticSearchError)
    expect(() => searchSemanticContext(context, ['orders'], { limit: 101 })).toThrow(
      SemanticSearchError
    )
  })

  test('search omits descriptions and aliases containing blocked names', () => {
    const results = searchSemanticContext(
      {
        version: 1,
        models: [
          {
            name: 'orders',
            table: 'orders',
            description: 'Includes password recovery purchases.',
            aliases: ['password orders', 'purchases'],
            fields: [],
          },
        ],
        relationships: [],
        metrics: [],
      },
      ['orders'],
      { blockedTerms: ['password'] }
    )

    expect(results).toEqual([
      { kind: 'model', reference: 'orders', matchedTerms: ['orders'], aliases: ['purchases'] },
    ])
    expect(JSON.stringify(results)).not.toContain('password')
  })

  test('search tokenizes multiword aliases and suppresses blocked canonical paths', () => {
    const context = {
      version: 1 as const,
      models: [
        {
          name: 'orders',
          table: 'orders',
          aliases: [],
          fields: [{ column: 'created_at', aliases: ['order date'] }],
        },
        { name: 'user_accounts', table: 'user_accounts', aliases: [], fields: [] },
      ],
      relationships: [],
      metrics: [],
    }

    expect(searchSemanticContext(context, ['date'])).toMatchObject([
      { kind: 'field', reference: 'orders.created_at', matchedTerms: ['date'] },
    ])
    expect(
      searchSemanticContext(context, ['user_accounts'], { blockedTerms: ['user_accounts'] })
    ).toEqual([])
    expect(searchSemanticContext(context, ['user'], { blockedTerms: ['user_accounts'] })).toEqual(
      []
    )
  })

  test('allows an absent default file only when requested', async () => {
    const root = workspace()

    await expect(
      loadSemanticContext({ workspaceRoot: root, schema, snippets, missingFile: 'allow' })
    ).resolves.toBeNull()
    await expect(
      loadSemanticContext({ workspaceRoot: root, schema, snippets })
    ).rejects.toBeInstanceOf(SemanticValidationError)
  })

  test('rejects malformed JSON before interpreting a semantic context', async () => {
    const root = workspace()
    await Bun.file(join(root, 'dbcli.semantic.json')).write('{not-json')

    await expect(
      loadSemanticContext({ workspaceRoot: root, schema, snippets })
    ).rejects.toMatchObject({
      issues: [expect.objectContaining({ path: '$' })],
    })
  })

  test('rejects unknown and blacklisted table or column references', async () => {
    const root = workspace()
    await writeSemantic(root, {
      ...valid,
      models: [
        { ...valid.models[0], table: 'users', fields: [{ column: 'password', aliases: [] }] },
        { ...valid.models[0], name: 'orders-copy', fields: [{ column: 'secret', aliases: [] }] },
      ],
    })

    await expect(
      loadSemanticContext({ workspaceRoot: root, schema, snippets })
    ).rejects.toMatchObject({
      issues: expect.arrayContaining([
        expect.objectContaining({ path: '$.models[0].table' }),
        expect.objectContaining({ path: '$.models[1].fields[0].column' }),
      ]),
    })
  })

  test('rejects unknown metrics, duplicate field columns, and unsupported properties', async () => {
    const root = workspace()
    await writeSemantic(root, {
      ...valid,
      unexpected: true,
      models: [
        {
          ...valid.models[0],
          fields: [
            { column: 'total', aliases: [] },
            { column: 'total', aliases: [] },
          ],
        },
      ],
      metrics: [{ ...valid.metrics[0], query: '@missing' }],
    })

    await expect(
      loadSemanticContext({ workspaceRoot: root, schema, snippets })
    ).rejects.toMatchObject({
      issues: expect.arrayContaining([
        expect.objectContaining({ path: '$', message: 'contains an unknown property' }),
        expect.objectContaining({
          path: '$.models[0].fields[1].column',
          message: 'must be unique',
        }),
        expect.objectContaining({ path: '$.metrics[0].query' }),
      ]),
    })
  })
})
