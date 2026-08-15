import { describe, test, expect, beforeEach, afterEach, spyOn } from 'bun:test'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AdapterFactory } from '../../src/adapters'
import { configModule } from '../../src/core/config'
import { queryCommand } from '../../src/commands/query'

describe('Cross-Engine Audit & Rejection Paths', () => {
  let workDir: string
  let auditDir: string

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'dbcli-audit-engines-'))
    auditDir = join(workDir, '.dbcli', 'audit')
    // We don't mkdir auditDir here to test lazy creation
  })

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true })
  })

  // 拒絕路徑走的是命令層那唯一的 audit 寫入點（#41），所以測試也從 CLI 進入。
  async function runQueryWithAudit(sql: string, config: any): Promise<void> {
    const mockAdapter = {
      system: 'postgresql' as const,
      connect: async () => {},
      disconnect: async () => {},
      execute: async () => ({ rows: [], affectedRows: 0 }),
      listTables: async () => [],
    }
    const adapterSpy = spyOn(AdapterFactory, 'createSqlAdapter').mockReturnValue(mockAdapter as any)
    const configSpy = spyOn(configModule, 'read').mockImplementation(async () => config)
    const logSpy = spyOn(console, 'log').mockImplementation(() => {})
    const errorSpy = spyOn(console, 'error').mockImplementation(() => {})
    try {
      await queryCommand(sql, { format: 'json', config: workDir })
    } catch {
      // rejection paths throw; the audit entry is what this test is about
    } finally {
      adapterSpy.mockRestore()
      configSpy.mockRestore()
      logSpy.mockRestore()
      errorSpy.mockRestore()
    }
  }

  async function readEntries(connectionName: string): Promise<any[]> {
    const content = await readFile(join(auditDir, `${connectionName}.jsonl`), 'utf8')
    return content
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line))
  }

  test('Blacklist rejection is recorded as failure with redacted reason', async () => {
    await runQueryWithAudit('SELECT * FROM secrets', {
      connection: {
        system: 'postgresql',
        host: 'localhost',
        port: 5432,
        user: 'test',
        password: 'test',
        database: 'testdb',
      },
      permission: 'admin',
      schema: {},
      metadata: { version: '1.0' },
      blacklist: {
        tables: ['secrets'],
        columns: { users: ['password'] },
      },
      audit: { enabled: true },
      effectiveConnectionName: 'default',
    })

    const entries = await readEntries('default')
    expect(entries).toHaveLength(1)
    expect(entries[0].success).toBe(false)
    expect(entries[0].command).toBe('query')
    expect(entries[0].target).toBe('secrets')
    expect(entries[0].error).toContain('blacklisted')
    expect(entries[0].side_effect_tier).toBe('readonly')
  })

  test('Permission rejection is recorded as failure', async () => {
    await runQueryWithAudit('DROP TABLE users', {
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
      audit: { enabled: true },
      effectiveConnectionName: 'query-conn',
    })

    const entries = await readEntries('query-conn')
    expect(entries).toHaveLength(1)
    expect(entries[0].success).toBe(false)
    expect(entries[0].command).toBe('query')
    expect(entries[0].error).toContain('permission')
  })

  test('NoSQL (MongoDB) query is recorded correctly', async () => {
    // We'll test the QueryExecutor logic for SQL,
    // but for NoSQL we usually call writeAuditEntry directly in command handlers.
    // Since integration tests here are in-process, we can use the helper directly.
    const { writeAuditEntry } = await import('../../src/core/audit/integration-helper')

    const config: any = {
      connection: { system: 'mongodb' },
      audit: { enabled: true },
      effectiveConnectionName: 'mongo-conn',
    }

    await writeAuditEntry(
      config,
      'query',
      { config: workDir, collection: 'logs' },
      {
        success: true,
        metadata: { rows_affected: 42 },
      }
    )

    const logPath = join(auditDir, 'mongo-conn.jsonl')
    const logLines = (await readFile(logPath, 'utf8')).split('\n').filter(Boolean)
    const entry = JSON.parse(logLines[0]!)

    expect(entry.engine).toBe('mongodb')
    expect(entry.target).toBe('logs')
    expect(entry.success).toBe(true)
    expect(entry.metadata.rows_affected).toBe(42)
  })
})
