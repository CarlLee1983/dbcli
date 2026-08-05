/**
 * export must apply the blacklist.
 *
 * `export` writes rows to a file, so an unenforced blacklist here is a durable
 * copy of the data the blacklist exists to withhold — a worse outcome than the
 * same leak on stdout. The SQL branch built its QueryExecutor without a
 * validator, so neither table blocking nor column masking ran (found while
 * fixing issue #23).
 */

import { describe, test, expect, beforeEach, afterEach, spyOn } from 'bun:test'
import { configModule } from '@/core/config'
import { AdapterFactory } from '@/adapters'
import { exportCommand } from '@/commands/export'

const sqlConnection = {
  system: 'mysql' as const,
  host: 'h',
  port: 3306,
  user: 'u',
  password: '',
  database: 'd',
}

const secretRows = [{ id: 1, email: 'a@example.com', password_hash: 'hash123' }]

function makeAdapter() {
  return {
    async connect() {},
    async disconnect() {},
    async execute() {
      return { rows: secretRows, affectedRows: secretRows.length }
    },
  }
}

describe('export applies the blacklist', () => {
  let configSpy: ReturnType<typeof spyOn> | undefined
  let sqlSpy: ReturnType<typeof spyOn> | undefined
  let logSpy: ReturnType<typeof spyOn>
  let errSpy: ReturnType<typeof spyOn>
  let stdout: string[]

  beforeEach(() => {
    stdout = []
    logSpy = spyOn(console, 'log').mockImplementation((m: unknown) => {
      stdout.push(String(m))
    })
    errSpy = spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    configSpy?.mockRestore()
    sqlSpy?.mockRestore()
    logSpy.mockRestore()
    errSpy.mockRestore()
  })

  function mockConfig(blacklist: unknown) {
    configSpy = spyOn(configModule, 'read').mockResolvedValue({
      connection: sqlConnection,
      permission: 'admin',
      schema: {},
      metadata: { version: '1.0' },
      blacklist,
    } as never)
    sqlSpy = spyOn(AdapterFactory, 'createSqlAdapter').mockReturnValue(makeAdapter() as never)
  }

  test('refuses to export a blacklisted table', async () => {
    mockConfig({ tables: ['users'], columns: {} })

    await expect(
      exportCommand('SELECT * FROM users', { format: 'json', noLimit: true })
    ).rejects.toThrow(/users/)
  })

  test('refuses to export a blacklisted table reached through a JOIN', async () => {
    mockConfig({ tables: ['users'], columns: {} })

    await expect(
      exportCommand('SELECT * FROM orders o JOIN users u ON u.id = o.user_id', {
        format: 'json',
        noLimit: true,
      })
    ).rejects.toThrow(/users/)
  })

  test('omits blacklisted columns from the exported rows', async () => {
    mockConfig({ tables: [], columns: { users: ['password_hash'] } })

    await exportCommand('SELECT * FROM users', { format: 'json', noLimit: true })

    const written = stdout.join('\n')
    expect(written).not.toContain('password_hash')
    expect(written).not.toContain('hash123')
    expect(written).toContain('a@example.com')
  })
})

/**
 * The Elasticsearch branch checked the index against the table blacklist and
 * then wrote the documents through unmasked, while `dbcli query` on the same
 * index hid the field. Same class of gap as the SQL branch above.
 */
describe('export applies the blacklist on Elasticsearch', () => {
  let configSpy: ReturnType<typeof spyOn> | undefined
  let esSpy: ReturnType<typeof spyOn> | undefined
  let logSpy: ReturnType<typeof spyOn>
  let errSpy: ReturnType<typeof spyOn>
  let stdout: string[]

  beforeEach(() => {
    stdout = []
    logSpy = spyOn(console, 'log').mockImplementation((m: unknown) => {
      stdout.push(String(m))
    })
    errSpy = spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    configSpy?.mockRestore()
    esSpy?.mockRestore()
    logSpy.mockRestore()
    errSpy.mockRestore()
  })

  test('omits blacklisted fields from the exported documents', async () => {
    configSpy = spyOn(configModule, 'read').mockResolvedValue({
      connection: {
        system: 'elasticsearch',
        host: 'localhost',
        port: 9200,
        user: '',
        password: '',
        database: '',
      },
      permission: 'admin',
      schema: {},
      metadata: { version: '1.0' },
      blacklist: { tables: [], columns: { users: ['api_key'] } },
    } as never)
    esSpy = spyOn(AdapterFactory, 'createElasticsearchAdapter').mockReturnValue({
      connect: async () => {},
      disconnect: async () => {},
      request: async () => ({}),
      execute: async () => ({
        rows: [{ _id: '1', name: 'a', api_key: 'KEYSECRET' }],
        rowCount: 1,
        columnNames: ['_id', 'name', 'api_key'],
        affectedRows: 1,
      }),
    } as never)

    await exportCommand('{"query":{"match_all":{}}}', {
      format: 'json',
      index: 'users',
      noLimit: true,
    })

    const written = stdout.join('\n')
    expect(written).not.toContain('KEYSECRET')
    expect(written).not.toContain('api_key')
    expect(written).toContain('"name"')
  })
})
