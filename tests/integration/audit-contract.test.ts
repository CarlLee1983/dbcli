import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AuditLogger } from '../../src/core/audit/logger'
import { SessionIdService } from '../../src/core/audit/session-id'
import { redactArgv, redactSql, redactParams } from '../../src/utils/redaction'
import { expectNoSensitiveFragments } from '../helpers/sensitive-output'
import { QueryExecutor } from '../../src/core/query-executor'

describe('Audit Contract Integration', () => {
  let workDir: string
  let auditDir: string
  let auditFile: string

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'dbcli-audit-contract-'))
    auditDir = join(workDir, '.dbcli', 'audit')
    auditFile = join(auditDir, 'default.jsonl')
  })

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true })
  })

  test('AuditLogger produces entries matching the AuditEntry contract', async () => {
    const sessionIdService = new SessionIdService(workDir)
    const logger = new AuditLogger({
      storagePath: workDir,
      connectionName: 'default',
      enabled: true,
      rotation: { maxBytes: 1000000, maxEntries: 1000 },
      sessionIdService,
    })

    const entryPayload = {
      engine: 'postgresql' as const,
      command: 'query',
      side_effect_tier: 'readonly' as const,
      target: 'users',
      success: true,
      redacted_query: redactSql("SELECT * FROM users WHERE email = 'secret@example.com'"),
      metadata: { rows_affected: 5 },
    }

    const result = await logger.write(entryPayload)
    if (!('success' in result)) throw new Error('Write failed')

    const logContent = await readFile(auditFile, 'utf8')
    const parsed = JSON.parse(logContent.trim())

    // SCHEMA-01: Essential keys
    expect(parsed).toHaveProperty('id')
    expect(parsed).toHaveProperty('ts')
    expect(parsed).toHaveProperty('session_id')
    expect(parsed.engine).toBe('postgresql')
    expect(parsed.command).toBe('query')
    expect(parsed.side_effect_tier).toBe('readonly')
    expect(parsed.target).toBe('users')
    expect(parsed.success).toBe(true)
    expect(parsed.redacted_query).toBe("SELECT * FROM users WHERE email = '?'")
    expect(parsed.metadata.rows_affected).toBe(5)

    // Type checks
    expect(typeof parsed.id).toBe('string')
    expect(typeof parsed.ts).toBe('string')
    expect(typeof parsed.session_id).toBe('string')
    expect(parsed.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  test('Redaction tools correctly mask sensitive information in log entries', async () => {
    const sessionIdService = new SessionIdService(workDir)
    const logger = new AuditLogger({
      storagePath: workDir,
      connectionName: 'default',
      enabled: true,
      rotation: { maxBytes: 1000000, maxEntries: 1000 },
      sessionIdService,
    })

    const rawSql = "INSERT INTO users (name, secret) VALUES ('John', 'password123')"
    const rawArgv = ['node', 'query', rawSql, '--password', 'my-secret-pw', '--config', 'prod.env']
    // Use a distinctive token value: a short fragment like 'abc' collides with
    // random session_id/uuid characters in the serialized log, causing a flaky
    // false-positive in the no-sensitive-fragments check below.
    const rawParams = { api_key: 'sk-12345', details: { token: 'tok-7f3q-secret' } }

    const entryPayload = {
      engine: 'mysql' as const,
      command: 'insert',
      side_effect_tier: 'db-write' as const,
      target: 'users',
      success: false,
      error: 'Access denied for user John',
      redacted_query: `${redactArgv(rawArgv)} | SQL: ${redactSql(rawSql)}`,
      metadata: {
        params: redactParams(rawParams),
        original_error: 'Connection failed with password=my-secret-pw',
      },
    }

    // Manual redaction of the error message if needed, but here we test the tools
    entryPayload.error = redactSql(entryPayload.error)
    entryPayload.metadata.original_error = redactSql(entryPayload.metadata.original_error)

    await logger.write(entryPayload)
    const logContent = await readFile(auditFile, 'utf8')

    // SCHEMA-03: Redaction verification
    expectNoSensitiveFragments(logContent, [
      'password123',
      'my-secret-pw',
      'sk-12345',
      'tok-7f3q-secret',
    ])

    const parsed = JSON.parse(logContent.trim())
    expect(parsed.redacted_query).toContain('--password <redacted>')
    expect(parsed.redacted_query).toContain('--config <redacted>')
    expect(parsed.redacted_query).toContain("VALUES ('?', '?')")
    expect(parsed.metadata.params.api_key).toBe('<redacted>')
    expect(parsed.metadata.params.details.token).toBe('<redacted>')
    expect(parsed.metadata.original_error).toContain('password=<redacted>')
  })

  test('QueryExecutor automatically writes audit entries on success and failure', async () => {
    const mockAdapter = {
      system: 'postgresql' as const,
      connect: async () => {},
      disconnect: async () => {},
      execute: async (sql: string) => {
        if (sql.includes('FAIL')) throw new Error('DB Error: table not found')
        return { rows: [{ id: 1 }], affectedRows: 0 }
      },
      listTables: async () => ['users', 'products'],
    }

    const config: any = {
      connection: { system: 'postgresql' },
      audit: { enabled: true, rotation: { max_bytes: 1000000, max_entries: 1000 } },
      effectiveConnectionName: 'test-conn',
    }

    const executor = new QueryExecutor(mockAdapter as any, 'admin', undefined, config, {
      config: workDir,
    })

    await executor.execute('SELECT 1 FROM users')
    try {
      await executor.execute('SELECT FAIL FROM users')
    } catch {
      // expected: query throws, audit failure path captured
    }

    const logPath = join(workDir, '.dbcli', 'audit', 'test-conn.jsonl')
    const logLines = (await readFile(logPath, 'utf8')).split('\n').filter(Boolean)

    expect(logLines.length).toBe(2)

    const successEntry = JSON.parse(logLines[0])
    expect(successEntry.success).toBe(true)
    expect(successEntry.command).toBe('query')
    expect(successEntry.target).toBe('users')
    expect(successEntry.redacted_sql).toBe('SELECT 0 FROM users')

    const failureEntry = JSON.parse(logLines[1])
    expect(failureEntry.success).toBe(false)
    expect(failureEntry.error).toContain('DB Error: table not found')
  })
})
