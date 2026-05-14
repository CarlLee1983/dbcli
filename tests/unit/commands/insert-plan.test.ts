import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { AdapterFactory } from '@/adapters'
import { configModule } from '@/core/config'
import { insertCommand } from '@/commands/insert'
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
          { name: 'name', type: 'varchar', nullable: false },
          { name: 'email', type: 'varchar', nullable: false },
        ],
      },
    },
    metadata: { version: '1.0' },
    blacklist: { tables: [], columns: {} },
    ...overrides,
  } as DbcliConfig
}

describe('insertCommand --plan', () => {
  let originalIsTTY: boolean | undefined

  beforeEach(() => {
    // Force isStdinAvailable() to return false so insertCommand does not try to
    // read JSON from a real stdin stream when --data is omitted in tests.
    originalIsTTY = (process.stdin as { isTTY?: boolean }).isTTY
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true })

    mockConfig = makeConfig()
    configReadSpy = spyOn(configModule, 'read').mockImplementation(async () => mockConfig)
    logSpy = spyOn(console, 'log').mockImplementation(() => {})
    errorSpy = spyOn(console, 'error').mockImplementation(() => {})
    createSqlAdapterSpy = spyOn(AdapterFactory, 'createSqlAdapter')
  })

  afterEach(() => {
    Object.defineProperty(process.stdin, 'isTTY', {
      value: originalIsTTY,
      configurable: true,
    })
    configReadSpy.mockRestore()
    logSpy.mockRestore()
    errorSpy.mockRestore()
    createSqlAdapterSpy.mockRestore()
  })

  test('returns ALLOW JSON without creating an adapter', async () => {
    await insertCommand('users', {
      data: '{"name":"Alice","email":"a@example.com"}',
      plan: true,
      format: 'json',
    } as any)

    const parsed = JSON.parse(lastLog())
    expect(parsed.decision).toBe('ALLOW')
    expect(parsed.operation).toBe('INSERT')
    expect(parsed.targetTables).toEqual(['users'])
    expect(createSqlAdapterSpy).not.toHaveBeenCalled()
  })

  test('text default omits suggestedCommands', async () => {
    await insertCommand('users', {
      data: '{"name":"Alice","email":"a@example.com"}',
      plan: true,
    } as any)

    const out = lastLog()
    expect(out).toContain('Decision: ALLOW')
    expect(out).toContain('Operation: INSERT')
    expect(out).not.toContain('suggestedCommands')
  })

  test('BLOCK on blacklisted table exits 0', async () => {
    mockConfig = makeConfig({ blacklist: { tables: ['users'], columns: {} } })
    configReadSpy.mockImplementation(async () => mockConfig)
    const exitSpy = spyOn(process, 'exit').mockImplementation((() => undefined) as never)

    await insertCommand('users', {
      data: '{"name":"Alice"}',
      plan: true,
      format: 'json',
    } as any)

    const parsed = JSON.parse(lastLog())
    expect(parsed.decision).toBe('BLOCK')
    expect(exitSpy).not.toHaveBeenCalled()
    exitSpy.mockRestore()
  })

  test('--plan + --dry-run is rejected with non-zero exit', async () => {
    const exitSpy = spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('exit')
    })

    try {
      await insertCommand('users', {
        data: '{"name":"Alice"}',
        plan: true,
        dryRun: true,
      } as any)
    } catch {
      // process.exit is mocked to throw
    }

    expect(errorSpy.mock.calls.flat().join('\n')).toContain('--plan cannot be used with --dry-run')
    expect(exitSpy).toHaveBeenCalledWith(1)
    exitSpy.mockRestore()
  })

  test('--plan against MongoDB connection is rejected with SQL-only message', async () => {
    mockConfig = makeConfig({
      connection: { system: 'mongodb', uri: 'mongodb://localhost', database: 'test' } as any,
    })
    configReadSpy.mockImplementation(async () => mockConfig)
    const exitSpy = spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('exit')
    })

    try {
      await insertCommand('users', {
        data: '{"name":"Alice"}',
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

  test('still requires JSON data when --plan is set', async () => {
    const exitSpy = spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('exit')
    })

    try {
      await insertCommand('users', { plan: true, format: 'json' } as any)
    } catch {
      // process.exit is mocked to throw
    }

    expect(exitSpy).toHaveBeenCalledWith(1)
    exitSpy.mockRestore()
  })
})
