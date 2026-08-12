import { describe, test, expect, beforeEach, afterEach, spyOn } from 'bun:test'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AuditLogger } from '../../src/core/audit/logger'
import { SessionIdService } from '../../src/core/audit/session-id'
import { redactArgv, redactSql, redactParams } from '../../src/utils/redaction'
import { expectNoSensitiveFragments } from '../helpers/sensitive-output'
import { QueryExecutor } from '../../src/core/query-executor'
import { AdapterFactory } from '../../src/adapters'
import { configModule } from '../../src/core/config'
import { queryCommand } from '../../src/commands/query'

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

  // ── 一次 CLI 查詢 = 恰好一筆 entry（#41） ──────────────────────────────────
  //
  // 稽核紀錄的價值建立在「一筆 entry 對應一次操作」上。執行器與命令層各寫一筆
  // 時，同一次查詢在 log 裡出現兩次，統計與追蹤都會失真；而且執行器寫的那筆
  // 永遠署名 'query'，即使呼叫者是 export 或 verify。寫入點因此只留命令層一個。

  function auditMockAdapter() {
    return {
      system: 'postgresql' as const,
      connect: async () => {},
      disconnect: async () => {},
      execute: async (sql: string) => {
        if (sql.includes('FAIL')) throw new Error('DB Error: table not found')
        return { rows: [{ id: 1 }], affectedRows: 0 }
      },
      listTables: async () => ['users', 'products'],
    }
  }

  function auditConfig(): any {
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
      schema: {},
      metadata: { version: '1.0' },
      blacklist: { tables: [], columns: {} },
      audit: { enabled: true, rotation: { max_bytes: 1000000, max_entries: 1000 } },
      effectiveConnectionName: 'test-conn',
    }
  }

  async function auditLines(): Promise<Record<string, unknown>[]> {
    const logPath = join(workDir, '.dbcli', 'audit', 'test-conn.jsonl')
    const content = await readFile(logPath, 'utf8').catch(() => '')
    return content
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line))
  }

  test('QueryExecutor does not write audit entries of its own', async () => {
    const executor = new QueryExecutor(
      auditMockAdapter() as any,
      'admin',
      undefined,
      auditConfig(),
      {
        config: workDir,
      }
    )

    await executor.execute('SELECT 1 FROM users')
    try {
      await executor.execute('SELECT FAIL FROM users')
    } catch {
      // expected: the query throws; the command layer owns the audit entry
    }

    expect(await auditLines()).toHaveLength(0)
  })

  test('one CLI query writes exactly one audit entry — success', async () => {
    const adapter = auditMockAdapter()
    const config = auditConfig()
    const adapterSpy = spyOn(AdapterFactory, 'createSqlAdapter').mockReturnValue(adapter as any)
    const configSpy = spyOn(configModule, 'read').mockImplementation(async () => config)
    const logSpy = spyOn(console, 'log').mockImplementation(() => {})

    try {
      await queryCommand('SELECT 1 FROM users', { format: 'json', config: workDir })
    } finally {
      adapterSpy.mockRestore()
      configSpy.mockRestore()
      logSpy.mockRestore()
    }

    const entries = await auditLines()
    expect(entries).toHaveLength(1)
    expect(entries[0].success).toBe(true)
    expect(entries[0].command).toBe('query')
    expect(entries[0].target).toBe('users')
    expect((entries[0].metadata as Record<string, unknown>).execution_ms).toBeNumber()
  })

  test('one CLI query writes exactly one audit entry — failure', async () => {
    const adapter = auditMockAdapter()
    const config = auditConfig()
    const adapterSpy = spyOn(AdapterFactory, 'createSqlAdapter').mockReturnValue(adapter as any)
    const configSpy = spyOn(configModule, 'read').mockImplementation(async () => config)
    const logSpy = spyOn(console, 'log').mockImplementation(() => {})
    const errorSpy = spyOn(console, 'error').mockImplementation(() => {})

    try {
      await queryCommand('SELECT FAIL FROM users', { format: 'json', config: workDir })
    } catch {
      // expected
    } finally {
      adapterSpy.mockRestore()
      configSpy.mockRestore()
      logSpy.mockRestore()
      errorSpy.mockRestore()
    }

    const entries = await auditLines()
    expect(entries).toHaveLength(1)
    expect(entries[0].success).toBe(false)
    expect(entries[0].error).toContain('table not found')
  })
})
