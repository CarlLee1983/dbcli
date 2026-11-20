/**
 * `dbcli --agent-output query` / `q` — process-level integration tests (#269).
 *
 * The only seam is the CLI process: stdout must be exactly one Operation
 * envelope accepted by the strict parser, stderr must be empty, and the exit
 * code must follow ADR-0024. Database-backed cases run against both the
 * PostgreSQL and MySQL services of docker-compose.test.yml and skip when those
 * are unreachable.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  parseOperationEnvelope,
  type OperationEnvelope,
  type OperationEnvelopeQueryData,
} from '@/core/operation-envelope'
import {
  connectionFor,
  createWorkspace,
  execDirect,
  runCli,
  type CliResult,
  type TestEngine,
} from './agent-output-cli'
import { isDbReachable, MYSQL_HOST, MYSQL_PORT, PG_HOST, PG_PORT } from './helpers'

const SECRET = 'top-secret-value-7f3a'
const TABLE = 'dbcli_agent_out_scratch'

/** stdout is one envelope the strict parser accepts; stderr is silent. */
function envelopeOf(result: CliResult): OperationEnvelope {
  expect(result.stderr).toBe('')
  expect(result.stdout.endsWith('\n')).toBe(true)
  expect(result.stdout.trimEnd().split('\n')).toHaveLength(1)
  const parsed = parseOperationEnvelope(JSON.parse(result.stdout))
  if (!parsed.ok) throw new Error(`not a valid envelope: ${parsed.reason}`)
  return parsed.value
}

/** Every audit log line under the workspace, wherever the storage path resolved to. */
function auditText(dir: string): string {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'))
    .map((file) => readFileSync(join(file.parentPath, file.name), 'utf8'))
    .join('\n')
}

const SAVED_QUERIES = (engine: 'postgres' | 'mysql'): Record<string, string> => ({
  one: `-- ---\n-- name: one\n-- engine: ${engine}\n-- params:\n--   v:\n--     type: int\n--     default: 1\n-- ---\nSELECT :v AS x;`,
  required: `-- ---\n-- name: required\n-- engine: ${engine}\n-- params:\n--   v:\n--     type: int\n-- ---\nSELECT :v AS x;`,
  broken: `-- ---\n-- name: broken\n-- engine: ${engine}\n-- ---\nSELECT * FROM dbcli_agent_out_no_such_table;`,
})

const reachable = {
  postgresql: await isDbReachable(PG_HOST, PG_PORT),
  mysql: await isDbReachable(MYSQL_HOST, MYSQL_PORT),
}

