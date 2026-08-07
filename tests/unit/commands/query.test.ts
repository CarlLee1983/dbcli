/**
 * Unit tests for query command
 * Tests command logic, permission enforcement, formatting, and error handling
 */

import { describe, test, expect, beforeEach, afterEach, spyOn } from 'bun:test'
import type { DatabaseAdapter, ExecutionResult } from '@/adapters/types'
import type { DbcliConfig } from '@/utils/validation'
import { AdapterFactory } from '@/adapters'
import { configModule } from '@/core/config'
import { QueryResultFormatter } from '@/formatters'
import { queryCommand } from '@/commands/query'
import { QueryExecutor } from '@/core/query-executor'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Mock adapter for testing
class MockAdapter implements DatabaseAdapter {
  private shouldFail = false
  private failureMessage = ''
  disconnectError?: Error
  lastSql?: string

  setFailure(shouldFail: boolean, message = '') {
    this.shouldFail = shouldFail
    this.failureMessage = message
  }

  async connect(): Promise<void> {
    if (this.shouldFail && this.failureMessage.includes('connection')) {
      throw new Error('Connection failed')
    }
  }

  async disconnect(): Promise<void> {
    if (this.disconnectError) throw this.disconnectError
  }

  async execute<T>(sql: string): Promise<ExecutionResult<T>> {
    this.lastSql = sql
    if (this.shouldFail) {
      throw new Error(this.failureMessage || 'Query failed')
    }

    if (sql.includes('SELECT')) {
      const data = [
        { id: 1, name: 'Alice', email: 'alice@example.com' },
        { id: 2, name: 'Bob', email: 'bob@example.com' },
      ] as T[]
      return { rows: data, affectedRows: data.length }
    }

    return { rows: [] as T[], affectedRows: 0 }
  }

  async listTables() {
    return [
      { name: 'users', columns: [], rowCount: 100 },
      { name: 'orders', columns: [], rowCount: 50 },
    ]
  }

  async getTableSchema() {
    return {
      name: 'users',
      columns: [
        { name: 'id', type: 'integer', nullable: false },
        { name: 'name', type: 'varchar', nullable: false },
      ],
    }
  }

  async testConnection(): Promise<boolean> {
    return true
  }

  async getServerVersion(): Promise<string> {
    return 'test'
  }
}

let mockAdapter: MockAdapter
let mockConfig: DbcliConfig
let createAdapterSpy: any
let configReadSpy: any
let formatterSpy: any
let queryExecutorSpy: any

