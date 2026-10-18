/** G3 AC-05/06/07: real CLI routes and actual adapter with a synthetic driver. */
import { SKIP_BY_ENV } from './helpers'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createConnection } from 'mysql2/promise'
import { parseEvidenceReceipt } from '@/core/evidence-receipt'

const ROOT = resolve(import.meta.dir, '../..')
const CLI = join(ROOT, 'src/cli.ts')
const SECRET = 'G3_AUTHENTICATION_PAYLOAD_SENTINEL'
const OMITTED = '[OMITTED: grant text could not be safely redacted]'
const SUFFIX = `${process.pid}_${Date.now()}`
const USER = `g3_${SUFFIX}`
const DATABASE = `g3_${SUFFIX}`
const PASSWORD = 'disposable-g3-only'
const directories: string[] = []
const initialized: string[] = []
type Engine = 'mysql' | 'mariadb'
type Permission = 'query-only' | 'read-write' | 'data-admin' | 'admin'
interface Work {
  dir: string
  env: Record<string, string>
  preload?: string
}
interface Result {
  stdout: string
  stderr: string
  code: number
}

async function collect(child: {
  stdout: ReadableStream<Uint8Array>
  stderr: ReadableStream<Uint8Array>
  exited: Promise<number>
}): Promise<Result> {
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  return { stdout, stderr, code }
}

async function fixtureSql(engine: Engine, sql: string): Promise<void> {
  const result = await collect(
    Bun.spawn(
      [
        'docker',
        'compose',
        '-p',
        'dbcli',
        '-f',
        join(ROOT, 'docker-compose.test.yml'),
        'exec',
        '-T',
        engine,
        engine === 'mariadb' ? 'mariadb' : 'mysql',
        '-uroot',
        '-ptestpass',
      ],
      { cwd: ROOT, stdin: new TextEncoder().encode(sql), stdout: 'pipe', stderr: 'pipe' }
    )
  )
  // Never echo fixture SQL, driver errors or raw SHOW GRANTS rows.
  if (result.code !== 0) throw new Error(`${engine} isolated fixture setup failed`)
}

function connection(engine: Engine) {
  return {
    system: engine,
    host: '127.0.0.1',
    port: engine === 'mysql' ? 3307 : 3308,
    user: USER,
    password: PASSWORD,
    database: DATABASE,
  }
}

async function project(
  engine: Engine,
  options: {
    synthetic?: boolean
    configuredSystem?: Engine
    permission?: Permission
    agent?: boolean
    blacklist?: boolean
  } = {}
): Promise<Work> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'dbcli-g3-')))
  directories.push(dir)
  await mkdir(join(dir, 'home'))
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? '/usr/bin:/bin',
    HOME: join(dir, 'home'),
    DBCLI_CONFIG_HOME: join(dir, 'registry'),
    DBCLI_CONFIG_INTEGRITY_ANCHOR_DIR: join(dir, 'anchors'),
    DBCLI_LANG: 'en',
    DBCLI_AGENT_MODE: options.agent === false ? '0' : '1',
    DBCLI_NO_UPDATE_CHECK: '1',
    NODE_ENV: 'test',
    NO_COLOR: '1',
  }
  const config = {
    connection: { ...connection(engine), system: options.configuredSystem ?? engine },
    permission: options.permission ?? 'query-only',
    schema: {},
    metadata: { version: '1.0' },
    blacklist: { tables: options.blacklist ? ['g3_sensitive_never_query'] : [], columns: {} },
    audit: { enabled: true, rotation: { max_bytes: 1048576, max_entries: 1000 } },
  }
  const writer = `import { writeConfigWithIntegrity } from ${JSON.stringify(join(ROOT, 'src/core/config-integrity.ts'))}; await writeConfigWithIntegrity(process.argv[1], await Bun.stdin.text())`
  const setup = await collect(
    Bun.spawn([process.execPath, '--no-env-file', '-e', writer, join(dir, '.dbcli')], {
      cwd: dir,
      env: { ...env, DBCLI_AGENT_MODE: '0' },
      stdin: new TextEncoder().encode(JSON.stringify(config)),
      stdout: 'pipe',
      stderr: 'pipe',
    })
  )
  if (setup.code !== 0) throw new Error('Isolated G3 config setup failed')
  const work: Work = { dir, env }
  if (options.synthetic) {
    env.G3_FIXTURE_SECRET = SECRET
    work.preload = join(dir, 'driver.ts')
    // Only the transport is synthetic: MySQLAdapter, guards, formatters and CLI stay real.
    await Bun.write(
      work.preload,
      `
import driver from ${JSON.stringify(join(ROOT, 'node_modules/mysql2/promise.js'))};
driver.createConnection = async () => ({
  execute: async (sql) => {
    if (/SHOW\\s+GRANTS/i.test(sql)) return [[
      { Grants: "GRANT SELECT ON app.* TO 'reader'@'%' IDENTIFIED BY '" + process.env.G3_FIXTURE_SECRET + "'" },
      { Grants: "GRANT USAGE ON *.* TO 'reader'@'%' IDENTIFIED FUTURE '" + process.env.G3_FIXTURE_SECRET + "'" },
      { Grants: "GRANT SELECT ON app.* TO 'reader'@'%'" },
    ], []];
    return [[{ count: 1, version: '11.8.8-MariaDB' }], []];
  }, query: async () => [[], []], end: async () => {}, destroy: () => {},
});
`
    )
  }
  return work
}

