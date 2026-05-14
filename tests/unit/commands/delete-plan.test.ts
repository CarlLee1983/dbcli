import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { AdapterFactory } from '@/adapters'
import { configModule } from '@/core/config'
import { deleteCommand } from '@/commands/delete'
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

describe('deleteCommand --plan', () => {
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
    await deleteCommand('users', {
      where: 'id=1',
      plan: true,
      format: 'json',
    } as any)

    const parsed = JSON.parse(lastLog())
    expect(parsed.decision).toBe('ALLOW')
    expect(parsed.operation).toBe('DELETE')
    expect(parsed.targetTables).toEqual(['users'])
    expect(createSqlAdapterSpy).not.toHaveBeenCalled()
  })

  test('text default omits suggestedCommands', async () => {
    await deleteCommand('users', { where: 'id=1', plan: true } as any)

    const out = lastLog()
    expect(out).toContain('Decision: ALLOW')
    expect(out).toContain('Operation: DELETE')
    expect(out).not.toContain('suggestedCommands')
  })

  test('BLOCK on insufficient permission exits 0 (no admin gate before --plan)', async () => {
    mockConfig = makeConfig({ permission: 'read-only' })
    configReadSpy.mockImplementation(async () => mockConfig)
    const exitSpy = spyOn(process, 'exit').mockImplementation((() => undefined) as never)

    await deleteCommand('users', {
      where: 'id=1',
      plan: true,
      format: 'json',
    } as any)

    const parsed = JSON.parse(lastLog())
    expect(parsed.decision).toBe('BLOCK')
    expect(parsed.riskFactors.map((f: { code: string }) => f.code)).toContain(
      'permission_denied'
    )
    expect(exitSpy).not.toHaveBeenCalled()
    exitSpy.mockRestore()
  })

  test('BLOCK on blacklisted table exits 0', async () => {
    mockConfig = makeConfig({ blacklist: { tables: ['users'], columns: {} } })
    configReadSpy.mockImplementation(async () => mockConfig)
    const exitSpy = spyOn(process, 'exit').mockImplementation((() => undefined) as never)

    await deleteCommand('users', {
      where: 'id=1',
      plan: true,
      format: 'json',
    } as any)

    const parsed = JSON.parse(lastLog())
    expect(parsed.decision).toBe('BLOCK')
    expect(exitSpy).not.toHaveBeenCalled()
    exitSpy.mockRestore()
  })

  test('--plan + --dry-run is rejected', async () => {
    const exitSpy = spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('exit')
    })

    try {
      await deleteCommand('users', { where: 'id=1', plan: true, dryRun: true } as any)
    } catch {
      // process.exit is mocked to throw
    }

    expect(errorSpy.mock.calls.flat().join('\n')).toContain(
      '--plan cannot be used with --dry-run'
    )
    expect(exitSpy).toHaveBeenCalledWith(1)
    exitSpy.mockRestore()
  })

  test('--plan against Redis connection rejected with SQL-only message', async () => {
    mockConfig = makeConfig({
      connection: { system: 'redis', host: 'localhost', port: 6379 } as any,
    })
    configReadSpy.mockImplementation(async () => mockConfig)
    const exitSpy = spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('exit')
    })

    try {
      await deleteCommand('users', { where: 'id=1', plan: true, format: 'json' } as any)
    } catch {
      // process.exit is mocked to throw
    }

    expect(errorSpy.mock.calls.flat().join('\n')).toContain(
      '--plan for insert/update/delete currently supports SQL connections only'
    )
    expect(exitSpy).toHaveBeenCalledWith(1)
    exitSpy.mockRestore()
  })

  test('--plan still requires --where', async () => {
    const exitSpy = spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('exit')
    })

    try {
      await deleteCommand('users', { plan: true, format: 'json' } as any)
    } catch {
      // process.exit is mocked to throw
    }

    expect(exitSpy).toHaveBeenCalledWith(1)
    exitSpy.mockRestore()
  })
})