for (const engine of ['postgresql', 'mysql'] as const satisfies readonly TestEngine[]) {
  describe.skipIf(!reachable[engine])(`--agent-output query / q (${engine})`, () => {
    const workspaces: Record<string, ReturnType<typeof createWorkspace>> = {}
    const queries = SAVED_QUERIES(engine === 'postgresql' ? 'postgres' : 'mysql')
    const connection = connectionFor(engine)

    const dir = (name: string): string => workspaces[name]!.dir
    const run = (name: string, ...args: string[]): Promise<CliResult> => runCli(args, dir(name))

    beforeAll(async () => {
      await execDirect(engine, `DROP TABLE IF EXISTS ${TABLE}`)
      await execDirect(
        engine,
        `CREATE TABLE ${TABLE} (id int primary key, v int, secret varchar(60))`
      )
      await execDirect(engine, `INSERT INTO ${TABLE} VALUES (1, 10, '${SECRET}')`)
      workspaces.readWrite = createWorkspace({ connection, permission: 'read-write', queries })
      workspaces.admin = createWorkspace({ connection, permission: 'admin', queries })
      workspaces.queryOnly = createWorkspace({ connection, permission: 'query-only', queries })
      workspaces.blacklistTable = createWorkspace({
        connection,
        permission: 'read-write',
        blacklist: { tables: [TABLE] },
      })
      workspaces.blacklistColumn = createWorkspace({
        connection,
        permission: 'read-write',
        blacklist: { columns: { [TABLE]: ['secret'] } },
      })
    })

    afterAll(async () => {
      for (const workspace of Object.values(workspaces)) workspace.dispose()
      await execDirect(engine, `DROP TABLE IF EXISTS ${TABLE}`)
    })

    test('a successful read returns columns, scalar rows and a null rowsAffected', async () => {
      const result = await run('readWrite', '--agent-output', 'query', "SELECT 1 AS a, 'x' AS b")
      const envelope = envelopeOf(result)

      expect(result.code).toBe(0)
      expect(envelope).toMatchObject({
        schemaVersion: 1,
        ok: true,
        operation: 'query.execute',
        status: 'succeeded',
        context: {
          engine,
          permission: 'read-write',
          connectionName: 'main',
          agentMode: false,
        },
        data: {
          columnNames: ['a', 'b'],
          rows: [{ a: 1, b: 'x' }],
          rowCount: 1,
          rowsAffected: null,
          truncated: false,
          limitApplied: null,
        },
        warnings: [],
        recovery: null,
        error: null,
      })
      expect(Object.keys(envelope.context!).sort()).toEqual([
        'agentMode',
        'connectionName',
        'engine',
        'permission',
      ])
    })

    test('a write returns rowsAffected with empty rows and an audit reference', async () => {
      const result = await run(
        'admin',
        '--agent-output',
        'query',
        `UPDATE ${TABLE} SET v = 11 WHERE id = 1`
      )
      const envelope = envelopeOf(result)

      expect(result.code).toBe(0)
      expect(envelope.data).toEqual({
        columnNames: [],
        rows: [],
        rowCount: 0,
        rowsAffected: 1,
        truncated: false,
        limitApplied: null,
      })
      expect(envelope.evidence).toHaveLength(1)
      expect(envelope.evidence[0]!.kind).toBe('audit')
      expect(auditText(dir('admin'))).toContain(envelope.evidence[0]!.id)
    })

    test('a statement without WHERE is refused by the write gate and changes nothing', async () => {
      const result = await run('admin', '--agent-output', 'query', `DELETE FROM ${TABLE}`)
      const envelope = envelopeOf(result)

      expect(result.code).toBe(1)
      expect(envelope).toMatchObject({
        ok: false,
        operation: 'query.execute',
        data: null,
        recovery: null,
        error: { code: 'WRITE_GATE_REFUSED' },
      })
      expect(envelope.evidence).toHaveLength(1)
      expect(envelope.evidence[0]!.kind).toBe('audit')
      expect(auditText(dir('admin'))).toContain(envelope.evidence[0]!.id)
      const after = await run('readWrite', '--agent-output', 'query', `SELECT id FROM ${TABLE}`)
      expect(envelopeOf(after).data).toMatchObject({ rows: [{ id: 1 }] })
    })

    test('a permission refusal is a failed envelope with exit 1', async () => {
      const result = await run(
        'queryOnly',
        '--agent-output',
        'query',
        `UPDATE ${TABLE} SET v = 1 WHERE id = 1`
      )

      expect(result.code).toBe(1)
      expect(envelopeOf(result)).toMatchObject({
        ok: false,
        data: null,
        error: { code: 'PERMISSION_DENIED' },
      })
    })

    test('a blacklisted table is refused with and without --agent-output, never leaking data', async () => {
      const sql = `SELECT * FROM ${TABLE}`
      const agent = await run('blacklistTable', '--agent-output', 'query', sql)
      const human = await run('blacklistTable', 'query', sql, '--format', 'json')

      expect(agent.code).toBe(1)
      expect(envelopeOf(agent)).toMatchObject({
        ok: false,
        data: null,
        error: { code: 'BLACKLIST_TABLE' },
      })
      expect(agent.stdout).not.toContain(SECRET)
      expect(human.code).toBe(1)
      expect(human.stdout).not.toContain(SECRET)
    })

    test('blacklisted columns are withheld and reported as a coded warning', async () => {
      const result = await run(
        'blacklistColumn',
        '--agent-output',
        'query',
        `SELECT id, secret FROM ${TABLE}`
      )
      const envelope = envelopeOf(result)

      expect(result.code).toBe(0)
      expect(envelope.data).toMatchObject({ columnNames: ['id'], rows: [{ id: 1 }] })
      expect(envelope.warnings.map((warning) => warning.code)).toEqual([
        'BLACKLIST_COLUMNS_REDACTED',
      ])
      expect(result.stdout).not.toContain(SECRET)
    })

    test('a SQL syntax error is a failed envelope carrying the mapped code', async () => {
      const result = await run('readWrite', '--agent-output', 'query', 'SELECT FROM')
      const envelope = envelopeOf(result)

      expect(result.code).toBe(1)
      expect(envelope).toMatchObject({
        ok: false,
        data: null,
        recovery: null,
        error: { code: 'SQL_SYNTAX_ERROR' },
      })
      expect(envelope.error!.message.length).toBeLessThanOrEqual(2000)
    })

    test('a failed query references the audit entry written for the failure', async () => {
      const result = await run('readWrite', '--agent-output', 'query', 'SELECT FROM')
      const envelope = envelopeOf(result)

      expect(result.code).toBe(1)
      expect(envelope.error!.code).toBe('SQL_SYNTAX_ERROR')
      expect(envelope.evidence).toHaveLength(1)
      expect(envelope.evidence[0]!.kind).toBe('audit')
      expect(auditText(dir('readWrite'))).toContain(envelope.evidence[0]!.id)
    })

    test('a result over the 64 KiB limit fails and points at --limit or export', async () => {
      const result = await run(
        'readWrite',
        '--agent-output',
        'query',
        "SELECT REPEAT('x', 70000) AS big"
      )
      const envelope = envelopeOf(result)

      expect(result.code).toBe(1)
      expect(envelope).toMatchObject({
        ok: false,
        operation: 'query.execute',
        data: null,
        error: { code: 'AGENT_OUTPUT_LIMIT_EXCEEDED' },
      })
      expect(envelope.error!.message).toContain('--limit')
      expect(envelope.error!.message).toContain('export')
    })

    test('the query-only auto limit is reported as a warning, not on stderr', async () => {
      const result = await run('queryOnly', '--agent-output', 'query', 'SELECT 1 AS a')
      const envelope = envelopeOf(result)

      expect(result.code).toBe(0)
      expect(envelope.data).toMatchObject({ truncated: false, limitApplied: 1000 })
      expect(envelope.warnings).toHaveLength(1)
      expect(envelope.warnings[0]!.code).toBe('AUTO_LIMIT_APPLIED')
      expect(envelope.warnings[0]!.message).toContain('--limit')
    })

    test('a saved query runs with --param and references its audit entry', async () => {
      const result = await run('readWrite', '--agent-output', 'q', '@one', '--param', 'v=42')
      const envelope = envelopeOf(result)

      expect(result.code).toBe(0)
      expect(envelope).toMatchObject({
        ok: true,
        operation: 'saved-query.execute',
        context: { engine, permission: 'read-write', connectionName: 'main', agentMode: false },
        data: { columnNames: ['x'], rowCount: 1, rowsAffected: null, truncated: false },
        error: null,
      })
      expect(String((envelope.data as OperationEnvelopeQueryData).rows[0]!.x)).toBe('42')
      expect(envelope.evidence).toHaveLength(1)
      expect(envelope.evidence[0]!.kind).toBe('audit')
      expect(auditText(dir('readWrite'))).toContain(envelope.evidence[0]!.id)
    })

    test.each([
      ['a missing required parameter', ['@required'], 'PARAM_MISSING'],
      ['an invalid parameter value', ['@one', '--param', 'v=abc'], 'PARAM_INVALID'],
      ['an unknown saved query', ['@nope'], 'NOT_FOUND'],
    ])('%s exits 2 with its saved-query code', async (_name, args, code) => {
      const result = await run('readWrite', '--agent-output', 'q', ...args)

      expect(result.code).toBe(2)
      expect(envelopeOf(result)).toMatchObject({
        ok: false,
        operation: 'saved-query.execute',
        data: null,
        error: { code },
      })
    })

    test('a malformed --param is invalid query input with exit 2', async () => {
      const result = await run('readWrite', '--agent-output', 'q', '@one', '--param', 'novalue')

      expect(result.code).toBe(2)
      expect(envelopeOf(result).error!.code).toBe('INVALID_QUERY_INPUT')
    })

    test('a saved query that fails in the database still references its audit entry', async () => {
      const result = await run('readWrite', '--agent-output', 'q', '@broken')
      const envelope = envelopeOf(result)

      expect(result.code).toBe(1)
      expect(envelope).toMatchObject({
        ok: false,
        operation: 'saved-query.execute',
        data: null,
        error: { code: 'TABLE_NOT_FOUND' },
      })
      expect(envelope.evidence).toHaveLength(1)
      expect(auditText(dir('readWrite'))).toContain(envelope.evidence[0]!.id)
    })
  })
}

