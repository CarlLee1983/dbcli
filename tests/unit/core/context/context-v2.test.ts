import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { gatherContextV2, ContextV2Error } from '@/core/context/context-v2'
import {
  serializeContextV2Json,
  serializeContextV2Markdown,
  serializeContextV2Xml,
} from '@/core/context/serializer-v2'

const workspace = join(__dirname, 'tmp-v2-workspace')
const configPath = join(workspace, 'config.json')

function connection(system: string): Record<string, unknown> {
  return {
    system,
    host: 'localhost',
    port: system === 'postgresql' ? 5432 : 6379,
    user: 'canary-user',
    password: 'CANARY_CREDENTIAL',
    database: system === 'redis' ? '0' : 'app',
  }
}

async function writeConfig(
  system: string,
  schema: Record<string, unknown> = {},
  extra: Record<string, unknown> = {}
): Promise<void> {
  await Bun.file(configPath).write(
    JSON.stringify({
      connection: connection(system),
      permission: 'query-only',
      metadata: { version: '9.9.9' },
      blacklist: { tables: [], columns: {} },
      schema,
      ...extra,
    })
  )
}

describe('context version 2', () => {
  beforeEach(() => {
    rmSync(workspace, { recursive: true, force: true })
    mkdirSync(join(workspace, '.dbcli', 'queries'), { recursive: true })
  })

  afterEach(() => {
    if (existsSync(workspace)) rmSync(workspace, { recursive: true, force: true })
  })

  test('projects bounded SQL context and excludes protected or value-bearing fields', async () => {
    await writeConfig(
      'postgresql',
      {
        users: {
          name: 'users',
          columns: [
            { name: 'id', type: 'integer', nullable: false, primaryKey: true, default: '7' },
            { name: 'email', type: 'text', nullable: false, comment: 'CANARY_VALUE' },
            { name: 'password', type: 'text', nullable: false },
          ],
          estimatedRowCount: 12345,
          indexes: [{ name: 'CANARY_INDEX', columns: ['email'], unique: true }],
        },
        orders: {
          name: 'orders',
          columns: [
            { name: 'id', type: 'integer', nullable: false, primaryKey: true },
            { name: 'user_id', type: 'integer', nullable: false },
          ],
          foreignKeys: [
            {
              name: 'CANARY_FK_NAME',
              columns: ['user_id'],
              refTable: 'users',
              refColumns: ['id'],
            },
          ],
        },
        secrets: {
          name: 'secrets',
          columns: [{ name: 'token', type: 'text', nullable: false }],
        },
      },
      {
        blacklist: { tables: ['secrets'], columns: { users: ['password'] } },
      }
    )
    await Bun.file(join(workspace, '.dbcli', 'queries', 'active-users.sql')).write(`-- ---
-- name: Active users
-- description: Active customer accounts
-- intent: customer.activity
-- engine: postgres
-- params:
--   min_id:
--     type: int
--     required: true
--     default: 42
-- ---
SELECT 'CANARY_QUERY_BODY' FROM users WHERE id >= :min_id`)
    await Bun.file(join(workspace, 'dbcli.semantic.json')).write(
      JSON.stringify({
        version: 2,
        models: [
          {
            name: 'users',
            table: 'users',
            aliases: ['customers'],
            fields: [
              { column: 'id' },
              { column: 'email', description: 'Contact address', aliases: ['contact'] },
            ],
          },
        ],
        relationships: [
          {
            name: 'user-self',
            from: { model: 'users', field: 'id' },
            to: { model: 'users', field: 'email' },
            cardinality: 'one-to-one',
            description: 'Stable account pairing.',
          },
        ],
        metrics: [{ name: 'active-users', query: '@active-users' }],
      })
    )
    await Bun.file(join(workspace, 'dbcli.contracts.json')).write(
      JSON.stringify({
        version: 1,
        contracts: [
          {
            name: 'customer-account',
            status: 'approved',
            description: 'A known customer account.',
            subjects: ['model:users'],
            owner: 'growth',
            aliases: ['account'],
            evidencePolicy: 'verification-required',
          },
        ],
      })
    )
    await Bun.file(join(workspace, 'src-canary.ts')).write('CANARY_SOURCE_CONTENT')
    await Bun.file(join(workspace, 'dbcli.data-access.json')).write(
      JSON.stringify({
        version: 1,
        operations: [
          {
            name: 'find-customer',
            source: 'src-canary.ts',
            kind: 'read',
            references: ['model:users', 'field:users.email'],
            coverage: 'declared',
          },
        ],
      })
    )

    const payload = await gatherContextV2(workspace, configPath)
    const json = serializeContextV2Json(payload)
    const serialized = [json, serializeContextV2Xml(payload), serializeContextV2Markdown(payload)]
    const { blacklist: _policy, ...outsidePolicy } = payload
    const nonPolicyJson = JSON.stringify(outsidePolicy)

    expect(payload.contextVersion).toBe(2)
    expect(payload.version).toBe('9.9.9')
    expect(payload.capabilities.map(({ command }) => command)).toEqual([
      'export',
      'q',
      'queries',
      'query',
      'schema',
      'shell',
    ])
    expect(payload.resources).toEqual({
      kind: 'sql',
      tables: [
        {
          id: 'postgresql/table/orders',
          name: 'orders',
          columns: [
            {
              id: 'postgresql/table/orders/field/id',
              name: 'id',
              type: 'integer',
              nullable: false,
              primaryKey: true,
            },
            {
              id: 'postgresql/table/orders/field/user_id',
              name: 'user_id',
              type: 'integer',
              nullable: false,
              primaryKey: false,
            },
          ],
          relationships: [
            {
              columns: ['postgresql/table/orders/field/user_id'],
              referencedColumns: ['postgresql/table/users/field/id'],
              referencedTableId: 'postgresql/table/users',
            },
          ],
        },
        expect.objectContaining({
          id: 'postgresql/table/users',
          name: 'users',
          columns: [
            expect.objectContaining({ id: 'postgresql/table/users/field/email', name: 'email' }),
            expect.objectContaining({ id: 'postgresql/table/users/field/id', name: 'id' }),
          ],
        }),
      ],
    })
    expect(payload.snippets[0]).toEqual({
      key: '@active-users',
      description: 'Active customer accounts',
      intent: 'customer.activity',
      engines: ['postgres'],
      parameters: [{ name: 'min_id', type: 'int', required: true }],
    })
    expect(payload.semantic?.models[0]).toMatchObject({
      reference: 'model:users',
      tableId: 'postgresql/table/users',
      fields: [
        expect.objectContaining({
          reference: 'field:users.email',
          fieldId: 'postgresql/table/users/field/email',
        }),
        expect.objectContaining({
          reference: 'field:users.id',
          fieldId: 'postgresql/table/users/field/id',
        }),
      ],
    })
    expect(payload.dataAccess).toEqual([
      {
        name: 'find-customer',
        kind: 'read',
        semanticReferences: ['field:users.email', 'model:users'],
        coverage: 'declared',
      },
    ])
    for (const canary of [
      'CANARY_CREDENTIAL',
      'CANARY_VALUE',
      'CANARY_INDEX',
      'CANARY_FK_NAME',
      'CANARY_QUERY_BODY',
      'src-canary.ts',
      'CANARY_SOURCE_CONTENT',
      '12345',
      '"default"',
    ]) {
      for (const output of serialized) expect(output).not.toContain(canary)
    }
    expect(nonPolicyJson).not.toMatch(/password|secrets/)
  })

  test('projects only flattened Elasticsearch field paths and types', async () => {
    await writeConfig('elasticsearch', {
      'orders-v1': {
        name: 'orders-v1',
        columns: [
          { name: 'profile.email', type: 'keyword', nullable: true, default: 'CANARY_DEFAULT' },
          { name: 'created at', type: 'date', nullable: false },
        ],
        rowCount: 99,
        rawMapping: { CANARY_RAW_MAPPING: true },
      },
    })

    const payload = await gatherContextV2(workspace, configPath)

    expect(payload.resources).toEqual({
      kind: 'elasticsearch',
      indices: [
        {
          id: 'elasticsearch/index/orders-v1',
          name: 'orders-v1',
          fields: [
            {
              id: 'elasticsearch/index/orders-v1/field/created%20at',
              path: 'created at',
              type: 'date',
            },
            {
              id: 'elasticsearch/index/orders-v1/field/profile.email',
              path: 'profile.email',
              type: 'keyword',
            },
          ],
        },
      ],
    })
    expect(JSON.stringify(payload)).not.toMatch(/CANARY|rowCount|rawMapping|default/)
  })

  test('orders data-access declarations by Unicode code point', async () => {
    await writeConfig('postgresql', {
      users: {
        name: 'users',
        columns: [{ name: 'id', type: 'integer', nullable: false, primaryKey: true }],
      },
    })
    await Bun.file(join(workspace, 'dbcli.semantic.json')).write(
      JSON.stringify({
        version: 2,
        models: [{ name: 'users', table: 'users', fields: [{ column: 'id' }] }],
        metrics: [],
      })
    )
    await Bun.file(join(workspace, 'first.ts')).write('')
    await Bun.file(join(workspace, 'second.ts')).write('')
    await Bun.file(join(workspace, 'dbcli.data-access.json')).write(
      JSON.stringify({
        version: 1,
        operations: [
          {
            name: '😀',
            source: 'first.ts',
            kind: 'read',
            references: ['model:users'],
            coverage: 'declared',
          },
          {
            name: '\uE000',
            source: 'second.ts',
            kind: 'read',
            references: ['model:users'],
            coverage: 'declared',
          },
        ],
      })
    )

    const payload = await gatherContextV2(workspace, configPath)

    expect(payload.dataAccess.map(({ name }) => name)).toEqual(['\uE000', '😀'])
  })

  test('loads only valid Redis declarations and allows provably unrelated protection globs', async () => {
    await writeConfig(
      'redis',
      {},
      {
        blacklist: { tables: ['private:*'], columns: {} },
        redis: { mask: [{ keyPattern: 'audit:*', fields: ['token'] }] },
      }
    )
    await Bun.file(join(workspace, 'dbcli.redis-context.json')).write(
      JSON.stringify({
        version: 1,
        keyFamilies: [
          {
            name: 'user-session',
            pattern: 'session:{user_id}',
            type: 'hash',
            description: 'Current session metadata.',
            aliases: ['sessions'],
            fields: [
              {
                name: 'expires_at',
                type: 'timestamp',
                description: 'Expiry time.',
                aliases: ['expiry'],
              },
            ],
          },
        ],
      })
    )

    const payload = await gatherContextV2(workspace, configPath)

    expect(payload.resources).toEqual({
      kind: 'redis',
      keyFamilies: [
        {
          id: 'redis/key-family/user-session',
          name: 'user-session',
          pattern: 'session:{user_id}',
          type: 'hash',
          description: 'Current session metadata.',
          aliases: ['sessions'],
          fields: [
            {
              id: 'redis/key-family/user-session/field/expires_at',
              name: 'expires_at',
              type: 'timestamp',
              description: 'Expiry time.',
              aliases: ['expiry'],
            },
          ],
        },
      ],
    })
    expect(payload.gaps).not.toContainEqual(
      expect.objectContaining({ code: 'REDIS_KEY_FAMILIES_UNAVAILABLE' })
    )
  })

  test('rejects Redis declarations that overlap protection or contain invalid patterns', async () => {
    await writeConfig(
      'redis',
      {},
      {
        blacklist: { tables: ['session:admin:*'], columns: {} },
      }
    )
    await Bun.file(join(workspace, 'dbcli.redis-context.json')).write(
      JSON.stringify({
        version: 1,
        keyFamilies: [{ name: 'user-session', pattern: 'session:{scope}:{id}', type: 'string' }],
      })
    )

    await expect(gatherContextV2(workspace, configPath)).rejects.toMatchObject({
      code: 'INVALID_REDIS_CONTEXT',
    })

    await Bun.file(join(workspace, 'dbcli.redis-context.json')).write(
      JSON.stringify({
        version: 1,
        keyFamilies: [{ name: 'user-session', pattern: String.raw`session:\{id}`, type: 'string' }],
      })
    )
    await expect(gatherContextV2(workspace, configPath)).rejects.toBeInstanceOf(ContextV2Error)
  })

  /**
   * `INVALID_RESOURCE_REFERENCE` had no coverage at all, which is how a
   * substring test on the issue message ("reference") kept classifying a
   * duplicate reference and an unusable source path as reference failures.
   */
  describe('invalid-evidence classification', () => {
    const SCHEMA = {
      orders: {
        name: 'orders',
        columns: [{ name: 'customer_id', type: 'int', nullable: false }],
      },
    }

    async function writeSemantic(): Promise<void> {
      await Bun.file(join(workspace, 'dbcli.semantic.json')).write(
        JSON.stringify({
          version: 1,
          models: [{ name: 'orders', table: 'orders', fields: [{ column: 'customer_id' }] }],
          metrics: [],
        })
      )
    }

    async function writeDataAccess(operation: Record<string, unknown>): Promise<void> {
      await Bun.file(join(workspace, 'dbcli.data-access.json')).write(
        JSON.stringify({ version: 1, operations: [operation] })
      )
    }

    const VALID_OPERATION = {
      name: 'orders.list',
      source: 'src/orders.ts',
      kind: 'read',
      references: ['model:orders'],
      coverage: 'declared',
    }

    beforeEach(async () => {
      mkdirSync(join(workspace, 'src'), { recursive: true })
      await Bun.file(join(workspace, 'src', 'orders.ts')).write('export {}\n')
    })

    test('an unknown semantic reference in the manifest is a reference failure', async () => {
      await writeConfig('postgresql', SCHEMA)
      await writeSemantic()
      await writeDataAccess({ ...VALID_OPERATION, references: ['model:not-declared'] })

      await expect(gatherContextV2(workspace, configPath)).rejects.toMatchObject({
        code: 'INVALID_RESOURCE_REFERENCE',
      })
    })

    test('a duplicate reference is a malformed manifest, not a reference failure', async () => {
      await writeConfig('postgresql', SCHEMA)
      await writeSemantic()
      await writeDataAccess({ ...VALID_OPERATION, references: ['model:orders', 'model:orders'] })

      await expect(gatherContextV2(workspace, configPath)).rejects.toMatchObject({
        code: 'INVALID_DATA_ACCESS_MANIFEST',
      })
    })

    test('an unusable source path is a malformed manifest, not a reference failure', async () => {
      await writeConfig('postgresql', SCHEMA)
      await writeSemantic()
      await writeDataAccess({ ...VALID_OPERATION, source: 'src/does-not-exist.ts' })

      await expect(gatherContextV2(workspace, configPath)).rejects.toMatchObject({
        code: 'INVALID_DATA_ACCESS_MANIFEST',
      })
    })

    test('an unknown semantic model reference is a reference failure', async () => {
      await writeConfig('postgresql', SCHEMA)
      await Bun.file(join(workspace, 'dbcli.semantic.json')).write(
        JSON.stringify({
          version: 1,
          models: [{ name: 'orders', table: 'not-a-visible-table', fields: [] }],
          metrics: [],
        })
      )

      await expect(gatherContextV2(workspace, configPath)).rejects.toMatchObject({
        code: 'INVALID_RESOURCE_REFERENCE',
      })
    })

    test('a malformed semantic artifact is an invalid context, not a reference failure', async () => {
      await writeConfig('postgresql', SCHEMA)
      await Bun.file(join(workspace, 'dbcli.semantic.json')).write(
        JSON.stringify({ version: 1, models: 'not-an-array', metrics: [] })
      )

      await expect(gatherContextV2(workspace, configPath)).rejects.toMatchObject({
        code: 'INVALID_SEMANTIC_CONTEXT',
      })
    })

    test('an unknown contract subject is a reference failure', async () => {
      await writeConfig('postgresql', SCHEMA)
      await writeSemantic()
      await Bun.file(join(workspace, 'dbcli.contracts.json')).write(
        JSON.stringify({
          version: 1,
          contracts: [
            {
              name: 'active-customer',
              status: 'approved',
              description: 'A customer definition.',
              subjects: ['model:not-declared'],
              owner: 'growth',
              evidencePolicy: 'none',
            },
          ],
        })
      )

      await expect(gatherContextV2(workspace, configPath)).rejects.toMatchObject({
        code: 'INVALID_RESOURCE_REFERENCE',
      })
    })
  })

  test('emits stable missing-evidence gaps instead of ambiguous empty resources', async () => {
    await writeConfig('mysql')

    const payload = await gatherContextV2(workspace, configPath)

    expect(payload.resources).toEqual({ kind: 'sql', tables: [] })
    expect(payload.gaps).toEqual([
      { code: 'DATA_ACCESS_UNAVAILABLE', scope: 'dataAccess' },
      { code: 'SEMANTIC_CONTEXT_UNAVAILABLE', scope: 'semantic' },
      { code: 'SQL_SCHEMA_UNAVAILABLE', scope: 'resources' },
    ])
  })

  test('sorts before applying resource and field limits and reports exact omissions', async () => {
    const schema: Record<string, unknown> = {}
    for (let index = 500; index >= 0; index--) {
      const name = `table-${String(index).padStart(3, '0')}`
      schema[name] = {
        name,
        columns: Array.from({ length: 11 }, (_, field) => ({
          name: `field-${String(field).padStart(2, '0')}`,
          type: 'text',
          nullable: true,
        })),
      }
    }
    await writeConfig('postgresql', schema)

    const payload = await gatherContextV2(workspace, configPath)
    const resources = payload.resources.kind === 'sql' ? payload.resources.tables : []

    expect(resources).toHaveLength(500)
    expect(resources[0]?.name).toBe('table-000')
    expect(resources.at(-1)?.name).toBe('table-499')
    expect(resources.reduce((sum, table) => sum + table.columns.length, 0)).toBe(5000)
    expect(payload.truncation.resources).toEqual({ emitted: 500, omitted: 1 })
    expect(payload.truncation.fields).toEqual({ emitted: 5000, omitted: 511 })
    expect(payload.gaps).toContainEqual({ code: 'CONTEXT_TRUNCATED', scope: 'context' })
  })

  test('is byte deterministic and renders the same payload through JSON, XML, and Markdown', async () => {
    await writeConfig('mariadb', {
      'z table': {
        name: 'z table',
        columns: [{ name: 'é', type: 'text', nullable: true }],
      },
      alpha: {
        name: 'alpha',
        columns: [{ name: 'field', type: 'integer', nullable: false }],
      },
    })

    const first = await gatherContextV2(workspace, configPath)
    const second = await gatherContextV2(workspace, configPath)
    const json = serializeContextV2Json(first)
    const xml = serializeContextV2Xml(first)
    const markdown = serializeContextV2Markdown(first)

    expect(json).toBe(serializeContextV2Json(second))
    for (const output of [json, xml, markdown]) {
      expect(output).toContain('contextVersion')
      expect(output).toContain('mariadb')
      expect(output).toContain('z%20table')
      expect(output).toContain('%C3%A9')
      expect(output).toContain('DATA_ACCESS_UNAVAILABLE')
    }
  })

  test('rejects unsupported engines and invalid cache shapes with bounded stable codes', async () => {
    await writeConfig('mongodb')
    await expect(gatherContextV2(workspace, configPath)).rejects.toMatchObject({
      code: 'UNSUPPORTED_CONTEXT_ENGINE',
      message: 'UNSUPPORTED_CONTEXT_ENGINE',
    })

    await writeConfig('postgresql', {
      users: { name: 'users', columns: [{ name: 'id', type: 'integer' }] },
    })
    await expect(gatherContextV2(workspace, configPath)).rejects.toMatchObject({
      code: 'INVALID_SCHEMA_CACHE',
      message: 'INVALID_SCHEMA_CACHE',
    })

    await writeConfig('postgresql', {
      users: {
        columns: [{ name: 'id', type: 'integer', nullable: false, primaryKey: 'yes' }],
      },
    })
    await expect(gatherContextV2(workspace, configPath)).rejects.toMatchObject({
      code: 'INVALID_SCHEMA_CACHE',
      message: 'INVALID_SCHEMA_CACHE',
    })

    await writeConfig('postgresql', {
      users: {
        name: 'users',
        columns: [{ name: 'id', type: 'integer', nullable: false, primaryKey: 'yes' }],
      },
    })
    await expect(gatherContextV2(workspace, configPath)).rejects.toMatchObject({
      code: 'INVALID_SCHEMA_CACHE',
      message: 'INVALID_SCHEMA_CACHE',
    })

    await writeConfig('oracle')
    await expect(gatherContextV2(workspace, configPath)).rejects.toMatchObject({
      code: 'UNSUPPORTED_CONTEXT_ENGINE',
      message: 'UNSUPPORTED_CONTEXT_ENGINE',
    })
  })

  test('rejects wildcard-protected identifiers in every non-policy metadata string', async () => {
    await writeConfig(
      'postgresql',
      {
        public_users: {
          name: 'public_users',
          columns: [{ name: 'id', type: 'integer', nullable: false }],
        },
        audit_logs: {
          name: 'audit_logs',
          columns: [{ name: 'id', type: 'integer', nullable: false }],
        },
      },
      { blacklist: { tables: ['audit*'], columns: {} } }
    )
    await Bun.file(join(workspace, '.dbcli', 'queries', 'public.sql')).write(`-- ---
-- name: Public
-- description: References audit_logs
-- engine: postgres
-- ---
SELECT 1`)

    await expect(gatherContextV2(workspace, configPath)).rejects.toMatchObject({
      code: 'INVALID_SAVED_QUERY',
      message: 'INVALID_SAVED_QUERY',
    })

    await writeConfig(
      'postgresql',
      {
        public_users: {
          name: 'public_users',
          columns: [{ name: 'id', type: 'integer', nullable: false }],
        },
        'audit logs': {
          name: 'audit logs',
          columns: [{ name: 'id', type: 'integer', nullable: false }],
        },
      },
      { blacklist: { tables: ['audit *'], columns: {} } }
    )
    await Bun.file(join(workspace, '.dbcli', 'queries', 'public.sql')).write(`-- ---
-- name: Public
-- description: References audit logs today
-- engine: postgres
-- ---
SELECT 1`)
    await expect(gatherContextV2(workspace, configPath)).rejects.toMatchObject({
      code: 'INVALID_SAVED_QUERY',
      message: 'INVALID_SAVED_QUERY',
    })

    await writeConfig(
      'postgresql',
      {},
      {
        metadata: { version: 'audit_logs' },
        blacklist: { tables: ['audit*'], columns: {} },
      }
    )
    rmSync(join(workspace, '.dbcli', 'queries'), { recursive: true, force: true })
    await expect(gatherContextV2(workspace, configPath)).rejects.toMatchObject({
      code: 'INVALID_SCHEMA_CACHE',
      message: 'INVALID_SCHEMA_CACHE',
    })
  })
})
