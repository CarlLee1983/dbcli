import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { AdapterFactory } from '@/adapters'
import { planCommand } from '@/commands/plan'
import { configModule } from '@/core/config'
import type { DbcliConfig } from '@/utils/validation'

let mockConfig: DbcliConfig
let configReadSpy: any
let logSpy: any
let errorSpy: any
let createAdapterSpy: any

function lastLog(): string {
  return String(logSpy.mock.calls.at(-1)?.[0] ?? '')
}

describe('planCommand', () => {
  beforeEach(() => {
    mockConfig = {
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
            { name: 'email', type: 'varchar', nullable: false },
            { name: 'status', type: 'varchar', nullable: false },
          ],
        },
      },
      metadata: { version: '1.0' },
      blacklist: { tables: [], columns: {} },
    }

    configReadSpy = spyOn(configModule, 'read').mockImplementation(async () => mockConfig)
    logSpy = spyOn(console, 'log').mockImplementation(() => {})
    errorSpy = spyOn(console, 'error').mockImplementation(() => {})
    createAdapterSpy = spyOn(AdapterFactory, 'createAdapter')
  })

  afterEach(() => {
    configReadSpy.mockRestore()
    logSpy.mockRestore()
    errorSpy.mockRestore()
    createAdapterSpy.mockRestore()
  })

  test('prints concise text output by default and omits suggestedCommands', async () => {
    await planCommand("UPDATE users SET status = 'inactive'", {})

    const output = lastLog()
    expect(output).toContain('Decision: BLOCK')
    expect(output).toContain('Operation: UPDATE')
    expect(output).toContain('Target tables: users')
    expect(output).toContain('Risk factors:')
    expect(output).toContain('- UPDATE statement has no WHERE clause.')
    expect(output).toContain('Recommendations:')
    expect(output).not.toContain('suggestedCommands')
  })

  test('prints stable JSON output with suggestedCommands', async () => {
    await planCommand('SELECT id FROM invoices WHERE id = 1', { format: 'json' })

    const parsed = JSON.parse(lastLog())
    expect(parsed).toEqual({
      decision: 'WARN',
      operation: 'SELECT',
      targetTables: ['invoices'],
      riskFactors: [
        {
          code: 'schema_table_unknown',
          severity: 'warn',
          message: 'Target table invoices is missing from schema cache.',
        },
      ],
      recommendations: ['Refresh schema cache for the target table before executing.'],
      suggestedCommands: ['dbcli schema invoices --format json'],
    })
  })

  test('validates format option', async () => {
    const exitSpy = spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('exit')
    })

    try {
      await planCommand('SELECT 1', { format: 'yaml' as never })
    } catch {
      // process.exit is mocked to throw
    }

    expect(errorSpy.mock.calls.flat().join('\n')).toContain(
      'Invalid format "yaml" for plan. Allowed: text, json'
    )
    expect(exitSpy).toHaveBeenCalledWith(1)
    exitSpy.mockRestore()
  })

  test('requires initialized config', async () => {
    mockConfig.connection = undefined as never
    const exitSpy = spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('exit')
    })

    try {
      await planCommand('SELECT 1', {})
    } catch {
      // process.exit is mocked to throw
    }

    expect(errorSpy.mock.calls.flat().join('\n')).toContain('Run "dbcli init" first')
    expect(exitSpy).toHaveBeenCalledWith(1)
    exitSpy.mockRestore()
  })

  test('does not create a database adapter or connect to database', async () => {
    await planCommand('SELECT id FROM users WHERE id = 1 LIMIT 1', { format: 'json' })

    expect(createAdapterSpy).not.toHaveBeenCalled()
    const parsed = JSON.parse(lastLog())
    expect(parsed.decision).toBe('ALLOW')
  })

  test('missing schema cache warns without treating empty object as known cache', async () => {
    mockConfig.schema = {}

    await planCommand('SELECT id FROM users WHERE id = 1', { format: 'json' })

    const parsed = JSON.parse(lastLog())
    expect(parsed.decision).toBe('WARN')
    expect(parsed.riskFactors).toContainEqual({
      code: 'schema_cache_missing',
      severity: 'warn',
      message: 'Schema cache is missing for the selected connection.',
    })
  })
})
