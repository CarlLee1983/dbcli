import { afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { AdapterFactory } from '@/adapters'
import type { SqlConnectionOptions } from '@/adapters/types'
import { parseEvidenceReceipt, type EvidenceReceipt } from '@/core/evidence-receipt'
import {
  isDbReachable,
  PG_DATABASE,
  PG_HOST,
  PG_PASSWORD,
  PG_PORT,
  PG_USER,
  SKIP_BY_ENV,
} from './helpers'

const CLI = resolve(import.meta.dir, '../../src/cli.ts')
const PG_AVAILABLE = !SKIP_BY_ENV && (await isDbReachable(PG_HOST, PG_PORT))
const TABLE = 'plat007_receipt_contract'
const CORRELATION_ID = 'plat007-receipt-contract'
const ROW_SENTINEL = '[{"email":"PLAT007_ROW_SENTINEL"}]'
const PASSWORD_SENTINEL = 'PLAT007_PASSWORD_SENTINEL'
const CONNECTION_SENTINEL = 'postgresql://plat007:PLAT007_SECRET@db.internal:5432/prod'
const SQL_SENTINEL = "SELECT * FROM users WHERE email='plat007@example.com'"
const ERROR_SENTINEL = 'PLAT007_RAW_ERROR_SENTINEL'
const SESSION_SENTINEL = 'PLAT007_SESSION_SECRET'
const PATH_SENTINEL = '/private/PLAT007_ABSOLUTE_PATH'
const OUTPUT_SENTINEL = 'PLAT007_UNBOUNDED_OUTPUT'
const FORBIDDEN = [
  ROW_SENTINEL,
  PASSWORD_SENTINEL,
  CONNECTION_SENTINEL,
  SQL_SENTINEL,
  ERROR_SENTINEL,
  SESSION_SENTINEL,
  PATH_SENTINEL,
  OUTPUT_SENTINEL,
] as const

const PG_OPTS: SqlConnectionOptions = {
  system: 'postgresql',
  host: PG_HOST,
  port: PG_PORT,
  user: PG_USER,
  password: PG_PASSWORD,
  database: PG_DATABASE,
}

const workspaces: string[] = []

function sanitizedEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (!/^DBCLI_/i.test(key) && key !== 'DATABASE_URL') env[key] = value
  }
  env.NODE_ENV = 'test'
  env.DBCLI_NO_UPDATE_CHECK = '1'
  return env
}

function run(
  args: string[],
  workspace: string,
  correlationId: string | null = CORRELATION_ID
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((done) => {
    const child = spawn(
      'bun',
      [
        'run',
        CLI,
        '--config',
        join(workspace, 'config.json'),
        ...(correlationId === null ? [] : ['--correlation-id', correlationId]),
        ...args,
      ],
      { cwd: workspace, env: sanitizedEnv() }
    )
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => (stdout += chunk.toString()))
    child.stderr.on('data', (chunk) => (stderr += chunk.toString()))
    child.on('close', (code) => done({ stdout, stderr, code: code ?? 0 }))
  })
}

async function project(live = false): Promise<string> {
  const workspace = await realpath(await mkdtemp(join(tmpdir(), 'dbcli-plat007-')))
  workspaces.push(workspace)
  const connection = live
    ? PG_OPTS
    : {
        system: 'postgresql' as const,
        host: 'unreachable.invalid',
        port: 5432,
        user: 'plat007',
        password: PASSWORD_SENTINEL,
        database: 'plat007',
      }
  await writeFile(
    join(workspace, 'config.json'),
    JSON.stringify({
      connection,
      permission: 'query-only',
      schema: {
        accounts: {
          name: 'accounts',
          columns: [{ name: 'id', type: 'integer', nullable: false, primaryKey: true }],
          indexes: [],
        },
      },
      blacklist: { tables: [], columns: {} },
      audit: { enabled: false },
      metadata: { createdAt: '2026-09-05T00:00:00.000Z', version: '1.0' },
    })
  )
  await writeFile(
    join(workspace, 'design.json'),
    JSON.stringify({
      version: 1,
      dialect: 'postgresql',
      models: [
        {
          name: 'accounts',
          table: 'accounts',
          fields: [{ name: 'id', type: 'integer', nullable: false, primaryKey: true }],
        },
      ],
      relationships: [],
      accessPatterns: [],
      decisions: [],
    })
  )
  return workspace
}