async function run(work: Work, args: string[]): Promise<Result> {
  return collect(
    Bun.spawn(
      [
        process.execPath,
        '--no-env-file',
        ...(work.preload ? ['--preload', work.preload] : []),
        CLI,
        '--correlation-id',
        'g3-grant-redaction',
        ...args,
      ],
      { cwd: work.dir, env: work.env, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' }
    )
  )
}

async function prerequisites(work: Work, nonempty = false): Promise<void> {
  const result = await run(work, ['blacklist', 'list', '--format', 'json'])
  expect(result.code).toBe(0)
  expect(JSON.parse(result.stdout).tables).toEqual(nonempty ? ['g3_sensitive_never_query'] : [])
  // SHOW GRANTS has no target table; schema discovery is inapplicable.
}

function safe(output: string, secrets: string[], markers: string[] = []): void {
  // Boolean assertions avoid printing raw driver output or real authentication hashes on failure.
  expect(secrets.some((secret) => output.includes(secret))).toBe(false)
  for (const marker of markers) expect(output.includes(marker)).toBe(true)
}

async function artifacts(work: Work, secrets: string[], requireReceipt = false): Promise<void> {
  const files = await Array.fromAsync(
    new Bun.Glob('**/*').scan({ cwd: work.dir, dot: true, onlyFiles: true })
  )
  expect(files.some((file) => file.includes('/audit/') && file.endsWith('.jsonl'))).toBe(true)
  if (requireReceipt) expect(files.some((file) => file.endsWith('.receipt.json'))).toBe(true)
  // Fixture config intentionally holds its disposable login password. Only consumer
  // artifacts can contain a returned grant; config/anchors/transport scripts are inputs.
  const outputs = files.filter(
    (file) =>
      file.includes('/audit/') ||
      file.endsWith('.receipt.json') ||
      /^grants\.(json|csv|html)$/.test(file) ||
      file.startsWith('shell-')
  )
  for (const file of outputs) safe(await Bun.file(join(work.dir, file)).text(), secrets)
}

async function formats(work: Work, secrets: string[], markers: string[]): Promise<void> {
  for (const format of ['json', 'csv', 'table']) {
    const result = await run(work, ['query', 'SHOW GRANTS', '--format', format])
    expect(result.code).toBe(0)
    safe(result.stdout + result.stderr, secrets, markers)
  }
  for (const format of ['json', 'csv', 'html']) {
    const output = join(work.dir, `grants.${format}`)
    const result = await run(work, [
      'export',
      'SHOW GRANTS',
      '--format',
      format,
      '--output',
      output,
    ])
    expect(result.code).toBe(0)
    safe(result.stdout + result.stderr, secrets)
    safe(await Bun.file(output).text(), secrets, markers)
  }
  // Executing assertions project only pass bits into the strict receipt boundary.
  const receipt = await run(work, [
    'assert',
    'SHOW GRANTS',
    '--expect',
    'rows > 0',
    '--evidence-receipt',
    'grants.receipt.json',
  ])
  expect(receipt.code).toBe(0)
  const verdict = JSON.parse(receipt.stdout)
  expect(verdict.pass).toBe(true)
  expect(verdict.evidenceReceiptError).toBeUndefined()
  expect(verdict.evidenceReceiptPath).toBeDefined()
  const saved = parseEvidenceReceipt(await Bun.file(join(work.dir, 'grants.receipt.json')).json())
  expect(saved.operation).toBe('assert')
  expect(saved.outcome).toBe('succeeded')
  expect(saved.observation).toEqual({ kind: 'assert-verdict', checksPassed: 1, checksTotal: 1 })
  safe(receipt.stdout + receipt.stderr, secrets)
  await artifacts(work, secrets, true)
}

async function shellFormats(work: Work): Promise<void> {
  const runner = join(work.dir, 'shell.ts')
  await Bun.write(
    runner,
    `
import { MySQLAdapter } from ${JSON.stringify(join(ROOT, 'src/adapters/mysql-adapter.ts'))};
import { ReplEngine } from ${JSON.stringify(join(ROOT, 'src/core/repl/repl-engine.ts'))};
const config = await Bun.file('.dbcli/config.json').json();
const adapter = new MySQLAdapter(config.connection);
await adapter.connect();
const records = [];
const shell = new ReplEngine(adapter, {
  configPath: '.dbcli', permission: config.permission, system: 'mariadb',
  tableNames: [], columnsByTable: {}, commandNames: [],
}, 'shell-history', config, null, async (record) => {
  records.push(record); return { status: 'written' };
});
for (const format of ['json', 'csv', 'table']) {
  await shell.processInput('.format ' + format);
  console.log(JSON.stringify(await shell.processInput('SHOW GRANTS;')));
}
await Bun.write('shell-audit.json', JSON.stringify(records));
await shell.saveHistory();
await adapter.disconnect();
`
  )
  const result = await collect(
    Bun.spawn([process.execPath, '--no-env-file', '--preload', work.preload!, runner], {
      cwd: work.dir,
      env: work.env,
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
    })
  )
  expect(result.code).toBe(0)
  const outputs = result.stdout
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
  expect(outputs).toHaveLength(3)
  for (const output of outputs) {
    safe(output.output ?? '', [SECRET], ['[REDACTED]', OMITTED, 'GRANT SELECT ON app.*'])
  }
  safe(result.stderr, [SECRET])
  const records = await Bun.file(join(work.dir, 'shell-audit.json')).text()
  expect(JSON.parse(records).length).toBeGreaterThan(0)
  safe(records, [SECRET])
  await artifacts(work, [SECRET])
}

describe('synthetic grants through actual adapter and output routes (AC-05/07)', () => {
  for (const permission of ['query-only', 'read-write', 'data-admin', 'admin'] as const) {
    for (const agent of [false, true]) {
      for (const blacklist of [false, true]) {
        test(`${permission}, agent=${agent}, blacklist=${blacklist}: CLI query/export and artifacts are safe`, async () => {
          const work = await project('mariadb', { synthetic: true, permission, agent, blacklist })
          await prerequisites(work, blacklist)
          await formats(work, [SECRET], ['[REDACTED]', OMITTED, 'GRANT SELECT ON app.*'])
          await shellFormats(work)
        }, 60000)
      }
    }
  }
})

test('nonexecuting plan receipt excludes grant result data (AC-07)', async () => {
  const work = await project('mariadb', { synthetic: true })
  await prerequisites(work)
  const query = await run(work, ['query', 'SHOW GRANTS', '--format', 'json'])
  expect(query.code).toBe(0)
  safe(query.stdout + query.stderr, [SECRET], ['[REDACTED]', OMITTED])
  // plan analyzes SQL without calling the adapter; it is an existing receipt API.
  const planned = await run(work, [
    'plan',
    'SHOW GRANTS',
    '--format',
    'json',
    '--evidence-receipt',
    'plan.receipt.json',
  ])
  expect(planned.code).toBe(0)
  safe(planned.stdout + planned.stderr, [SECRET])
  const artifact = parseEvidenceReceipt(await Bun.file(join(work.dir, 'plan.receipt.json')).json())
  expect(artifact.operation).toBe('plan')
  expect(artifact.outcome).toBe('succeeded')
  await artifacts(work, [SECRET], true)
}, 30000)

afterAll(async () => {
  await Promise.all(directories.map((dir) => rm(dir, { recursive: true, force: true })))
})

describe.skipIf(SKIP_BY_ENV)('isolated Compose fixtures', () => {
  beforeAll(async () => {
    for (const engine of ['mysql', 'mariadb'] as const) {
      await fixtureSql(
        engine,
        `CREATE DATABASE \`${DATABASE}\`; CREATE USER '${USER}'@'%' IDENTIFIED BY '${PASSWORD}'; GRANT SELECT ON \`${DATABASE}\`.* TO '${USER}'@'%';`
      )
      initialized.push(engine)
    }
  }, 30000)

  afterAll(async () => {
    for (const engine of initialized) {
      await fixtureSql(engine as Engine, `DROP DATABASE \`${DATABASE}\`; DROP USER '${USER}'@'%';`)
    }
  }, 30000)

  describe('isolated Compose SHOW GRANTS with real CLI (AC-06)', () => {
    for (const engine of ['mysql', 'mariadb'] as const) {
      test(`${engine}: real grant output retains privileges without authentication payloads`, async () => {
        const work = await project(engine, { blacklist: true })
        await prerequisites(work, true)
        const { system: _system, ...options } = connection(engine)
        const client = await createConnection(options)
        let secrets: string[] = [PASSWORD]
        try {
          const [rows] = await client.query('SHOW GRANTS')
          const cells = (rows as Array<Record<string, string>>).flatMap((row) => Object.values(row))
          const payloads = cells.flatMap((cell) =>
            Array.from(cell.matchAll(/IDENTIFIED BY PASSWORD '([^']+)'/g), (match) => match[1]!)
          )
          // These observations prove local engine behavior; they do not claim other versions' grammar.
          expect(payloads.length > 0).toBe(engine === 'mariadb')
          expect(cells.some((cell) => cell.includes('GRANT SELECT'))).toBe(true)
          secrets = [...secrets, ...payloads]
        } finally {
          await client.end()
        }
        await formats(work, secrets, [
          'GRANT SELECT',
          USER,
          ...(engine === 'mariadb' ? ['[REDACTED]'] : []),
        ])
      }, 60000)
    }
  })

  test('real MariaDB configured as mysql protects adjacent executable-comment grants', async () => {
    const work = await project('mariadb', {
      configuredSystem: 'mysql',
      blacklist: true,
      permission: 'admin',
    })
    await prerequisites(work, true)
    const { system: _system, ...options } = connection('mariadb')
    const client = await createConnection(options)
    let payloads: string[]
    try {
      const [rows] = await client.query('SHOW GRANTS')
      payloads = (rows as Array<Record<string, string>>).flatMap((row) =>
        Object.values(row).flatMap((cell) =>
          Array.from(cell.matchAll(/IDENTIFIED BY PASSWORD '([^']+)'/g), (match) => match[1]!)
        )
      )
      expect(payloads.length > 0).toBe(true)
    } finally {
      await client.end()
    }
    // Existing query-only policy rejects the configured-mysql MariaDB-specific form as unknown.
    // Admin already supports native execution; this test does not loosen that policy.
    for (const sql of ['/*M!100000SHOW GRANTS */', '/*!100000SHOW GRANTS */']) {
      const result = await run(work, ['query', sql, '--format', 'json'])
      expect(result.code).toBe(0)
      safe(
        result.stdout + result.stderr,
        [PASSWORD, ...payloads],
        ['[REDACTED]', 'GRANT SELECT', USER]
      )
    }
    await artifacts(work, [PASSWORD, ...payloads])
  }, 30000)
})

test('saved SHOW GRANTS remains rejected rather than gaining a new route (AC-05)', async () => {
  const { parseSavedQuery } = await import('@/core/saved-queries/parser')
  let code: string | undefined
  try {
    parseSavedQuery({ key: 'grants', file: 'grants.sql', source: 'local', text: 'SHOW GRANTS;' })
  } catch (error) {
    code = (error as { code?: string }).code
  }
  expect(code).toBe('NOT_SELECT')
})
