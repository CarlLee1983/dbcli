import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { Command } from 'commander'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { contractCommand } from '@/commands/contracts'

const CONFIG = {
  connection: { system: 'postgresql', host: 'localhost', port: 5432, user: 'user', database: 'app' },
  permission: 'query-only',
  blacklist: { tables: [], columns: {} },
  schema: {
    orders: {
      name: 'orders',
      columns: [{ name: 'created_at', type: 'timestamp', nullable: false }],
    },
  },
}

function makeRoot(): Command {
  const program = new Command().name('dbcli').exitOverride().enablePositionalOptions()
  program.option('--config <path>', 'config path', '.dbcli')
  program.addCommand(contractCommand)
  return program
}

describe('contract commands', () => {
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
    sandbox = mkdtempSync(join(tmpdir(), 'dbcli-contract-command-'))
    configPath = join(sandbox, 'config.json')
    writeFileSync(configPath, JSON.stringify(CONFIG))
    mkdirSync(join(sandbox, '.dbcli', 'queries'), { recursive: true })
    writeFileSync(
      join(sandbox, 'dbcli.semantic.json'),
      JSON.stringify({
        version: 1,
        models: [{ name: 'orders', table: 'orders', fields: [{ column: 'created_at' }] }],
        metrics: [],
      })
    )
    writeFileSync(
      join(sandbox, 'dbcli.contracts.json'),
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
            description: 'A proposed customer term.',
            subjects: ['model:orders'],
            owner: 'growth',
            evidencePolicy: 'none',
          },
        ],
      })
    )
    process.chdir(sandbox)
  })

  afterEach(() => {
    process.chdir(cwd)
    if (sandbox && existsSync(sandbox)) rmSync(sandbox, { recursive: true, force: true })
  })

  afterEach(() => {
    logSpy.mockClear()
    errorSpy.mockClear()
    exitSpy.mockClear()
  })

  async function run(...args: string[]): Promise<void> {
    await makeRoot().parseAsync(['bun', 'dbcli', '--config', configPath, 'contract', ...args], {
      from: 'node',
    })
  }

  test('context and search expose only approved valid contracts', async () => {
    await run('context', '--format', 'json')
    expect(JSON.parse(output)).toMatchObject([{ name: 'active-customer', status: 'approved' }])
    expect(output).not.toContain('future-customer')

    output = ''
    await run('search', 'customer', '--format', 'json')
    expect(JSON.parse(output)).toMatchObject([{ name: 'active-customer' }])
    expect(output).not.toContain('future-customer')
  })

  test('validate and drift are offline reports with stable JSON', async () => {
    await run('validate', '--format', 'json')
    expect(JSON.parse(output)).toMatchObject({ valid: true, approved: 1, draft: 1 })
    expect(exitCode).toBeUndefined()

    output = ''
    await run('drift', '--format', 'json')
    expect(JSON.parse(output)).toEqual({ status: 'valid', issues: [] })
    expect(exitCode).toBeUndefined()
    expect(errors).toBe('')
  })

  test('validates a saved-query metric contract without a schema cache', async () => {
    writeFileSync(configPath, JSON.stringify({ ...CONFIG, schema: {} }))
    writeFileSync(
      join(sandbox, '.dbcli', 'queries', 'revenue.sql'),
      '-- ---\n-- description: Revenue\n-- ---\nSELECT 1'
    )
    writeFileSync(
      join(sandbox, 'dbcli.semantic.json'),
      JSON.stringify({
        version: 1,
        models: [],
        metrics: [{ name: 'daily-revenue', query: '@revenue' }],
      })
    )
    writeFileSync(
      join(sandbox, 'dbcli.contracts.json'),
      JSON.stringify({
        version: 1,
        contracts: [
          {
            name: 'daily-revenue',
            status: 'approved',
            description: 'A daily revenue metric.',
            subjects: ['metric:daily-revenue'],
            owner: 'growth',
            evidencePolicy: 'receipt-required',
          },
        ],
      })
    )

    await run('validate', '--format', 'json')

    expect(JSON.parse(output)).toMatchObject({ valid: true, approved: 1 })
    expect(exitCode).toBeUndefined()
  })
})