describe('--agent-output query / q without a database', () => {
  let offline: ReturnType<typeof createWorkspace>
  let mongo: ReturnType<typeof createWorkspace>
  let unreachable: ReturnType<typeof createWorkspace>

  beforeAll(() => {
    offline = createWorkspace({ connection: connectionFor('postgresql'), permission: 'admin' })
    mongo = createWorkspace({
      connection: {
        system: 'mongodb',
        host: '127.0.0.1',
        port: 1,
        user: 'u',
        password: 'p',
        database: 'd',
      },
      permission: 'read-write',
      queries: {
        pick: `-- ---\n-- name: pick\n-- engine: mongodb\n-- collection: c\n-- ---\n{}`,
      },
    })
    unreachable = createWorkspace({
      connection: {
        system: 'postgresql',
        host: '127.0.0.1',
        port: 1,
        user: 'u',
        password: 'p',
        database: 'd',
      },
      permission: 'read-write',
    })
  })

  afterAll(() => {
    offline.dispose()
    mongo.dispose()
    unreachable.dispose()
  })

  test('empty query text is invalid input with exit 2', async () => {
    const result = await runCli(['--agent-output', 'query', ''], offline.dir)

    expect(result.code).toBe(2)
    expect(envelopeOf(result)).toMatchObject({
      ok: false,
      operation: 'query.execute',
      data: null,
      error: { code: 'INVALID_QUERY_INPUT' },
    })
  })

  test('a malformed --limit is invalid query input with exit 2', async () => {
    const result = await runCli(
      ['--agent-output', 'query', 'SELECT 1', '--limit', 'abc'],
      offline.dir
    )

    expect(result.code).toBe(2)
    expect(envelopeOf(result).error!.code).toBe('INVALID_QUERY_INPUT')
  })

  test.each([
    ['query', ['query', 'SELECT 1', '--format', 'json']],
    ['q', ['q', '@one', '--format=json']],
  ])('--format with %s is rejected and tells the caller to remove it', async (_name, args) => {
    const result = await runCli(['--agent-output', ...args], offline.dir)

    expect(result.code).toBe(2)
    expect(envelopeOf(result).error).toEqual({
      code: 'INVALID_AGENT_OUTPUT_OPTIONS',
      message: '--agent-output cannot be combined with --format; remove --format.',
    })
  })

  test.each([
    ['query', ['query', 'SELECT 1', '--agent-output'], 'query.execute'],
    ['q', ['q', '@one', '--agent-output'], 'saved-query.execute'],
  ])(
    'a misplaced --agent-output after %s still yields an envelope',
    async (_n, args, operation) => {
      const result = await runCli(args, offline.dir)

      expect(result.code).toBe(2)
      expect(envelopeOf(result)).toMatchObject({
        ok: false,
        operation,
        error: {
          code: 'INVALID_AGENT_OUTPUT_OPTIONS',
          message: 'Agent output options are invalid.',
        },
      })
    }
  )

  test.each([
    ['query --recovery', ['query', 'SELECT 1', '--recovery']],
    ['query --ui', ['query', 'SELECT 1', '--ui']],
    ['q --dry-run', ['q', '@one', '--dry-run']],
    ['q --verify', ['q', '@one', '--verify']],
    ['q --recovery', ['q', '@one', '--recovery']],
  ])('%s cannot share stdout with the envelope', async (_name, args) => {
    const result = await runCli(['--agent-output', ...args], offline.dir)

    expect(result.code).toBe(2)
    expect(envelopeOf(result).error!.code).toBe('INVALID_AGENT_OUTPUT_OPTIONS')
  })

  test('a comma-separated --use is rejected as invalid input', async () => {
    const result = await runCli(
      ['--agent-output', 'query', 'SELECT 1', '--use', 'a,b'],
      offline.dir
    )

    expect(result.code).toBe(2)
    expect(envelopeOf(result).error!.code).toBe('INVALID_QUERY_INPUT')
  })

  test('an unsupported command reports its own operation id, not capabilities.check', async () => {
    const result = await runCli(['--agent-output', 'list'], offline.dir)

    expect(result.code).toBe(2)
    expect(envelopeOf(result)).toMatchObject({
      ok: false,
      operation: 'cli.invocation',
      context: null,
      data: null,
      error: { code: 'UNSUPPORTED_AGENT_OUTPUT_OPERATION' },
    })
  })

  test('a connection failure carries a recovery envelope and no host details', async () => {
    const result = await runCli(
      ['--timeout', '2000', '--agent-output', 'query', 'SELECT 1'],
      unreachable.dir
    )
    const envelope = envelopeOf(result)

    expect(result.code).toBe(1)
    expect(envelope).toMatchObject({
      ok: false,
      operation: 'query.execute',
      data: null,
      error: { code: 'CONN_REFUSED' },
      recovery: { ok: false, error: { code: 'CONN_REFUSED' } },
    })
    expect(envelope.recovery!.error.message).toBe(envelope.error!.message)
    expect(result.stdout).not.toContain('127.0.0.1')
  })

  test('a saved query on a non-SQL engine fails closed before running anything', async () => {
    const result = await runCli(['--agent-output', 'q', '@pick'], mongo.dir)

    expect(result.code).toBe(2)
    expect(envelopeOf(result)).toMatchObject({
      ok: false,
      operation: 'saved-query.execute',
      data: null,
      error: { code: 'UNSUPPORTED_AGENT_OUTPUT_OPERATION' },
    })
  })
})