describe('Query Command', () => {
  beforeEach(() => {
    mockAdapter = new MockAdapter()
    createAdapterSpy = spyOn(AdapterFactory, 'createSqlAdapter').mockReturnValue(mockAdapter as any)
    configReadSpy = spyOn(configModule, 'read').mockImplementation(async () => mockConfig)
    formatterSpy = spyOn(QueryResultFormatter.prototype, 'format').mockImplementation(
      (result: any, options?: any) => {
        const format = options?.format || 'table'
        if (format === 'json') {
          return JSON.stringify(result, null, 2)
        } else if (format === 'csv') {
          const headers = result.columnNames.join(',')
          const rows = result.rows
            .map((row: any) => result.columnNames.map((col: string) => row[col]).join(','))
            .join('\n')
          return `${headers}\n${rows}`
        }
        return `Table: ${result.rowCount} rows`
      }
    )
    mockConfig = {
      connection: {
        system: 'postgresql',
        host: 'localhost',
        port: 5432,
        user: 'test',
        password: 'test',
        database: 'testdb',
      },
      permission: 'query-only',
      schema: {},
      metadata: { version: '1.0' },
      blacklist: { tables: [], columns: {} },
    }
  })

  afterEach(() => {
    createAdapterSpy.mockRestore()
    configReadSpy.mockRestore()
    formatterSpy.mockRestore()
    queryExecutorSpy?.mockRestore()
  })

  describe('Argument Validation', () => {
    test('should reject missing SQL argument', async () => {
      await expect(queryCommand(undefined, {})).rejects.toThrow('Exactly one query source')
      expect(configReadSpy).not.toHaveBeenCalled()
      expect(createAdapterSpy).not.toHaveBeenCalled()
    })

    test('rejects invalid slow-query threshold before reading config or connecting', async () => {
      await expect(queryCommand('SELECT 1', { slowMs: -1 })).rejects.toThrow(
        'slow-ms must be a non-negative integer'
      )
      expect(configReadSpy).not.toHaveBeenCalled()
      expect(createAdapterSpy).not.toHaveBeenCalled()
    })

    test('should reject empty SQL string', async () => {
      await expect(queryCommand('   ', {})).rejects.toThrow('Query input is empty')
      expect(configReadSpy).not.toHaveBeenCalled()
    })

    test('should reject positional and file sources before config access', async () => {
      await expect(queryCommand('SELECT 1', { queryFile: 'query.sql' })).rejects.toThrow(
        'Query source conflict'
      )
      expect(configReadSpy).not.toHaveBeenCalled()
      expect(createAdapterSpy).not.toHaveBeenCalled()
    })

    test('should report a missing file before config access', async () => {
      const path = join(tmpdir(), `dbcli-missing-query-${crypto.randomUUID()}.sql`)
      await expect(queryCommand(undefined, { queryFile: path })).rejects.toThrow(path)
      expect(configReadSpy).not.toHaveBeenCalled()
      expect(createAdapterSpy).not.toHaveBeenCalled()
    })

    test('should reject invalid field selection before config access', async () => {
      await expect(queryCommand('SELECT 1', { fields: 'id,-secret' })).rejects.toThrow('cannot mix')
      expect(configReadSpy).not.toHaveBeenCalled()
      expect(createAdapterSpy).not.toHaveBeenCalled()
    })

    test('should reject invalid and conflicting truncation options before config access', async () => {
      for (const options of [
        { truncate: 0 },
        { truncate: -1 },
        { truncate: Number.NaN },
        { truncate: 120, noTruncate: true },
      ]) {
        await expect(queryCommand('SELECT 1', options)).rejects.toThrow(/truncate|positive integer/)
        expect(configReadSpy).not.toHaveBeenCalled()
        expect(createAdapterSpy).not.toHaveBeenCalled()
      }
    })

    test('should reject explicit truncation for non-table formats before config access', async () => {
      for (const format of ['json', 'csv', 'html'] as const) {
        await expect(queryCommand('SELECT 1', { format, truncate: 120 })).rejects.toThrow(
          '--format table'
        )
        expect(configReadSpy).not.toHaveBeenCalled()
        expect(createAdapterSpy).not.toHaveBeenCalled()
      }

      await expect(queryCommand('SELECT 1', { ui: true, truncate: 120 })).rejects.toThrow(
        '--format table'
      )
      expect(configReadSpy).not.toHaveBeenCalled()
      expect(createAdapterSpy).not.toHaveBeenCalled()
    })

    test('should accept valid SQL string', async () => {
      const logSpy = spyOn(console, 'log').mockImplementation(() => {})

      await queryCommand('SELECT * FROM users', {})

      expect(logSpy).toHaveBeenCalled()
      logSpy.mockRestore()
    })

    test('should execute multiline SQL loaded from a UTF-8 file', async () => {
      const directory = await mkdtemp(join(tmpdir(), 'dbcli-query-input-'))
      const path = join(directory, 'multiline.sql')
      const sql = 'SELECT id,\n  name\nFROM users'
      const logSpy = spyOn(console, 'log').mockImplementation(() => {})

      try {
        await Bun.write(path, `\uFEFF${sql}\n`)
        await queryCommand(undefined, { queryFile: path })
        expect(mockAdapter.lastSql?.startsWith(sql)).toBe(true)
      } finally {
        logSpy.mockRestore()
        await rm(directory, { recursive: true, force: true })
      }
    })
  })

  test('does not print SQL diagnostics before a disconnect failure', async () => {
    mockAdapter.disconnectError = new Error('sql disconnect failed')
    const logSpy = spyOn(console, 'log').mockImplementation(() => {})
    const errorSpy = spyOn(console, 'error').mockImplementation(() => {})

    try {
      await expect(queryCommand('SELECT * FROM users', {})).rejects.toThrow('sql disconnect failed')
      expect(logSpy).not.toHaveBeenCalled()
      expect(errorSpy).not.toHaveBeenCalled()
    } finally {
      logSpy.mockRestore()
      errorSpy.mockRestore()
    }
  })

  describe('Configuration Loading', () => {
    test('should require initialized database', async () => {
      mockConfig.connection = undefined as any
      await expect(queryCommand('SELECT 1', {})).rejects.toThrow('dbcli init')
    })
  })

  describe('Result Formatting', () => {
    test('attaches a performance advisory when the measured query time crosses its threshold', async () => {
      queryExecutorSpy = spyOn(QueryExecutor.prototype, 'execute').mockResolvedValue({
        rows: [{ id: 1 }],
        rowCount: 1,
        columnNames: ['id'],
        executionTimeMs: 250,
        metadata: { statement: 'SELECT' },
      } as any)
      const logSpy = spyOn(console, 'log').mockImplementation(() => {})

      await queryCommand('SELECT 1', { slowMs: 200 })

      expect(formatterSpy.mock.calls[0]![0].metadata.performanceAdvisory).toMatchObject({
        code: 'SLOW_QUERY',
        executionTimeMs: 250,
        thresholdMs: 200,
      })
      logSpy.mockRestore()
    })

    test('suppresses the performance advisory under --recovery', async () => {
      queryExecutorSpy = spyOn(QueryExecutor.prototype, 'execute').mockResolvedValue({
        rows: [{ id: 1 }],
        rowCount: 1,
        columnNames: ['id'],
        executionTimeMs: 5000,
        metadata: { statement: 'SELECT' },
      } as any)
      const logSpy = spyOn(console, 'log').mockImplementation(() => {})

      await queryCommand('SELECT 1', { slowMs: 200, recovery: true })

      expect(formatterSpy.mock.calls[0]![0].metadata.performanceAdvisory).toBeUndefined()
      logSpy.mockRestore()
    })

    test('should project SQL fields in requested order', async () => {
      const logSpy = spyOn(console, 'log').mockImplementation(() => {})

      await queryCommand('SELECT * FROM users', { fields: 'name,id' })

      const formatted = formatterSpy.mock.calls[0]![0] as any
      expect(formatted.columnNames).toEqual(['name', 'id'])
      expect(formatted.rows).toEqual([
        { name: 'Alice', id: 1 },
        { name: 'Bob', id: 2 },
      ])
      logSpy.mockRestore()
    })

    test('should format as table by default', async () => {
      const logSpy = spyOn(console, 'log').mockImplementation(() => {})

      await queryCommand('SELECT * FROM users', {})

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Table:'))
      expect(formatterSpy.mock.calls[0]![1]).toMatchObject({ truncate: 120 })
      logSpy.mockRestore()
    })

    test('should pass explicit and disabled table truncation to the formatter', async () => {
      const logSpy = spyOn(console, 'log').mockImplementation(() => {})

      await queryCommand('SELECT * FROM users', { truncate: 24 })
      expect(formatterSpy.mock.calls[0]![1]).toMatchObject({ truncate: 24 })

      formatterSpy.mockClear()
      await queryCommand('SELECT * FROM users', { noTruncate: true })
      expect(formatterSpy.mock.calls[0]![1]).toMatchObject({ truncate: false })
      logSpy.mockRestore()
    })

    test('should format as JSON when requested', async () => {
      const logSpy = spyOn(console, 'log').mockImplementation(() => {})

      await queryCommand('SELECT * FROM users', { format: 'json' })

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('rowCount'))
      logSpy.mockRestore()
    })

    test('should format as CSV when requested', async () => {
      const logSpy = spyOn(console, 'log').mockImplementation(() => {})

      await queryCommand('SELECT * FROM users', { format: 'csv' })

      const calls = logSpy.mock.calls.flat().join('\n')
      expect(calls).toMatch(/id.*name.*email/)
      logSpy.mockRestore()
    })

    test('HTML output carries proven truncation into the dashboard payload', async () => {
      const logSpy = spyOn(console, 'log').mockImplementation(() => {})

      await queryCommand('SELECT * FROM users', { format: 'html', limit: 1 })

      const html = String(logSpy.mock.calls.at(-1)?.[0] ?? '')
      expect(html).toContain('"appliedLimit":{"truncated":true,"limitApplied":1}')
      logSpy.mockRestore()
    })
  })

  describe('Permission Enforcement', () => {
    test('should allow SELECT in query-only mode', async () => {
      mockConfig.permission = 'query-only'
      const logSpy = spyOn(console, 'log').mockImplementation(() => {})

      await queryCommand('SELECT * FROM users', {})

      expect(logSpy).toHaveBeenCalled()
      logSpy.mockRestore()
    })

    test('should block INSERT in query-only mode', async () => {
      mockConfig.permission = 'query-only'
      await expect(queryCommand('INSERT INTO users VALUES (1, "Eve")', {})).rejects.toThrow(
        'requires read-write or admin permission'
      )
    })

    test('should allow INSERT in read-write mode', async () => {
      mockConfig.permission = 'read-write'
      const logSpy = spyOn(console, 'log').mockImplementation(() => {})

      await queryCommand('INSERT INTO users VALUES (1, "Eve")', {})

      expect(logSpy).toHaveBeenCalled()
      logSpy.mockRestore()
    })

    test('should allow everything in admin mode', async () => {
      mockConfig.permission = 'admin'
      const logSpy = spyOn(console, 'log').mockImplementation(() => {})

      await queryCommand('DROP TABLE users', {})

      expect(logSpy).toHaveBeenCalled()
      logSpy.mockRestore()
    })
  })

  describe('Error Handling', () => {
    test('should propagate connection errors to the CLI boundary', async () => {
      mockAdapter.setFailure(true, 'connection error')
      await expect(queryCommand('SELECT 1', {})).rejects.toThrow('Connection failed')
    })

    test('should propagate query errors to the CLI boundary', async () => {
      mockAdapter.setFailure(true, 'syntax error')
      await expect(queryCommand('SELECT * FROM nonexistent_table', {})).rejects.toThrow(
        'syntax error'
      )
    })
  })

  describe('Auto-limit Behavior', () => {
    test('rejects non-positive limits before reading config or connecting', async () => {
      for (const limit of [0, -1, Number.NaN]) {
        await expect(queryCommand('SELECT * FROM users', { limit })).rejects.toThrow(
          'positive integer'
        )
        expect(configReadSpy).not.toHaveBeenCalled()
        expect(createAdapterSpy).not.toHaveBeenCalled()
      }
    })

    test('should not include --limit in default case', async () => {
      const logSpy = spyOn(console, 'log').mockImplementation(() => {})

      await queryCommand('SELECT * FROM users', {})

      expect(logSpy).toHaveBeenCalled()
      logSpy.mockRestore()
    })

    test('should respect custom limit option', async () => {
      const logSpy = spyOn(console, 'log').mockImplementation(() => {})

      await queryCommand('SELECT * FROM users', { limit: 500 })

      expect(logSpy).toHaveBeenCalled()
      logSpy.mockRestore()
    })

    test('should disable auto-limit with --no-limit', async () => {
      const logSpy = spyOn(console, 'log').mockImplementation(() => {})

      await queryCommand('SELECT * FROM users', { noLimit: true })

      expect(logSpy).toHaveBeenCalled()
      logSpy.mockRestore()
    })
  })
})
