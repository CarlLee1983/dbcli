import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { AdapterFactory } from '@/adapters'
import { configModule } from '@/core/config'
import { updateCommand } from '@/commands/update'
import type { DbcliConfig } from '@/utils/validation'

let mockConfig: DbcliConfig
let configReadSpy: any
let logSpy: any
let errorSpy: any
let createSqlAdapterSpy: any

function lastLog(): string {
  return String(logSpy.mock.calls.at(-1)?.[0] ?? '')
}

function makeConfig(overrides: Partial<DbcliConfig> = {}): DbcliConfig {
  return {
    connection: {
      system: 'postgresql',
      host: 'localhost',
      port: 5432,
      user: 'test',
      password: 'test',
      database: 'testdb',
    },
    permission: 'admin',
    schema: {
      users: {
        name: 'users',
        estimatedRowCount: 100,
        columns: [
          { name: 'id', type: 'integer', nullable: false },
          { name: 'status', type: 'varchar', nullable: false },
        ],
      },
    },
    metadata: { version: '1.0' },
    blacklist: { tables: [], columns: {} },
    ...overrides,
  } as DbcliConfig
}

describe('updateCommand --plan', () => {
  beforeEach(() => {
    mockConfig = makeConfig()
    configReadSpy = spyOn(configModule, 'read').mockImplementation(async () => mockConfig)
    logSpy = spyOn(console, 'log').mockImplementation(() => {})
    errorSpy = spyOn(console, 'error').mockImplementation(() => {})
    createSqlAdapterSpy = spyOn(AdapterFactory, 'createSqlAdapter')
  })

  afterEach(() => {
    configReadSpy.mockRestore()
    logSpy.mockRestore()
    errorSpy.mockRestore()
    createSqlAdapterSpy.mockRestore()
  })

  test('returns ALLOW JSON without creating an adapter', async () => {
    await updateCommand('users', {
      where: 'id=1',
      set: '{"status":"inactive"}',
      plan: true,
      format: 'json',
    } as any)

    const parsed = JSON.parse(lastLog())
    expect(parsed.decision).toBe('ALLOW')
    expect(parsed.operation).toBe('UPDATE')
    expect(parsed.targetTables).toEqual(['users'])
    expect(createSqlAdapterSpy).not.toHaveBeenCalled()
  })

  test('default text output omits suggestedCommands', async () => {
    await updateCommand('users', {
      where: 'id=1',
      set: '{"status":"inactive"}',
      plan: true,
    } as any)

    const out = lastLog()
    expect(out).toContain('Decision: ALLOW')
    expect(out).toContain('Operation: UPDATE')
    expect(out).not.toContain('suggestedCommands')
  })

  test('WARN when schema cache empty', async () => {
    mockConfig = makeConfig({ schema: {} })
    configReadSpy.mockImplementation(async () => mockConfig)

    await updateCommand('users', {
      where: 'id=1',
      set: '{"status":"inactive"}',
      plan: true,
      format: 'json',
    } as any)

    const parsed = JSON.parse(lastLog())
    expect(parsed.decision).toBe('WARN')
    expect(parsed.riskFactors.map((f: { code: string }) => f.code)).toContain(
      'schema_cache_missing'
    )
  })

  test('--plan + --dry-run is rejected', async () => {
    const exitSpy = spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('exit')
    })

    try {
      await updateCommand('users', {
        where: 'id=1',
        set: '{"status":"inactive"}',
        plan: true,
        dryRun: true,
      } as any)
    } catch {
      // process.exit is mocked to throw
    }

    expect(errorSpy.mock.calls.flat().join('\n')).toContain(
      '--plan cannot be used with --dry-run'
    )
    expect(exitSpy).toHaveBeenCalledWith(1)
    exitSpy.mockRestore()
  })

  test('--plan against MongoDB connection rejected', async () => {
    mockConfig = makeConfig({
      connection: { system: 'mongodb', uri: 'mongodb://localhost', database: 'test' } as any,
    })
    configReadSpy.mockImplementation(async () => mockConfig)
    const exitSpy = spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('exit')
    })

    try {
      await updateCommand('users', {
        where: 'id=1',
        set: '{"status":"inactive"}',
        plan: true,
        format: 'json',
      } as any)
    } catch {
      // process.exit is mocked to throw
    }

    expect(errorSpy.mock.calls.flat().join('\n')).toContain(
      '--plan for insert/update/delete currently supports SQL connections only'
    )
    expect(exitSpy).toHaveBeenCalledWith(1)
    exitSpy.mockRestore()
  })

  test('--plan still requires --where and --set', async () => {
    const exitSpy = spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('exit')
    })

    try {
      await updateCommand('users', { plan: true, format: 'json' } as any)
    } catch {
      // process.exit is mocked to throw
    }

    expect(exitSpy).toHaveBeenCalledWith(1)
    exitSpy.mockRestore()
  })
})
