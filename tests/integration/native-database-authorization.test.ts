/** AC-06: real native authorization denials, using only disposable Compose fixtures. */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createConnection } from 'mysql2/promise'
import { Client } from 'pg'

const ROOT = resolve(import.meta.dir, '../..')
const CLI = join(ROOT, 'src/cli.ts')
const SUFFIX = `${process.pid}_${Date.now()}`
const DATABASE = `g2_allowed_${SUFFIX}`
const OTHER_DATABASE = `g2_denied_${SUFFIX}`
const READER = `g2_${SUFFIX}`
const PASSWORD = 'disposable-g2-only'
const ALLOWED = 'allowed_fixture'
const DENIED = 'denied_fixture'
type Engine = 'mysql' | 'mariadb' | 'postgresql'
const engines: Engine[] = ['mysql', 'mariadb', 'postgresql']
const workspaces: string[] = []
const initialized: Engine[] = []
interface Result {
  stdout: string
  stderr: string
  code: number
}
interface Project {
  dir: string
  env: Record<string, string>
}
interface NativeCode {
  code?: string
  errno?: number
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
  const client =
    engine === 'postgresql'
      ? ['psql', '-U', 'dbcli', '-d', 'dbcli_test', '-v', 'ON_ERROR_STOP=1']
      : [engine === 'mariadb' ? 'mariadb' : 'mysql', '-uroot', '-ptestpass']
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
        engine === 'postgresql' ? 'postgres' : engine,
        ...client,
      ],
      { cwd: ROOT, stdin: new TextEncoder().encode(sql), stdout: 'pipe', stderr: 'pipe' }
    )
  )
  // Do not echo fixture SQL or driver errors containing account/credential material.
  if (result.code !== 0) throw new Error(`${engine} isolated fixture setup exited ${result.code}`)
}

function connection(engine: Engine, database = DATABASE) {
  return {
    host: '127.0.0.1',
    port: { mysql: 3307, mariadb: 3308, postgresql: 5433 }[engine],
    user: READER,
    password: PASSWORD,
    database: engine === 'postgresql' ? 'dbcli_test' : database,
  }
}

async function project(engine: Engine, database = DATABASE): Promise<Project> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'dbcli-native-authz-')))
  workspaces.push(dir)
  await mkdir(join(dir, 'home'))
  const env = {
    PATH: process.env.PATH ?? '/usr/bin:/bin',
    HOME: join(dir, 'home'),
    DBCLI_CONFIG_HOME: join(dir, 'registry'),
    DBCLI_CONFIG_INTEGRITY_ANCHOR_DIR: join(dir, 'anchors'),
    DBCLI_LANG: 'en',
    DBCLI_AGENT_MODE: '1',
    DBCLI_NO_UPDATE_CHECK: '1',
    NODE_ENV: 'test',
    NO_COLOR: '1',
  }
  const config = {
    version: 2,
    default: 'restricted-fixture',
    connections: {
      'restricted-fixture': {
        system: engine,
        ...connection(engine, database),
        permission: 'query-only',
        environment: 'development',
      },
    },
    schema: {},
    schemas: {},
    metadata: { version: '2.0' },
    blacklist: { tables: ['g2_sensitive_never_query'], columns: {} },
    audit: { enabled: false },
  }
  // Only fixture setup runs outside agent mode; tested commands have no ambient env/.env.
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
  if (setup.code !== 0) throw new Error('Isolated integrity-bound fixture config setup failed')
  return { dir, env }
}

async function run(work: Project, args: string[]): Promise<Result> {
  return collect(
    Bun.spawn([process.execPath, '--no-env-file', 'run', CLI, ...args], {
      cwd: work.dir,
      env: work.env,
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
    })
  )
}

async function prerequisites(work: Project, table: string): Promise<void> {
  const blacklist = await run(work, ['blacklist', 'list', '--format', 'json'])
  expect(blacklist.code).toBe(0)
  expect(JSON.parse(blacklist.stdout).tables).toEqual(['g2_sensitive_never_query'])
  const schema = await run(work, ['schema', table, '--format', 'json'])
  expect(schema.code).toBe(0)
  expect(
    JSON.parse(schema.stdout).columns.map((column: { name: string }) => column.name)
  ).toContain('id')
}

async function nativeDenial(operation: () => Promise<unknown>): Promise<NativeCode> {
  try {
    await operation()
  } catch (error) {
    const { code, errno } = error as NativeCode
    return { code, ...(errno === undefined ? {} : { errno }) }
  }
  throw new Error('Restricted fixture unexpectedly authorized the operation')
}

async function expectRecoveryDenial(work: Project, result: Result): Promise<void> {
  expect(result.code).not.toBe(0)
  const envelope = JSON.parse(result.stdout)
  expect(envelope.schemaVersion).toBe(1)
  expect(envelope.ok).toBe(false)
  expect(envelope.error.code).toBe('PERMISSION_DENIED')
  expect(envelope.error.details.connectionCode).toBe('DB_PERMISSION_DENIED')
  expect(envelope.recovery).toEqual([])
  expect(envelope).not.toHaveProperty('verify')
  expect(envelope).not.toHaveProperty('branches')
  expect(envelope).not.toHaveProperty('branchFork')
  const configPath = join(work.dir, '.dbcli', 'config.json')
  const before = await Bun.file(configPath).text()
  const applied = await run(work, ['recover', '--apply', '--format', 'json'])
  expect(applied.code).not.toBe(0)
  const plan = JSON.parse(applied.stdout)
  expect(plan.envelope).toEqual(envelope)
  expect(plan.results).toEqual([])
  expect(plan.finalStatus).toBe('skipped-only')
  expect(plan).not.toHaveProperty('verifyResult')
  expect(plan).not.toHaveProperty('verificationStatus')
  expect(await Bun.file(configPath).text()).toBe(before)
}

