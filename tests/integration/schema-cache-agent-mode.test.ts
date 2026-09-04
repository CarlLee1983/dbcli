/**
 * `dbcli schema` under `DBCLI_AGENT_MODE=1` — DBCLI-PLAT-012.
 *
 * This is the test the capability contract needed and did not have. PLAT-001
 * shipped `schema.read` reporting `available` under agent mode while the
 * command it names exited 1 there, and the deviation was recorded in prose
 * because nothing compared the two. So the first case here asks the contract
 * and then runs the command, in one test, against a real database: the claim
 * and the behaviour cannot drift apart without this failing.
 *
 * The rest pins the boundary that did not move. Agent mode still refuses every
 * change to connection identity, permission and credentials; what changed is
 * that storing derived data stopped being one of those.
 */

import { describe, test, expect, afterEach, beforeAll } from 'bun:test'
import { spawn } from 'node:child_process'
import { chmod, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { AdapterFactory } from '@/adapters'
import type { SqlConnectionOptions } from '@/adapters/types'
import { writeConfigWithIntegrity } from '@/core/config-integrity'
import { isDbReachable, PG_DATABASE, PG_HOST, PG_PASSWORD, PG_PORT, PG_USER } from './helpers'

const CLI = resolve(import.meta.dir, '../../src/cli.ts')
const PG_AVAILABLE = await isDbReachable(PG_HOST, PG_PORT)
const TABLE = 'plat012_cache_boundary'

const PG_OPTS: SqlConnectionOptions = {
  system: 'postgresql',
  host: PG_HOST,
  port: PG_PORT,
  user: PG_USER,
  password: PG_PASSWORD,
  database: PG_DATABASE,
}

const workDirs: string[] = []

afterEach(async () => {
  await Promise.all(workDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

/**
 * Run the CLI with a clean environment plus whatever the case sets.
 *
 * Inherited `DBCLI_*` variables are stripped: a developer with agent mode
 * exported would otherwise make the "outside agent mode" cases silently test
 * the wrong thing.
 */
function run(
  args: string[],
  workDir: string,
  extra: Record<string, string> = {}
): Promise<{ stdout: string; stderr: string; code: number }> {
  const env: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (/^DBCLI_/i.test(key) || key === 'DATABASE_URL') continue
    env[key] = value
  }
  env.NODE_ENV = 'test'
  env.DBCLI_NO_UPDATE_CHECK = '1'
  Object.assign(env, extra)

  return new Promise((res) => {
    const child = spawn('bun', ['run', CLI, ...args], { cwd: workDir, env })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (buffer) => (stdout += buffer.toString()))
    child.stderr.on('data', (buffer) => (stderr += buffer.toString()))
    child.on('close', (code) => res({ stdout, stderr, code: code ?? 0 }))
  })
}

const ENV_LOCAL = 'DB_PASSWORD=untouched\n'

/**
 * A project whose `.dbcli/` is a real directory holding a v1 config.
 *
 * Written directly rather than through `dbcli init`, which binds the project to
 * a generated directory under the user's home. That indirection is real and
 * fine, and it would put the file this test is about outside the temporary
 * directory the test cleans up.
 */
async function v1Project(): Promise<{ dir: string; storagePath: string }> {
  // `realpath` matters here, and only under agent mode. On macOS `mkdtemp`
  // hands back `/var/folders/...` while the spawned CLI resolves its cwd to
  // `/private/var/folders/...`; the integrity record stores the path it was
  // written for, so the two spellings read as tampering and every case would
  // fail on `context-unresolvable` instead of on what it is testing.
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'dbcli-plat012-int-')))
  workDirs.push(dir)
  const storagePath = join(dir, '.dbcli')

  const config = {
    connection: { ...PG_OPTS },
    permission: 'query-only',
    schema: {},
    metadata: { createdAt: '2026-01-01T00:00:00.000Z', version: '1.0' },
    blacklist: { tables: [], columns: {} },
    audit: { enabled: false },
  }
  await writeConfigWithIntegrity(storagePath, JSON.stringify(config, null, 2))
  await writeFile(join(storagePath, '.env.local'), ENV_LOCAL)
  return { dir, storagePath }
}

const configOf = async (storagePath: string) =>
  JSON.parse(await readFile(join(storagePath, 'config.json'), 'utf8')) as Record<string, unknown>

beforeAll(async () => {
  if (!PG_AVAILABLE) return
  const adapter = AdapterFactory.createSqlAdapter(PG_OPTS)
  await adapter.connect()
  try {
    await adapter.execute(`CREATE TABLE IF NOT EXISTS ${TABLE} (id integer primary key, name text)`)
  } finally {
    await adapter.disconnect()
  }
})

