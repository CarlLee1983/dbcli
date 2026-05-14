import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { AdapterFactory } from '@/adapters'
import { configModule } from '@/core/config'
import { runDmlPlanAnalysis } from '@/commands/dml-plan'
import type { DbcliConfig } from '@/utils/validation'

let mockConfig: DbcliConfig
let configReadSpy: any
let logSpy: any
let errorSpy: any
let createSqlAdapterSpy: any
let createMongoAdapterSpy: any

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

describe('runDmlPlanAnalysis', () => {
  beforeEach(() => {
    mockConfig = makeConfig()
    configReadSpy = spyOn(configModule, 'read').mockImplementation(async () => mockConfig)
    logSpy = spyOn(console, 'log').mockImplementation(() => {})
    errorSpy = spyOn(console, 'error').mockImplementation(() => {})
    createSqlAdapterSpy = spyOn(AdapterFactory, 'createSqlAdapter')
    createMongoAdapterSpy = spyOn(AdapterFactory, 'createMongoDBAdapter')
  })

  afterEach(() => {
    configReadSpy.mockRestore()
    logSpy.mockRestore()
    errorSpy.mockRestore()
    createSqlAdapterSpy.mockRestore()
    createMongoAdapterSpy.mockRestore()
  })

  test('prints JSON QueryRiskResult for ALLOW path', async () => {
    await runDmlPlanAnalysis('UPDATE users SET status = ? WHERE id = ?', { format: 'json' })

    const parsed = JSON.parse(lastLog())
    expect(parsed.decision).toBe('ALLOW')
    expect(parsed.operation).toBe('UPDATE')
    expect(parsed.targetTables).toEqual(['users'])
    expect(parsed.suggestedCommands).toEqual([])
  })

  test('prints concise text by default and omits suggestedCommands', async () => {
    await runDmlPlanAnalysis('DELETE FROM users WHERE id = ?', {})

    const out = lastLog()
    expect(out).toContain('Decision: ALLOW')
    expect(out).toContain('Operation: DELETE')
    expect(out).toContain('Target tables: users')
    expect(out).not.toContain('suggestedCommands')
  })

  test('returns BLOCK with exit code 0 (no process.exit on analyzer BLOCK)', async () => {
    mockConfig = makeConfig({ blacklist: { tables: ['users'], columns: {} } })
    configReadSpy.mockImplementation(async () => mockConfig)
    const exitSpy = spyOn(process, 'exit').mockImplementation((() => undefined) as never)

    await runDmlPlanAnalysis('DELETE FROM users WHERE id = ?', { format: 'json' })

    const parsed = JSON.parse(lastLog())
    expect(parsed.decision).toBe('BLOCK')
    expect(exitSpy).not.toHaveBeenCalled()
    exitSpy.mockRestore()
  })

  test('returns WARN when schema cache is empty', async () => {
    mockConfig = makeConfig({ schema: {} })
    configReadSpy.mockImplementation(async () => mockConfig)

    await runDmlPlanAnalysis('UPDATE users SET status = ? WHERE id = ?', { format: 'json' })

    const parsed = JSON.parse(lastLog())
    expect(parsed.decision).toBe('WARN')
    expect(parsed.riskFactors.map((f: { code: string }) => f.code)).toContain(
      'schema_cache_missing'
    )
  })

  test('rejects non-SQL engine with non-zero exit and clear message', async () => {
    mockConfig = makeConfig({
      connection: { system: 'mongodb', uri: 'mongodb://localhost', database: 'test' } as any,
    })
    configReadSpy.mockImplementation(async () => mockConfig)
    const exitSpy = spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('exit')
    })

    try {
      await runDmlPlanAnalysis('DELETE FROM users WHERE id = ?', { format: 'json' })
    } catch {
      // process.exit is mocked to throw
    }

    expect(errorSpy.mock.calls.flat().join('\n')).toContain(
      '--plan for insert/update/delete currently supports SQL connections only'
    )
    expect(exitSpy).toHaveBeenCalledWith(1)
    exitSpy.mockRestore()
  })

  test('does not create any adapter or open a connection', async () => {
    await runDmlPlanAnalysis('UPDATE users SET status = ? WHERE id = ?', { format: 'json' })

    expect(createSqlAdapterSpy).not.toHaveBeenCalled()
    expect(createMongoAdapterSpy).not.toHaveBeenCalled()
  })

  test('exits non-zero when config has no connection', async () => {
    mockConfig = makeConfig()
    mockConfig.connection = undefined as never
    configReadSpy.mockImplementation(async () => mockConfig)
    const exitSpy = spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('exit')
    })

    try {
      await runDmlPlanAnalysis('UPDATE users SET status = ? WHERE id = ?', { format: 'json' })
    } catch {
      // process.exit is mocked to throw
    }

    expect(errorSpy.mock.calls.flat().join('\n')).toContain('Run "dbcli init"')
    expect(exitSpy).toHaveBeenCalledWith(1)
    exitSpy.mockRestore()
  })

  test('rejects invalid --format value', async () => {
    const exitSpy = spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('exit')
    })

    try {
      await runDmlPlanAnalysis('UPDATE users SET status = ? WHERE id = ?', {
        format: 'yaml' as never,
      })
    } catch {
      // process.exit is mocked to throw
    }

    expect(errorSpy.mock.calls.flat().join('\n')).toContain(
      'Invalid format "yaml" for plan. Allowed: text, json'
    )
    expect(exitSpy).toHaveBeenCalledWith(1)
    exitSpy.mockRestore()
  })
})
