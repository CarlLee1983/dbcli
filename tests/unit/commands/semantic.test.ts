import { afterAll, afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test'
import { Command } from 'commander'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { semanticCommand } from '@/commands/semantic'

const CONFIG = {
  connection: {
    system: 'postgresql',
    host: 'localhost',
    port: 5432,
    user: 'user',
    database: 'app',
  },
  permission: 'query-only',
  blacklist: { tables: [], columns: { orders: ['secret'] } },
  schema: {
    orders: {
      name: 'orders',
      columns: [
        { name: 'id', type: 'integer', nullable: false, primaryKey: true },
        { name: 'created_at', type: 'timestamp', nullable: false },
        { name: 'secret', type: 'text', nullable: true },
      ],
    },
  },
}

function makeRoot(): Command {
  const program = new Command()
    .name('dbcli')
    .exitOverride()
    .enablePositionalOptions()
    .option('--config <path>', 'config path', '.dbcli')
  program.addCommand(semanticCommand)
  return program
}

describe('semantic commands', () => {
  let output = ''
  let errors = ''
  let exitCode: number | undefined
  let sandbox = ''
  let configPath = ''
  const cwd = process.cwd()
  const logSpy = spyOn(console, 'log').mockImplementation((value: unknown) => {
    output += `${String(value)}\n`
  })
  const errorSpy = spyOn(console, 'error').mockImplementation((value: unknown) => {
    errors += `${String(value)}\n`
  })
  const exitSpy = spyOn(process, 'exit').mockImplementation((code) => {
    exitCode = code as number
    return undefined as never
  })

  beforeEach(() => {
    output = ''
    errors = ''
    exitCode = undefined
    sandbox = mkdtempSync(join(tmpdir(), 'dbcli-semantic-command-'))
    configPath = join(sandbox, 'config.json')
    writeFileSync(configPath, JSON.stringify(CONFIG))
    mkdirSync(join(sandbox, '.dbcli', 'queries'), { recursive: true })
    writeFileSync(
      join(sandbox, '.dbcli', 'queries', 'revenue.sql'),
      '-- ---\n-- description: Revenue report\n-- ---\nSELECT 1'
    )
    writeFileSync(
      join(sandbox, 'dbcli.semantic.json'),
      JSON.stringify({
        version: 1,
        models: [
          {
            name: 'orders',
            table: 'orders',
            aliases: ['purchases'],
            fields: [{ column: 'created_at', aliases: ['order date'] }],
          },
        ],
        metrics: [{ name: 'daily-revenue', query: '@revenue' }],
      })
    )
    process.chdir(sandbox)
  })

  afterEach(() => {
    process.chdir(cwd)
    if (sandbox && existsSync(sandbox)) rmSync(sandbox, { recursive: true, force: true })
  })

  async function run(...args: string[]): Promise<void> {
    await makeRoot().parseAsync(['bun', 'dbcli', '--config', configPath, 'semantic', ...args], {
      from: 'node',
    })
  }

  test('validate accepts metrics that reference a parsed saved query', async () => {
    await run('validate', '--format', 'json')

    expect(exitCode).toBeUndefined()
    expect(JSON.parse(output)).toMatchObject({ valid: true, models: 1, metrics: 1 })
  })

  test('context prints the validated business context', async () => {
    await run('context', '--format', 'json')

    expect(exitCode).toBeUndefined()
    expect(JSON.parse(output)).toMatchObject({
      models: [expect.objectContaining({ name: 'orders', table: 'orders' })],
      metrics: [expect.objectContaining({ query: '@revenue' })],
    })
  })

  test('context fails closed when a model names a blacklisted column', async () => {
    writeFileSync(
      join(sandbox, 'dbcli.semantic.json'),
      JSON.stringify({
        version: 1,
        models: [{ name: 'orders', table: 'orders', fields: [{ column: 'secret', aliases: [] }] }],
        metrics: [],
      })
    )

    await run('context')

    expect(exitCode).toBe(1)
    expect(errors).toContain('must reference a visible column')
  })

  test('validate rejects a metric whose saved query fails normal parsing', async () => {
    writeFileSync(join(sandbox, '.dbcli', 'queries', 'revenue.sql'), 'not valid SQL')

    await run('validate')

    expect(exitCode).toBe(1)
    expect(errors).toContain('must reference an available saved query')
  })

  void logSpy
  void errorSpy
  void exitSpy
})

afterAll(() => mock.restore())