describe.skipIf(!PG_AVAILABLE)('the capability claim and the command agree', () => {
  test('schema.read is available under agent mode, and dbcli schema then succeeds', async () => {
    const { dir, storagePath } = await v1Project()

    const claim = await run(
      ['capabilities', 'check', '--require', 'schema.read', '--format', 'json'],
      dir,
      { DBCLI_AGENT_MODE: '1' }
    )
    expect(claim.code).toBe(0)
    const report = JSON.parse(claim.stdout) as {
      context: { agentMode: boolean }
      results: Array<{ id: string; status: string }>
    }
    expect(report.context.agentMode).toBe(true)
    expect(report.results[0]).toMatchObject({ id: 'schema.read', status: 'available' })

    // The half that used to be missing.
    const command = await run(['schema'], dir, { DBCLI_AGENT_MODE: '1' })
    expect(command.stderr).not.toMatch(/Agent mode blocks/)
    expect(command.code).toBe(0)

    const after = await configOf(storagePath)
    expect(Object.keys(after.schema as object)).toContain(TABLE)
  }, 60_000)
})

describe.skipIf(!PG_AVAILABLE)('a cache write moves no credential', () => {
  test('.env.local and connection.password survive, in and out of agent mode', async () => {
    for (const agentMode of [undefined, '1']) {
      const { dir, storagePath } = await v1Project()
      const before = await configOf(storagePath)

      const result = await run(
        ['schema'],
        dir,
        agentMode === undefined ? {} : { DBCLI_AGENT_MODE: agentMode }
      )
      expect(result.code).toBe(0)

      const after = await configOf(storagePath)
      // Before this Story the v1 path removed `password` here and rewrote
      // `.env.local`, on every schema scan, agent mode or not.
      expect(after.connection).toEqual(before.connection)
      expect(after.permission).toBe('query-only')
      expect(after.blacklist).toEqual(before.blacklist)
      expect(after.audit).toEqual(before.audit)
      expect(await readFile(join(storagePath, '.env.local'), 'utf8')).toBe(ENV_LOCAL)
    }
  }, 90_000)
})

describe.skipIf(!PG_AVAILABLE)('a failed cache write is reported as a cache write', () => {
  test('it says the schema was read and does not read as a database failure', async () => {
    const { dir, storagePath } = await v1Project()

    // Make the storage directory read-only. The config is still readable, so
    // the connection resolves and the schema is read; only the write back
    // fails. That is the exact shape the old output described as an agent-mode
    // configuration refusal, from which a caller could only conclude that
    // something about the database had gone wrong.
    await chmod(storagePath, 0o500)

    let result
    try {
      result = await run(['schema'], dir, { DBCLI_AGENT_MODE: '1' })
    } finally {
      await chmod(storagePath, 0o700)
    }
    expect(result.code).not.toBe(0)

    const output = `${result.stdout}\n${result.stderr}`
    expect(output).toContain('The schema was read from the database successfully')
    expect(output).toMatch(/schema cache/i)
    expect(output).not.toMatch(/connection (refused|failed)|ECONNREFUSED|could not connect/i)
    // Bounded: the refusal names no path, no credential and no endpoint.
    expect(output).not.toContain(storagePath)
    expect(output).not.toContain(PG_PASSWORD)
    expect(output).not.toContain(String(PG_PORT))
  }, 60_000)
})

describe.skipIf(!PG_AVAILABLE)('the rest of the boundary did not move', () => {
  test('agent mode still refuses a permission change through the config writers', async () => {
    const { dir } = await v1Project()
    // `--force`: without it `init` refuses because `.dbcli` exists, which would
    // let this pass without the guard ever being consulted.
    const result = await run(
      ['init', '--no-interactive', '--force', '--skip-test', '--permission', 'admin'],
      dir,
      { DBCLI_AGENT_MODE: '1' }
    )

    expect(result.code).not.toBe(0)
    expect(`${result.stdout}\n${result.stderr}`).toMatch(
      /Agent mode blocks configuration, permission, and credential changes/
    )
  }, 60_000)

  test('agent mode still refuses a blacklist change', async () => {
    const { dir, storagePath } = await v1Project()
    const result = await run(['blacklist', 'add', '--table', 'secrets'], dir, {
      DBCLI_AGENT_MODE: '1',
    })

    expect(result.code).not.toBe(0)
    expect((await configOf(storagePath)).blacklist).toEqual({ tables: [], columns: {} })
  }, 60_000)
})
