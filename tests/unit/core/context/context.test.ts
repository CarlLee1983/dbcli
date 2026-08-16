import { test, expect, describe, beforeEach, afterEach } from 'bun:test'
import { join } from 'node:path'
import { existsSync, rmSync, mkdirSync } from 'node:fs'
import { gatherContext } from '@/core/context/context'
import { serializeJson, serializeXml, serializeMarkdown } from '@/core/context/serializer'

const TEST_WORKSPACE = join(__dirname, 'tmp-workspace')
const TEST_CONFIG_PATH = join(TEST_WORKSPACE, 'config.json')

describe('Context and Serializer', () => {
  beforeEach(() => {
    if (existsSync(TEST_WORKSPACE)) {
      rmSync(TEST_WORKSPACE, { recursive: true, force: true })
    }
    mkdirSync(TEST_WORKSPACE, { recursive: true })
    mkdirSync(join(TEST_WORKSPACE, '.dbcli', 'queries'), { recursive: true })
  })

  afterEach(() => {
    if (existsSync(TEST_WORKSPACE)) {
      rmSync(TEST_WORKSPACE, { recursive: true, force: true })
    }
  })

  test('gatherContext loads metadata, schemas, and queries successfully', async () => {
    const configContent = {
      connection: {
        system: 'postgresql',
        host: 'localhost',
        port: 5432,
        user: 'user',
        password: 'pass',
        database: 'testdb',
      },
      permission: 'read-write',
      metadata: {
        version: '1.2.3',
      },
      blacklist: {
        tables: ['audit_logs'],
        columns: {
          users: ['password', 'ssn'],
        },
      },
      schema: {
        users: {
          name: 'users',
          columns: [
            { name: 'id', type: 'integer', nullable: false, primaryKey: true },
            { name: 'username', type: 'varchar(255)', nullable: false },
            { name: 'password', type: 'varchar(255)', nullable: false },
            { name: 'ssn', type: 'varchar(11)', nullable: true },
          ],
          primaryKey: ['id'],
          estimatedRowCount: 120,
        },
        orders: {
          name: 'orders',
          columns: [
            { name: 'id', type: 'integer', nullable: false, primaryKey: true },
            {
              name: 'user_id',
              type: 'integer',
              nullable: false,
              foreignKey: { table: 'users', column: 'id' },
            },
            { name: 'total', type: 'numeric', nullable: false, default: '0.00' },
          ],
          primaryKey: ['id'],
          foreignKeys: [
            {
              columns: ['user_id'],
              refTable: 'users',
              refColumns: ['id'],
            },
          ],
          rowCount: 450,
        },
        audit_logs: {
          name: 'audit_logs',
          columns: [
            { name: 'id', type: 'integer', nullable: false, primaryKey: true },
            { name: 'action', type: 'varchar(255)', nullable: false },
          ],
        },
      },
    }

    await Bun.file(TEST_CONFIG_PATH).write(JSON.stringify(configContent, null, 2))

    // Write a test snippet
    const snippetContent = `-- ---
-- name: Active Users
-- description: Get all active users
-- params:
--   min_id:
--     type: int
--     required: false
--     default: 1
-- ---
SELECT * FROM users WHERE id >= :min_id AND active = true`

    await Bun.file(join(TEST_WORKSPACE, '.dbcli', 'queries', 'active-users.sql')).write(
      snippetContent
    )

    const payload = await gatherContext(TEST_WORKSPACE, TEST_CONFIG_PATH)

    // Verify metadata
    expect(payload.version).toBe('1.2.3')
    expect(payload.system).toBe('postgresql')
    expect(payload.permission).toBe('read-write')

    // Verify blacklist
    expect(payload.blacklist.tables).toContain('audit_logs')
    expect(payload.blacklist.columns.users).toContain('password')
    expect(payload.blacklist.columns.users).toContain('ssn')

    // Verify schema loading & filters
    expect(payload.schema.audit_logs).toBeUndefined() // completely blacklisted table
    expect(payload.schema.users).toBeDefined()
    expect(payload.schema.users!.name).toBe('users')
    expect(payload.schema.users!.rowCount).toBe(120)
    expect(payload.schema.users!.primaryKey).toEqual(['id'])

    // Check that blacklisted columns inside active tables are filtered out
    const userColumns = payload.schema.users!.columns.map((c) => c.name)
    expect(userColumns).toContain('id')
    expect(userColumns).toContain('username')
    expect(userColumns).not.toContain('password')
    expect(userColumns).not.toContain('ssn')

    // Check order columns & default values & foreign keys
    expect(payload.schema.orders).toBeDefined()
    expect(payload.schema.orders!.rowCount).toBe(450)
    const orderTotalCol = payload.schema.orders!.columns.find((c) => c.name === 'total')
    expect(orderTotalCol?.default).toBe('0.00')

    const orderUserIdCol = payload.schema.orders!.columns.find((c) => c.name === 'user_id')
    expect(orderUserIdCol?.foreignKey).toEqual({ table: 'users', column: 'id' })
    expect(payload.schema.orders!.foreignKeys).toEqual([
      {
        columns: ['user_id'],
        refTable: 'users',
        refColumns: ['id'],
      },
    ])

    // Verify snippets are loaded
    expect(payload.snippets.length).toBeGreaterThanOrEqual(1)
    const activeUsersSnippet = payload.snippets.find((s) => s.key === '@active-users')
    expect(activeUsersSnippet).toBeDefined()
    expect(activeUsersSnippet?.description).toBe('Get all active users')
    expect(activeUsersSnippet?.params).toEqual([{ name: 'min_id', type: 'int', default: 1 }])
  })

  test('gatherContext includes only a validated project semantic context', async () => {
    await Bun.file(TEST_CONFIG_PATH).write(
      JSON.stringify({
        connection: {
          system: 'postgresql',
          host: 'localhost',
          port: 5432,
          user: 'user',
          password: 'pass',
          database: 'app',
        },
        schema: {
          orders: {
            name: 'orders',
            columns: [{ name: 'created_at', type: 'timestamp', nullable: false }],
          },
        },
      })
    )
    await Bun.file(join(TEST_WORKSPACE, 'dbcli.semantic.json')).write(
      JSON.stringify({
        version: 1,
        models: [
          {
            name: 'orders',
            table: 'orders',
            fields: [{ column: 'created_at', aliases: ['order date'] }],
          },
        ],
        metrics: [],
      })
    )

    const payload = await gatherContext(TEST_WORKSPACE, TEST_CONFIG_PATH)

    expect(payload.semantic).toEqual({
      version: 1,
      models: [
        {
          name: 'orders',
          table: 'orders',
          aliases: [],
          fields: [{ column: 'created_at', aliases: ['order date'] }],
        },
      ],
      relationships: [],
      metrics: [],
    })
    expect(JSON.parse(serializeJson(payload)).semantic.models[0].table).toBe('orders')
    expect(serializeXml(payload)).toContain('<semantic_context version="1">')
    expect(serializeMarkdown(payload)).toContain('## Business Semantic Context')
  })

  test('gatherContext exposes only approved valid semantic contracts', async () => {
    await Bun.file(TEST_CONFIG_PATH).write(
      JSON.stringify({
        connection: {
          system: 'postgresql',
          host: 'localhost',
          port: 5432,
          user: 'user',
          password: 'pass',
          database: 'app',
        },
        schema: {
          orders: {
            name: 'orders',
            columns: [{ name: 'created_at', type: 'timestamp', nullable: false }],
          },
        },
      })
    )
    await Bun.file(join(TEST_WORKSPACE, 'dbcli.semantic.json')).write(
      JSON.stringify({
        version: 1,
        models: [{ name: 'orders', table: 'orders', fields: [{ column: 'created_at' }] }],
        metrics: [],
      })
    )
    await Bun.file(join(TEST_WORKSPACE, 'dbcli.contracts.json')).write(
      JSON.stringify({
        version: 1,
        contracts: [
          {
            name: 'active-customer',
            status: 'approved',
            description: 'A customer with a recent paid order.',
            subjects: ['model:orders'],
            owner: 'growth',
            evidencePolicy: 'verification-required',
          },
          {
            name: 'future-customer',
            status: 'draft',
            description: 'A term still under review.',
            subjects: ['model:orders'],
            owner: 'growth',
            evidencePolicy: 'none',
          },
        ],
      })
    )

    const payload = await gatherContext(TEST_WORKSPACE, TEST_CONFIG_PATH)

    expect(payload.contracts).toEqual([
      {
        name: 'active-customer',
        status: 'approved',
        description: 'A customer with a recent paid order.',
        subjects: ['model:orders'],
        owner: 'growth',
        aliases: [],
        evidencePolicy: 'verification-required',
      },
    ])
    expect(JSON.parse(serializeJson(payload)).contracts).toHaveLength(1)
    expect(serializeXml(payload)).toContain('<semantic_contracts>')
    expect(serializeMarkdown(payload)).toContain('## Approved Semantic Contracts')
  })

  test('gatherContext fails closed when contracts exist without semantic evidence', async () => {
    await Bun.file(TEST_CONFIG_PATH).write(
      JSON.stringify({
        connection: {
          system: 'postgresql',
          host: 'localhost',
          port: 5432,
          user: 'user',
          password: 'pass',
          database: 'app',
        },
        schema: {
          orders: {
            name: 'orders',
            columns: [{ name: 'created_at', type: 'timestamp', nullable: false }],
          },
        },
      })
    )
    await Bun.file(join(TEST_WORKSPACE, 'dbcli.contracts.json')).write(
      JSON.stringify({
        version: 1,
        contracts: [
          {
            name: 'active-customer',
            status: 'approved',
            description: 'A customer with a recent paid order.',
            subjects: ['model:orders'],
            owner: 'growth',
            evidencePolicy: 'verification-required',
          },
        ],
      })
    )

    await expect(gatherContext(TEST_WORKSPACE, TEST_CONFIG_PATH)).rejects.toThrow(
      'must reference an available semantic entity'
    )
  })

  test('gatherContext fails closed when semantic context names a blacklisted column', async () => {
    await Bun.file(TEST_CONFIG_PATH).write(
      JSON.stringify({
        connection: {
          system: 'postgresql',
          host: 'localhost',
          port: 5432,
          user: 'user',
          password: 'pass',
          database: 'app',
        },
        blacklist: { tables: [], columns: { orders: ['secret'] } },
        schema: {
          orders: {
            name: 'orders',
            columns: [
              { name: 'id', type: 'integer', nullable: false },
              { name: 'secret', type: 'text', nullable: true },
            ],
          },
        },
      })
    )
    await Bun.file(join(TEST_WORKSPACE, 'dbcli.semantic.json')).write(
      JSON.stringify({
        version: 1,
        models: [{ name: 'orders', table: 'orders', fields: [{ column: 'secret', aliases: [] }] }],
        metrics: [],
      })
    )

    await expect(gatherContext(TEST_WORKSPACE, TEST_CONFIG_PATH)).rejects.toThrow(
      'must reference a visible column'
    )
  })

  test('JSON serializer outputs correctly', () => {
    const samplePayload = {
      version: '1.0',
      system: 'mysql',
      permission: 'query-only',
      blacklist: { tables: ['secrets'], columns: {} },
      schema: {},
      snippets: [],
    }
    const json = serializeJson(samplePayload)
    const parsed = JSON.parse(json)
    expect(parsed.system).toBe('mysql')
    expect(parsed.permission).toBe('query-only')
  })

  test('XML and Markdown serializers preserve every validated semantic field', () => {
    const payload = {
      version: '1.0',
      system: 'postgresql',
      permission: 'query-only',
      blacklist: { tables: [], columns: {} },
      schema: {},
      snippets: [],
      semantic: {
        version: 2 as const,
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
        ],
        relationships: [
          {
            name: 'order-customer',
            from: { model: 'orders', field: 'created_at' },
            to: { model: 'orders', field: 'created_at' },
            cardinality: 'many-to-one' as const,
            description: 'Links an order to its customer.',
          },
        ],
        metrics: [{ name: 'daily-revenue', description: 'Revenue by day.', query: '@revenue' }],
      },
    }

    const xml = serializeXml(payload)
    const markdown = serializeMarkdown(payload)

    expect(xml).toContain('<alias>purchases</alias>')
    expect(xml).toContain('<description>Order creation time.</description>')
    expect(xml).toContain('<metric name="daily-revenue" query="@revenue">')
    expect(xml).toContain('<relationship name="order-customer"')
    expect(markdown).toContain('Aliases: `purchases`')
    expect(markdown).toContain('Order creation time.')
    expect(markdown).toContain('Revenue by day.')
    expect(markdown).toContain('Links an order to its customer.')
  })

  test('XML serializer formats correctly with escapes', () => {
    const samplePayload = {
      version: '1.0',
      system: 'mysql',
      permission: 'query-only',
      blacklist: {
        tables: ['secrets'],
        columns: { users: ['pass"word'] },
      },
      schema: {
        users: {
          name: 'users',
          rowCount: 50,
          primaryKey: ['id'],
          columns: [
            { name: 'id', type: 'int', nullable: false, primaryKey: true },
            { name: 'name', type: 'varchar', nullable: true, default: 'john & doe' },
          ],
        },
      },
      snippets: [
        {
          key: '@get-users',
          description: 'Get <all> users',
          params: [{ name: 'id', type: 'int', required: true }],
        },
      ],
    }

    const xml = serializeXml(samplePayload)
    expect(xml).toContain('<database_context system="mysql" permission="query-only" version="1.0">')
    expect(xml).toContain('<table name="secrets" />')
    expect(xml).toContain('<column table="users" name="pass&quot;word" />')
    expect(xml).toContain('<table name="users" rows="50" primary_key="id">')
    expect(xml).toContain('<column name="id" type="int" primary_key="true" nullable="false" />')
    expect(xml).toContain(
      '<column name="name" type="varchar" nullable="true" default="john &amp; doe" />'
    )
    expect(xml).toContain('<query name="@get-users">')
    expect(xml).toContain('<description>Get &lt;all&gt; users</description>')
    expect(xml).toContain('<param name="id" type="int" required="true" />')
  })

  test('Markdown serializer generates beautiful tables', () => {
    const samplePayload = {
      version: '1.0',
      system: 'postgresql',
      permission: 'query-only',
      blacklist: { tables: [], columns: {} },
      schema: {
        users: {
          name: 'users',
          rowCount: 100,
          primaryKey: ['id'],
          columns: [
            { name: 'id', type: 'integer', nullable: false, primaryKey: true },
            { name: 'email', type: 'varchar(255)', nullable: true },
          ],
        },
      },
      snippets: [],
    }

    const md = serializeMarkdown(samplePayload)
    expect(md).toContain('# Database Context Summary')
    expect(md).toContain('| Column | Type | Nullable | Primary Key | Default | References |')
    expect(md).toContain('| `id` | `integer` | No | ✅ | - | - |')
    expect(md).toContain('| `email` | `varchar(255)` | Yes | - | - | - |')
  })
})
