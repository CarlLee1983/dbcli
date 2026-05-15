import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { QueryExecutor } from '../../src/core/query-executor'
import { BlacklistValidator } from '../../src/core/blacklist-validator'
import { BlacklistManager } from '../../src/core/blacklist-manager'

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

  test('Blacklist rejection is recorded as failure with redacted reason', async () => {
    const config: any = {
      connection: { system: 'postgresql' },
      permission: 'admin',
      blacklist: {
        tables: ['secrets'],
        columns: { users: ['password'] },
      },
      audit: { enabled: true },
      effectiveConnectionName: 'default',
    }

    const mockAdapter = {
      system: 'postgresql' as const,
      connect: async () => {},
      disconnect: async () => {},
      execute: async () => ({ rows: [], affectedRows: 0 }),
      listTables: async () => [],
    }

    const blacklistManager = new BlacklistManager(config)
    const blacklistValidator = new BlacklistValidator(blacklistManager)
    const executor = new QueryExecutor(mockAdapter as any, 'admin', blacklistValidator, config, {
      config: workDir,
    })

    // 1. Table Blacklist Reject
    try {
      await executor.execute('SELECT * FROM secrets')
    } catch (e) {
      expect((e as Error).name).toBe('BlacklistError')
    }

    const logPath = join(auditDir, 'default.jsonl')
    const logLines = (await readFile(logPath, 'utf8')).split('\n').filter(Boolean)
    const entry = JSON.parse(logLines[0])

    expect(entry.success).toBe(false)
    expect(entry.command).toBe('query')
    expect(entry.target).toBe('secrets')
    expect(entry.error).toContain('blacklisted')
    expect(entry.side_effect_tier).toBe('readonly')
  })

  test('Permission rejection is recorded as failure', async () => {
    const config: any = {
      connection: { system: 'postgresql' },
      permission: 'query-only',
      audit: { enabled: true },
      effectiveConnectionName: 'query-conn',
    }

    const mockAdapter = {
      system: 'postgresql' as const,
      connect: async () => {},
      disconnect: async () => {},
      execute: async () => ({ rows: [], affectedRows: 0 }),
      listTables: async () => [],
    }

    const executor = new QueryExecutor(mockAdapter as any, 'query-only', undefined, config, {
      config: workDir,
    })

    // 2. Permission Reject (DROP TABLE is dangerous/admin only)
    try {
      await executor.execute('DROP TABLE users')
    } catch (e) {
      expect((e as Error).name).toBe('PermissionError')
    }

    const logPath = join(auditDir, 'query-conn.jsonl')
    const logLines = (await readFile(logPath, 'utf8')).split('\n').filter(Boolean)
    const entry = JSON.parse(logLines[0])

    expect(entry.success).toBe(false)
    expect(entry.command).toBe('query')
    expect(entry.error).toContain('permission')
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
    const entry = JSON.parse(logLines[0])

    expect(entry.engine).toBe('mongodb')
    expect(entry.target).toBe('logs')
    expect(entry.success).toBe(true)
    expect(entry.metadata.rows_affected).toBe(42)
  })
})
