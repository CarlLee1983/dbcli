import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { Command } from 'commander'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { contractCommand } from '@/commands/contracts'
import { AdapterFactory } from '@/adapters/factory'

const CONFIG = {
  connection: {
    system: 'postgresql',
    host: 'localhost',
    port: 5432,
    user: 'user',
    database: 'app',
  },
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

  /** Clears captured output between assertions in one test. */
  function resetCapture(): void {
    output = ''
    errors = ''
    exitCode = undefined
  }

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

  /**
   * Content plus mtime for every file under the sandbox. A contract command
   * that wrote, rewrote, or touched an artifact changes this snapshot.
   */
  function snapshotWorkspace(directory: string): Record<string, string> {
    const snapshot: Record<string, string> = {}
    for (const entry of readdirSync(directory, { recursive: true, withFileTypes: true })) {
      const path = join(entry.parentPath, entry.name)
      if (!entry.isFile()) continue
      snapshot[relative(directory, path)] =
        `${statSync(path).mtimeMs}:${readFileSync(path, 'utf8')}`
    }
    return snapshot
  }

  test('every contract command stays offline and leaves the workspace untouched', async () => {
    // `unreachable.invalid` fails DNS rather than hanging, so a command that
    // did connect would surface here instead of passing on a mocked seam.
    writeFileSync(
      configPath,
      JSON.stringify({
        ...CONFIG,
        connection: { ...CONFIG.connection, host: 'unreachable.invalid' },
      })
    )
    const before = snapshotWorkspace(sandbox)
    expect(Object.keys(before)).toContain('dbcli.contracts.json')
    // The workspace snapshot is what actually bounds this: a command that
    // imported an adapter directly would slip past these spies.
    const adapterSpies = [
      spyOn(AdapterFactory, 'createAdapter'),
      spyOn(AdapterFactory, 'createAdapterWithoutRules'),
      spyOn(AdapterFactory, 'createSqlAdapter'),
      spyOn(AdapterFactory, 'createMongoDBAdapter'),
      spyOn(AdapterFactory, 'createRedisAdapter'),
      spyOn(AdapterFactory, 'createElasticsearchAdapter'),
    ]

    try {
      await run('validate', '--format', 'json')
      await run('context', '--format', 'json')
      await run('context', '--format', 'markdown')
      await run('search', 'customer', '--format', 'json')
      await run('drift', '--format', 'json')

      for (const adapterSpy of adapterSpies) expect(adapterSpy).not.toHaveBeenCalled()
      expect(snapshotWorkspace(sandbox)).toEqual(before)
      expect(errors).toBe('')
      expect(exitCode).toBeUndefined()
    } finally {
      for (const adapterSpy of adapterSpies) adapterSpy.mockRestore()
    }
  }, 15_000)

  test('an explicitly requested missing artifact fails closed without a local path', async () => {
    const missing = join(realpathSync(sandbox), 'review', 'absent-contracts.json')

    await run('validate', '--file', missing)

    expect(exitCode).toBe(1)
    expect(output).toBe('')
    expect(errors).toContain('file not found')
    expect(errors).not.toContain(missing)
    expect(errors).not.toMatch(/(^|[\s:'"])\//m)
  })

  test('an invalid artifact fails closed without reproducing its own input', async () => {
    const seededKey = 'SECRET-4b17-/Users/example/private/leak.txt'
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
            [seededKey]: 'x',
          },
        ],
      })
    )

    await run('validate', '--format', 'json')
    expect(exitCode).toBe(1)
    expect(output).toBe('')
    expect(errors).toContain('must contain only these properties')
    expect(errors).not.toContain(seededKey)
    expect(errors).not.toContain('SECRET')

    resetCapture()
    await run('context', '--format', 'json')
    expect(exitCode).toBe(1)
    expect(output).toBe('')
    expect(errors).not.toContain(seededKey)

    resetCapture()
    await run('drift', '--format', 'json')
    expect(exitCode).toBe(1)
    expect(JSON.parse(output)).toMatchObject({ status: 'invalid' })
    expect(output).not.toContain(seededKey)
    expect(output).not.toContain('SECRET')
  })

  test('an unsupported subject form is invalid drift, not stale drift', async () => {
    writeFileSync(
      join(sandbox, 'dbcli.contracts.json'),
      JSON.stringify({
        version: 1,
        contracts: [
          {
            name: 'active-customer',
            status: 'approved',
            description: 'A customer with a recent paid order.',
            subjects: ['table:orders'],
            owner: 'growth',
            evidencePolicy: 'none',
          },
        ],
      })
    )

    await run('drift', '--format', 'json')

    expect(exitCode).toBe(1)
    expect(JSON.parse(output)).toEqual({
      status: 'invalid',
      issues: [
        {
          path: '$.contracts[0].subjects[0]',
          message: 'must use a supported semantic subject form',
        },
      ],
    })
  })

  test('an absent artifact is unavailable drift and a fail-closed explicit request', async () => {
    rmSync(join(sandbox, 'dbcli.contracts.json'))

    await run('drift', '--format', 'json')
    expect(JSON.parse(output)).toEqual({
      status: 'unavailable',
      issues: [{ path: '$', message: 'contract file is unavailable' }],
    })
    expect(exitCode).toBe(1)

    resetCapture()
    await run('validate', '--format', 'json')
    expect(exitCode).toBe(1)
    expect(errors).toContain('file not found')
  })

  test('a config failure is bounded and never prints a local path', async () => {
    const leakyConfig = join(realpathSync(sandbox), 'SECRET-token-config.json')
    writeFileSync(leakyConfig, '{ broken json')

    await makeRoot().parseAsync(
      ['bun', 'dbcli', '--config', leakyConfig, 'contract', 'validate', '--format', 'json'],
      { from: 'node' }
    )

    expect(exitCode).toBe(1)
    expect(output).toBe('')
    expect(errors).toContain('contract command failed')
    expect(errors).not.toContain(leakyConfig)
    expect(errors).not.toContain('SECRET')
    expect(errors).not.toMatch(/(^|[\s:'"([=])\//m)
  })

  test('reads saved-query keys without parsing or reporting their SQL bodies', async () => {
    const seededSql = 'KEYS not-a-select-statement'
    writeFileSync(join(sandbox, '.dbcli', 'queries', 'bad.sql'), seededSql)

    await run('validate', '--format', 'json')

    expect(JSON.parse(output)).toMatchObject({ valid: true, approved: 1 })
    expect(exitCode).toBeUndefined()
    // `loadSnippets` would parse the body and warn about it on stderr.
    expect(errors).toBe('')
    expect(errors).not.toContain(seededSql)
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