beforeAll(async () => {
  for (const engine of engines) {
    if (engine === 'postgresql') {
      await fixtureSql(
        engine,
        `CREATE ROLE "${READER}" LOGIN PASSWORD '${PASSWORD}';
         CREATE SCHEMA "${DATABASE}";
         CREATE TABLE "${DATABASE}".${ALLOWED} (id integer PRIMARY KEY);
         CREATE TABLE "${DATABASE}".${DENIED} (id integer PRIMARY KEY);
         GRANT USAGE ON SCHEMA "${DATABASE}" TO "${READER}";
         GRANT SELECT ON "${DATABASE}".${ALLOWED} TO "${READER}";
         GRANT SELECT, REFERENCES ON "${DATABASE}".${DENIED} TO "${READER}";`
      )
    } else {
      await fixtureSql(
        engine,
        `CREATE DATABASE \`${DATABASE}\`;
         CREATE DATABASE \`${OTHER_DATABASE}\`;
         CREATE USER '${READER}'@'%' IDENTIFIED BY '${PASSWORD}';
         CREATE TABLE \`${DATABASE}\`.${ALLOWED} (id integer PRIMARY KEY);
         CREATE TABLE \`${DATABASE}\`.${DENIED} (id integer PRIMARY KEY);
         GRANT SELECT ON \`${DATABASE}\`.${ALLOWED} TO '${READER}'@'%';
         GRANT REFERENCES ON \`${DATABASE}\`.${DENIED} TO '${READER}'@'%';`
      )
    }
    initialized.push(engine)
  }
}, 30000)

afterAll(async () => {
  for (const engine of initialized) {
    await fixtureSql(
      engine,
      engine === 'postgresql'
        ? `DROP SCHEMA "${DATABASE}" CASCADE; DROP ROLE "${READER}";`
        : `DROP DATABASE \`${DATABASE}\`; DROP DATABASE \`${OTHER_DATABASE}\`; DROP USER '${READER}'@'%';`
    )
  }
  await Promise.all(workspaces.map((dir) => rm(dir, { recursive: true, force: true })))
}, 30000)

describe('native database authorization through restricted real accounts (AC-06)', () => {
  for (const engine of ['mysql', 'mariadb'] as const) {
    test(`${engine}: allowed database connects, another database returns native 1044 and CLI denial`, async () => {
      const work = await project(engine)
      await prerequisites(work, ALLOWED)
      const allowed = await createConnection(connection(engine))
      try {
        await allowed.query(`SELECT id FROM ${ALLOWED}`)
      } finally {
        await allowed.end()
      }
      const native = await nativeDenial(() => createConnection(connection(engine, OTHER_DATABASE)))
      expect(native).toEqual({ code: 'ER_DBACCESS_DENIED_ERROR', errno: 1044 })
      console.info(`${engine} native database denial ${JSON.stringify(native)}`)
      const denied = await project(engine, OTHER_DATABASE)
      expect((await run(denied, ['blacklist', 'list', '--format', 'json'])).code).toBe(0)
      // No query follows failed schema discovery for the inaccessible database.
      const result = await run(denied, ['schema', ALLOWED, '--format', 'json', '--recovery'])
      console.info(`${engine} CLI database denial exit=${result.code}`)
      await expectRecoveryDenial(denied, result)
    }, 30000)

    test(`${engine}: successful connection still denies table reads with native 1142`, async () => {
      const work = await project(engine)
      // Qualified metadata discovery does not need SELECT to count table rows.
      await prerequisites(work, `${DATABASE}.${DENIED}`)
      const client = await createConnection(connection(engine))
      try {
        const native = await nativeDenial(() => client.query(`SELECT id FROM ${DENIED}`))
        expect(native).toEqual({ code: 'ER_TABLEACCESS_DENIED_ERROR', errno: 1142 })
        console.info(`${engine} native table denial ${JSON.stringify(native)}`)
      } finally {
        await client.end()
      }
      const result = await run(work, [
        'query',
        `SELECT id FROM ${DENIED}`,
        '--format',
        'json',
        '--recovery',
      ])
      console.info(`${engine} CLI table denial exit=${result.code}`)
      await expectRecoveryDenial(work, result)
    }, 30000)
  }

  test('postgresql: successful connection still denies table reads with native 42501', async () => {
    const work = await project('postgresql')
    const table = `${DATABASE}.${DENIED}`
    await prerequisites(work, table)
    // PG schema inspection currently probes SELECT privileges. Discover while granted,
    // then use fixture administration to establish the denied-read state under test.
    await fixtureSql('postgresql', `REVOKE SELECT ON "${DATABASE}".${DENIED} FROM "${READER}";`)
    const client = new Client(connection('postgresql'))
    await client.connect()
    try {
      await client.query(`SELECT id FROM "${DATABASE}".${ALLOWED}`)
      const native = await nativeDenial(() =>
        client.query(`SELECT id FROM "${DATABASE}".${DENIED}`)
      )
      expect(native).toEqual({ code: '42501' })
      console.info(`postgresql native table denial ${JSON.stringify(native)}`)
    } finally {
      await client.end()
    }
    const result = await run(work, [
      'query',
      `SELECT id FROM "${DATABASE}".${DENIED}`,
      '--format',
      'json',
      '--recovery',
    ])
    console.info(`postgresql CLI table denial exit=${result.code}`)
    await expectRecoveryDenial(work, result)
  }, 30000)
})
