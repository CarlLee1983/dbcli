import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { Command } from 'commander'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { designCommand } from '@/commands/design'

const valid = {
  version: 1,
  dialect: 'postgresql',
  models: [
    {
      name: 'customers',
      table: 'customers',
      fields: [{ name: 'id', type: 'uuid', nullable: false, primaryKey: true }],
    },
    {
      name: 'orders',
      table: 'orders',
      fields: [
        { name: 'id', type: 'uuid', nullable: false, primaryKey: true },
        { name: 'customer_id', type: 'uuid', nullable: false },
      ],
      indexes: [{ columns: ['customer_id'] }],
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
  accessPatterns: [{ model: 'orders', filters: ['customer_id'] }],
  decisions: [],
}

function root(): Command {
  const program = new Command()
    .name('dbcli')
    .exitOverride()
    .enablePositionalOptions()
    .option('--config <path>', 'config path', '.dbcli')
  program.addCommand(designCommand)
  return program
}

describe('design commands', () => {
  let sandbox = ''
  let cwd = ''
  let output = ''
  const logSpy = spyOn(console, 'log').mockImplementation((value: unknown) => {
    output += `${String(value)}\n`
  })
  const errorSpy = spyOn(console, 'error').mockImplementation(() => {})

  beforeEach(() => {
    sandbox = mkdtempSync(join(tmpdir(), 'dbcli-design-command-'))
    cwd = process.cwd()
    output = ''
    process.exitCode = 0
    process.chdir(sandbox)
  })

  afterEach(() => {
    process.chdir(cwd)
    process.exitCode = 0
    if (sandbox && existsSync(sandbox)) rmSync(sandbox, { recursive: true, force: true })
  })

  test('validates and renders a local design without opening a connection', async () => {
    writeFileSync(join(sandbox, 'dbcli.design.json'), JSON.stringify(valid))

    await root().parseAsync(['bun', 'dbcli', 'design', 'validate', '--format', 'json'], {
      from: 'node',
    })
    expect(JSON.parse(output)).toMatchObject({ summary: { errors: 0 } })

    output = ''
    await root().parseAsync(['bun', 'dbcli', 'design', 'render', '--format', 'mermaid'], {
      from: 'node',
    })
    expect(output).toContain('erDiagram')
    expect(output).toContain('orders }o--|| customers')
  })

  test('writes a template only to an explicit missing path and reports its incomplete design', async () => {
    const file = join(sandbox, 'new-design.json')
    await root().parseAsync(['bun', 'dbcli', 'design', 'init', '--output', file], { from: 'node' })
    expect(await Bun.file(file).json()).toMatchObject({ version: 1, models: [] })

    output = ''
    await root().parseAsync(['bun', 'dbcli', 'design', 'validate', '--file', file, '--format', 'json'], {
      from: 'node',
    })
    expect(JSON.parse(output)).toMatchObject({
      findings: [expect.objectContaining({ code: 'NO_MODELS', severity: 'error' })],
    })
    expect(process.exitCode).toBe(1)
  })

  test('does not render an invalid physical design', async () => {
    writeFileSync(
      join(sandbox, 'dbcli.design.json'),
      JSON.stringify({ ...valid, models: [{ ...valid.models[0], fields: [] }] })
    )
    await root().parseAsync(['bun', 'dbcli', 'design', 'render', '--format', 'mermaid'], {
      from: 'node',
    })

    expect(output).toContain('PRIMARY_KEY_COUNT')
    expect(output).not.toContain('erDiagram')
    expect(process.exitCode).toBe(1)
  })

  test('compares a valid design with the local schema cache without connecting', async () => {
    const designFile = join(sandbox, 'dbcli.design.json')
    const configFile = join(sandbox, 'config.json')
    writeFileSync(designFile, JSON.stringify(valid))
    writeFileSync(
      configFile,
      JSON.stringify({
        connection: { system: 'postgresql', host: 'unreachable.invalid', port: 5432, user: 'test', database: 'app' },
        permission: 'query-only',
        blacklist: { tables: [], columns: {} },
        schema: {
          customers: {
            name: 'customers',
            columns: [{ name: 'id', type: 'uuid', nullable: false, primaryKey: true }],
            indexes: [],
          },
          orders: {
            name: 'orders',
            columns: [
              { name: 'id', type: 'uuid', nullable: false, primaryKey: true },
              { name: 'customer_id', type: 'uuid', nullable: false },
            ],
            indexes: [{ name: 'orders_customer_id_idx', columns: ['customer_id'], unique: false }],
            foreignKeys: [
              { name: 'orders_customer_id_fkey', columns: ['customer_id'], refTable: 'customers', refColumns: ['id'] },
            ],
          },
        },
      })
    )

    await root().parseAsync(
      ['bun', 'dbcli', '--config', configFile, 'design', 'diff', '--against-cache', '--format', 'json'],
      { from: 'node' }
    )

    expect(JSON.parse(output)).toMatchObject({ entries: [], summary: { errors: 0 } })
  })

  test('compares a valid design with a local ORM DDL definition without config or connection', async () => {
    const designFile = join(sandbox, 'dbcli.design.json')
    const ddlFile = join(sandbox, 'schema.sql')
    writeFileSync(designFile, JSON.stringify(valid))
    writeFileSync(
      ddlFile,
      [
        'CREATE TABLE customers (id UUID PRIMARY KEY);',
        'CREATE TABLE orders (id UUID PRIMARY KEY, customer_id UUID NOT NULL REFERENCES customers(id));',
        'CREATE INDEX orders_customer_id_idx ON orders (customer_id);',
      ].join('\n')
    )

    await root().parseAsync(
      ['bun', 'dbcli', 'design', 'diff', '--against-orm', ddlFile, '--format', 'json'],
      { from: 'node' }
    )

    expect(JSON.parse(output)).toMatchObject({ ormSource: 'design', entries: [], summary: { errors: 0 } })
  })

  test('produces a review-only dry-run proposal with preflight and verification steps', async () => {
    const designFile = join(sandbox, 'dbcli.design.json')
    const ddlFile = join(sandbox, 'schema.sql')
    writeFileSync(designFile, JSON.stringify(valid))
    writeFileSync(
      ddlFile,
      [
        'CREATE TABLE customers (id UUID PRIMARY KEY);',
        'CREATE TABLE orders (id UUID PRIMARY KEY, customer_id UUID NOT NULL REFERENCES customers(id));',
      ].join('\n')
    )

    await root().parseAsync(
      ['bun', 'dbcli', 'design', 'propose', '--against-orm', ddlFile, '--format', 'json'],
      { from: 'node' }
    )

    expect(JSON.parse(output)).toMatchObject({
      proposals: [
        expect.objectContaining({
          safety: 'dry-run',
          preflight: expect.arrayContaining(['dbcli blacklist list']),
          verification: expect.arrayContaining([
            'After an approved write, run: dbcli schema <exact-table> --format json',
          ]),
          commands: expect.arrayContaining([expect.stringContaining('dbcli migrate add-index orders')]),
        }),
      ],
    })
  })

  test('keeps console spies alive for the shared command singleton', () => {
    expect(logSpy).toBeDefined()
    expect(errorSpy).toBeDefined()
  })
})