async function mongoProject(): Promise<string> {
  const workspace = await project()
  const config = JSON.parse(await readFile(join(workspace, 'config.json'), 'utf8'))
  config.connection = {
    system: 'mongodb',
    uri: CONNECTION_SENTINEL,
    host: '',
    port: 27017,
    user: '',
    password: '',
    database: '',
  }
  await writeFile(join(workspace, 'config.json'), JSON.stringify(config))
  return workspace
}

async function receipt(workspace: string, path: string): Promise<EvidenceReceipt> {
  return parseEvidenceReceipt(JSON.parse(await readFile(join(workspace, path), 'utf8')))
}

beforeAll(async () => {
  if (!PG_AVAILABLE) return
  const adapter = AdapterFactory.createSqlAdapter(PG_OPTS)
  await adapter.connect()
  try {
    await adapter.execute(`CREATE TABLE IF NOT EXISTS ${TABLE} (id integer primary key)`)
  } finally {
    await adapter.disconnect()
  }
})

afterEach(async () => {
  await Promise.all(workspaces.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe.skipIf(!PG_AVAILABLE)('DBCLI-PLAT-007 command evidence receipts', () => {
  test('all seven command paths write parseable bounded receipts after their result', async () => {
    const offline = await project()
    const live = await project(true)
    const cases: Array<{
      operation: EvidenceReceipt['operation']
      capability: string
      workspace: string
      args: string[]
    }> = [
      {
        operation: 'inspect',
        capability: 'context.inspect',
        workspace: offline,
        args: ['inspect', '--no-connect'],
      },
      {
        operation: 'report',
        capability: 'diagnostic.report',
        workspace: offline,
        args: ['report', '--no-connect'],
      },
      {
        operation: 'plan',
        capability: 'query.plan-risk',
        workspace: offline,
        args: ['plan', SQL_SENTINEL, '--format', 'json'],
      },
      {
        operation: 'lint',
        capability: 'query.lint',
        workspace: offline,
        args: ['lint', SQL_SENTINEL, '--no-schema', '--format', 'json'],
      },
      {
        operation: 'impact.assess',
        capability: 'schema.impact-assess',
        workspace: offline,
        args: [
          'impact',
          'assess',
          '--design',
          'design.json',
          '--against-cache',
          '--output',
          'impact.json',
        ],
      },
    ]
    cases.push(
      {
        operation: 'schema',
        capability: 'schema.read',
        workspace: live,
        args: ['schema', TABLE, '--format', 'json'],
      },
      {
        operation: 'explain',
        capability: 'query.explain',
        workspace: live,
        args: ['explain', 'SELECT 1', '--format', 'json'],
      }
    )

    for (const item of cases) {
      const path = `receipts/${item.operation}.json`
      const result = await run([...item.args, '--evidence-receipt', path], item.workspace)
      expect(result.code, `${item.operation}: ${result.stderr}`).toBe(0)
      if (item.operation === 'lint') {
        const lintOutput = JSON.parse(result.stdout) as Array<{ sql: string }>
        expect(lintOutput[0]?.sql).toBe(SQL_SENTINEL)
      }
      const parsed = await receipt(item.workspace, path)
      expect(parsed).toMatchObject({
        operation: item.operation,
        outcome: 'succeeded',
        observation: {
          kind: 'command-outcome',
          capability: item.capability,
          correlationId: CORRELATION_ID,
        },
      })
      const persisted = JSON.stringify(parsed)
      for (const payload of FORBIDDEN) expect(persisted).not.toContain(payload)
      expect(persisted.length).toBeLessThan(64 * 1024)
    }
  })

  test('a receipt write failure preserves the authoritative command result and file', async () => {
    const workspace = await project()
    await mkdir(join(workspace, 'receipts'), { recursive: true })
    await writeFile(join(workspace, 'receipts', 'existing.json'), 'keep')

    const result = await run(
      ['inspect', '--no-connect', '--evidence-receipt', 'receipts/existing.json'],
      workspace
    )

    expect(result.code).toBe(0)
    expect(() => JSON.parse(result.stdout)).not.toThrow()
    expect(result.stderr.trim()).toBe('Failed to write evidence receipt')
    expect(result.stderr).not.toContain(workspace)
    expect(await readFile(join(workspace, 'receipts', 'existing.json'), 'utf8')).toBe('keep')

    const plan = await run(
      ['plan', 'SELECT 1', '--format', 'json', '--evidence-receipt', 'receipts/existing.json'],
      workspace
    )
    expect(plan.code).toBe(0)
    expect(JSON.parse(plan.stdout)).toHaveProperty(
      'evidenceReceiptError',
      'Failed to write evidence receipt'
    )
    expect(plan.stderr).toBe('')
    expect(await readFile(join(workspace, 'receipts', 'existing.json'), 'utf8')).toBe('keep')
  })

  test('deterministic command failures write failed receipts without changing exit code', async () => {
    const offline = await project()
    const live = await project(true)
    const cases = [
      { operation: 'inspect', workspace: offline, args: ['inspect', '--format', 'invalid'] },
      { operation: 'report', workspace: offline, args: ['report', '--format', 'invalid'] },
      {
        operation: 'plan',
        workspace: offline,
        args: ['plan', 'SELECT 1', '--format', 'invalid'],
      },
      { operation: 'lint', workspace: offline, args: ['lint', 'SELECT 1', '--format', 'invalid'] },
      {
        operation: 'impact.assess',
        workspace: offline,
        args: [
          'impact',
          'assess',
          '--design',
          PATH_SENTINEL,
          '--against-cache',
          '--output',
          'impact.json',
        ],
      },
      { operation: 'schema', workspace: live, args: ['schema', ERROR_SENTINEL] },
      { operation: 'explain', workspace: live, args: ['explain'] },
    ]

    for (const item of cases) {
      const path = `failed/${item.operation}.json`
      const baseline = await run(item.args, item.workspace)
      expect(baseline.code, `${item.operation}: ${baseline.stderr}`).toBe(1)
      expect(baseline.stderr).not.toContain('Evidence receipt')
      const result = await run([...item.args, '--evidence-receipt', path], item.workspace)
      expect(result.code, item.operation).toBe(1)
      if (item.operation === 'schema') expect(result.stderr).toContain(ERROR_SENTINEL)
      expect(await receipt(item.workspace, path)).toMatchObject({
        operation: item.operation,
        outcome: 'failed',
      })
    }
  })

  test('schema existing-cache early success still writes its receipt', async () => {
    const workspace = await project(true)
    const result = await run(['schema', '--evidence-receipt', 'schema-existing.json'], workspace)

    expect(result.code).toBe(0)
    expect(await receipt(workspace, 'schema-existing.json')).toMatchObject({
      operation: 'schema',
      outcome: 'succeeded',
    })
  })

  test('omits exact security fixtures from their real command sources', async () => {
    const offline = await project()
    const live = await project(true)
    const mongo = await mongoProject()
    const configSource = await readFile(join(offline, 'config.json'), 'utf8')
    expect(configSource).toContain(PASSWORD_SENTINEL)
    expect(await readFile(join(mongo, 'config.json'), 'utf8')).toContain(CONNECTION_SENTINEL)

    const queryDir = join(live, '.dbcli', 'queries', 'diag')
    await mkdir(queryDir, { recursive: true })
    await writeFile(
      join(queryDir, 'db-size.postgres.sql'),
      `-- ---\n-- name: PLAT-007 bounded output\n-- engine: postgres\n-- intent: capacity.size\n-- ---\nSELECT '${ROW_SENTINEL.replaceAll("'", "''")}' AS row_payload, '${OUTPUT_SENTINEL}' AS output_payload;\n`
    )
    await writeFile(
      join(offline, 'events.jsonl'),
      `${JSON.stringify({
        version: 1,
        type: 'query_completed',
        timestamp: new Date().toISOString(),
        engine: 'postgresql',
        sessionId: SESSION_SENTINEL,
        queryId: 'plat007-query',
        client: 'plat007-client',
        target: 'plat007-target',
        sql: 'SELECT * FROM accounts',
        statement: 'select',
        tables: ['accounts'],
        tags: [],
      })}\n`
    )

    const cases = [
      { workspace: offline, path: 'password.json', args: ['inspect', '--no-connect'] },
      { workspace: mongo, path: 'connection.json', args: ['inspect', '--no-connect'] },
      {
        workspace: offline,
        path: 'sql.json',
        args: ['lint', SQL_SENTINEL, '--no-schema', '--format', 'json'],
      },
      {
        workspace: live,
        path: 'rows-output.json',
        args: ['report', '--section', 'capacity', '--format', 'json'],
      },
      {
        workspace: offline,
        path: 'session.json',
        args: [
          'impact',
          'assess',
          '--design',
          'design.json',
          '--against-cache',
          '--events',
          'events.jsonl',
          '--output',
          'session-impact.json',
        ],
      },
    ]

    for (const item of cases) {
      const result = await run([...item.args, '--evidence-receipt', item.path], item.workspace)
      expect(result.code, result.stderr).toBe(0)
      if (item.path === 'sql.json') expect(result.stdout).toContain('plat007@example.com')
      if (item.path === 'rows-output.json') {
        expect(result.stdout).toContain('PLAT007_ROW_SENTINEL')
        expect(result.stdout).toContain(OUTPUT_SENTINEL)
      }
      if (item.path === 'session.json') {
        expect(await readFile(join(item.workspace, 'events.jsonl'), 'utf8')).toContain(
          SESSION_SENTINEL
        )
      }
      const persisted = await readFile(join(item.workspace, item.path), 'utf8')
      for (const payload of FORBIDDEN) expect(persisted).not.toContain(payload)
    }
  })

  test('records a null correlation reference when none is supplied', async () => {
    const workspace = await project()
    const result = await run(
      ['inspect', '--no-connect', '--evidence-receipt', 'uncorrelated.json'],
      workspace,
      null
    )
    expect(result.code).toBe(0)
    expect((await receipt(workspace, 'uncorrelated.json')).observation).toMatchObject({
      correlationId: null,
    })
  })

  test('recovery failures write receipts before their terminating envelope', async () => {
    const offline = await project()
    const live = await project(true)
    const cases = [
      {
        operation: 'inspect',
        workspace: offline,
        args: ['inspect', '--format', 'invalid', '--recovery'],
      },
      {
        operation: 'lint',
        workspace: offline,
        args: ['lint', 'SELECT 1', '--format', 'invalid', '--recovery'],
      },
      {
        operation: 'schema',
        workspace: live,
        args: ['schema', ERROR_SENTINEL, '--recovery'],
      },
    ]

    for (const item of cases) {
      const path = `recovery/${item.operation}.json`
      const result = await run([...item.args, '--evidence-receipt', path], item.workspace)
      expect(result.code).toBe(1)
      expect(() => JSON.parse(result.stdout)).not.toThrow()
      expect(await receipt(item.workspace, path)).toMatchObject({
        operation: item.operation,
        outcome: 'failed',
      })
    }
  })

  test('all seven commands retain their no-receipt exit and output contract', async () => {
    const offline = await project()
    const live = await project(true)
    const cases = [
      { workspace: offline, args: ['inspect', '--no-connect'] },
      { workspace: offline, args: ['report', '--no-connect'] },
      { workspace: offline, args: ['plan', 'SELECT 1', '--format', 'json'] },
      { workspace: offline, args: ['lint', 'SELECT 1', '--no-schema', '--format', 'json'] },
      {
        workspace: offline,
        args: [
          'impact',
          'assess',
          '--design',
          'design.json',
          '--against-cache',
          '--output',
          'impact-without-receipt.json',
        ],
      },
      { workspace: live, args: ['schema', TABLE, '--format', 'json'] },
      { workspace: live, args: ['explain', 'SELECT 1', '--format', 'json'] },
    ]

    for (const item of cases) {
      const result = await run(item.args, item.workspace)
      expect(result.code, result.stderr).toBe(0)
      expect(result.stdout.length).toBeGreaterThan(0)
      expect(result.stderr).not.toContain('Evidence receipt')
      expect(result.stderr).not.toContain('Failed to write evidence receipt')
    }
  })
})
