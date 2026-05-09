import { describe, test, expect, beforeAll } from 'bun:test'
import { spawn } from 'node:child_process'
import { resolve, join } from 'node:path'
import { writeFile, readFile, mkdtemp, mkdir, cp, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'

const FIXTURE_SRC = resolve(import.meta.dir, '../fixtures/inspect/v1-postgres')
const CLI = resolve(import.meta.dir, '../../src/cli.ts')

let FIXTURE = FIXTURE_SRC
let NO_CONFIG = ''

/**
 * Strip env vars that could let dbcli pick up an inherited connection from the
 * developer's shell or repo .env (DBCLI_HOST/PORT/USER/PASSWORD/DATABASE/etc).
 * Keeps PATH, HOME, TMPDIR — needed for `bun` to launch.
 */
function sanitizeEnv(): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (/^DBCLI_/i.test(k)) continue
    if (k === 'DATABASE_URL') continue
    out[k] = v
  }
  out.NODE_ENV = 'test'
  out.DBCLI_NO_UPDATE_CHECK = '1'
  return out
}

function run(
  args: string[],
  cwd = FIXTURE
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((res) => {
    const child = spawn('bun', ['run', CLI, ...args], {
      cwd,
      env: sanitizeEnv(),
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (b) => (stdout += b.toString()))
    child.stderr.on('data', (b) => (stderr += b.toString()))
    child.on('close', (code) => res({ stdout, stderr, code: code ?? 0 }))
  })
}

beforeAll(async () => {
  const work = await mkdtemp(join(tmpdir(), 'dbcli-recovery-'))
  await cp(FIXTURE_SRC, work, { recursive: true })
  const idxPath = resolve(work, '.dbcli/schemas/index.json')
  const raw = JSON.parse(await readFile(idxPath, 'utf8'))
  raw.metadata.lastRefreshed = new Date().toISOString()
  await writeFile(idxPath, JSON.stringify(raw, null, 2))
  FIXTURE = work

  // Truly empty workspace under tmpdir — no inherited .env, no schema cache.
  NO_CONFIG = await mkdtemp(join(tmpdir(), 'dbcli-recovery-empty-'))
})

describe('dbcli recovery (CLI lookup)', () => {
  test('--list --format json enumerates all codes', async () => {
    const { stdout, code } = await run(['recovery', '--list', '--format', 'json'])
    expect(code).toBe(0)
    const j = JSON.parse(stdout)
    expect(j.schemaVersion).toBe(1)
    const ids = (j.codes as Array<{ code: string }>).map((c) => c.code)
    for (const required of [
      'CONFIG_MISSING',
      'CONN_REFUSED',
      'CONN_AUTH_FAILED',
      'CONN_TIMEOUT',
      'CONN_HOST_NOT_FOUND',
      'CONN_UNKNOWN',
      'PERMISSION_DENIED',
      'BLACKLIST_TABLE',
      'BLACKLIST_COLUMN_WRITE',
      'SNIPPET_NOT_FOUND',
      'SNIPPET_AMBIGUOUS',
      'SNIPPET_PARAM_MISSING',
      'SCHEMA_CACHE_MISSING',
      'UNKNOWN',
    ]) {
      expect(ids).toContain(required)
    }
  })

  test('--list --format markdown contains all code headings', async () => {
    const { stdout, code } = await run(['recovery', '--list', '--format', 'markdown'])
    expect(code).toBe(0)
    expect(stdout).toContain('# dbcli recovery codes')
    for (const c of [
      'CONFIG_MISSING',
      'CONN_REFUSED',
      'PERMISSION_DENIED',
      'BLACKLIST_TABLE',
      'SNIPPET_NOT_FOUND',
      'SCHEMA_CACHE_MISSING',
    ]) {
      expect(stdout).toContain(`\`${c}\``)
    }
  })

  test('--code CONN_REFUSED produces a stable envelope', async () => {
    const { stdout, code } = await run(['recovery', '--code', 'CONN_REFUSED', '--format', 'json'])
    expect(code).toBe(0)
    const j = JSON.parse(stdout)
    expect(j.schemaVersion).toBe(1)
    expect(j.ok).toBe(false)
    expect(j.error.code).toBe('CONN_REFUSED')
    expect(j.error.category).toBe('connection')
    expect(Array.isArray(j.recovery)).toBe(true)
    expect(j.recovery.length).toBeGreaterThan(0)
    expect(j.recovery[0].command).toBe('dbcli doctor --format json')
    expect(j.recovery[0].risk).toBe('readonly')
  })

  test('--code BLACKLIST_TABLE --table users binds the table into the remove step', async () => {
    const { stdout, code } = await run([
      'recovery',
      '--code',
      'BLACKLIST_TABLE',
      '--table',
      'users',
      '--format',
      'json',
    ])
    expect(code).toBe(0)
    const j = JSON.parse(stdout)
    const cmds = (j.recovery as Array<{ command: string; risk: string }>).map((s) => s.command)
    expect(cmds).toContain('dbcli blacklist remove users')
    const writeStep = (j.recovery as Array<{ command: string; risk: string }>).find(
      (s) => s.command === 'dbcli blacklist remove users'
    )
    expect(writeStep?.risk).toBe('write')
  })

  test('--for-agent collapses to brief json', async () => {
    const { stdout, code } = await run(['recovery', '--code', 'PERMISSION_DENIED', '--for-agent'])
    expect(code).toBe(0)
    const j = JSON.parse(stdout)
    for (const step of j.recovery as Array<Record<string, unknown>>) {
      expect(step.rationale).toBeUndefined()
      expect(step.expects).toBeUndefined()
      expect(typeof step.command).toBe('string')
      expect(typeof step.risk).toBe('string')
    }
  })

  test('missing --code exits non-zero with helpful error', async () => {
    const { stderr, code } = await run(['recovery', '--format', 'json'])
    expect(code).not.toBe(0)
    expect(stderr.toLowerCase()).toContain('missing')
  })

  test('unknown --code exits non-zero', async () => {
    const { stderr, code } = await run(['recovery', '--code', 'NOT_A_REAL_CODE'])
    expect(code).not.toBe(0)
    expect(stderr).toContain("Unknown recovery code 'NOT_A_REAL_CODE'")
  })

  test('NEVER leaks host / port / password in the synthetic envelope', async () => {
    const { stdout } = await run(['recovery', '--code', 'CONN_REFUSED', '--format', 'json'])
    expect(stdout).not.toContain('localhost')
    expect(stdout).not.toContain('5432')
    expect(stdout).not.toContain('"password"')
    expect(stdout).not.toContain('"host"')
  })
})

describe('dbcli query --recovery (integration)', () => {
  // dbcli falls back to a default localhost:5432 / empty-creds connection when
  // no .dbcli is present, so an empty workspace surfaces a CONN_* failure
  // (CONN_AUTH_FAILED on a dev box with Postgres listening, CONN_REFUSED in CI).
  // Either way, --recovery must emit a valid envelope on stdout, and the
  // non-recovery path must keep printing to stderr.

  test('empty workspace + --recovery emits a CONN_* envelope on stdout', async () => {
    const { stdout, code } = await run(
      ['query', 'SELECT 1', '--recovery', '--format', 'json'],
      NO_CONFIG
    )
    expect(code).not.toBe(0)
    const j = JSON.parse(stdout)
    expect(j.schemaVersion).toBe(1)
    expect(j.ok).toBe(false)
    expect(typeof j.error.code).toBe('string')
    expect((j.error.code as string).startsWith('CONN_')).toBe(true)
    expect(j.error.category).toBe('connection')
    expect(Array.isArray(j.recovery)).toBe(true)
    expect(j.recovery.length).toBeGreaterThan(0)
    // First recovery step is always dbcli doctor for the connection family.
    expect(j.recovery[0].command).toBe('dbcli doctor --format json')
  })

  test('empty workspace WITHOUT --recovery preserves human stderr behavior', async () => {
    const { stdout, stderr, code } = await run(['query', 'SELECT 1', '--format', 'json'], NO_CONFIG)
    expect(code).not.toBe(0)
    expect(stdout.trim()).toBe('')
    expect(stderr.length).toBeGreaterThan(0)
  })
})

describe('dbcli query --recovery (size-guard branch)', () => {
  // Regression: the size-guard branch used to call console.error + process.exit(1)
  // directly, bypassing the recovery envelope entirely. The block must throw so
  // the outer catch routes it through --recovery and emits valid JSON on stdout.
  let GUARDED = ''

  beforeAll(async () => {
    const work = await mkdtemp(join(tmpdir(), 'dbcli-recovery-guard-'))
    const dbcliDir = resolve(work, '.dbcli')
    await mkdir(dbcliDir, { recursive: true })
    const config = {
      version: 1,
      connection: {
        system: 'postgresql',
        host: '127.0.0.1',
        port: 5432,
        database: 'sizeguard_test',
        user: 'sizeguard',
        password: 'sizeguard',
      },
      permission: 'query-only',
      schema: {
        // Force size-guard to trip on any unfiltered SELECT.
        logs: { estimatedRowCount: 10_000_000 },
      },
    }
    await writeFile(resolve(dbcliDir, 'config.json'), JSON.stringify(config, null, 2))
    GUARDED = work
  })

  test('size-guard block + --recovery emits envelope on stdout (not raw stderr exit)', async () => {
    const { stdout, stderr, code } = await run(
      ['query', 'SELECT * FROM logs', '--recovery', '--format', 'json'],
      GUARDED
    )
    expect(code).not.toBe(0)
    expect(stdout.length).toBeGreaterThan(0)
    const j = JSON.parse(stdout)
    expect(j.schemaVersion).toBe(1)
    expect(j.ok).toBe(false)
    expect(typeof j.error.code).toBe('string')
    expect(Array.isArray(j.recovery)).toBe(true)
    // Size-guard reason text must not leak ahead of the envelope on stderr.
    expect(stderr).not.toContain('huge')
  })
})

describe('dbcli q --recovery (integration)', () => {
  test('unknown snippet emits SNIPPET_NOT_FOUND envelope on stdout', async () => {
    const { stdout, code } = await run([
      'q',
      '@diag/this-does-not-exist',
      '--recovery',
      '--format',
      'json',
    ])
    expect(code).not.toBe(0)
    const j = JSON.parse(stdout)
    expect(j.schemaVersion).toBe(1)
    expect(j.error.code).toBe('SNIPPET_NOT_FOUND')
    expect(j.error.details?.snippet).toBe('@diag/this-does-not-exist')
    expect(Array.isArray(j.recovery)).toBe(true)
  })

  test('unknown snippet WITHOUT --recovery preserves human stderr behavior', async () => {
    const { stdout, stderr, code } = await run([
      'q',
      '@diag/this-does-not-exist',
      '--format',
      'json',
    ])
    expect(code).not.toBe(0)
    expect(stdout.trim()).toBe('')
    expect(stderr.toLowerCase()).toContain('snippet')
  })
})

describe('dbcli inspect --recovery (integration)', () => {
  test('--require-schema-cache + --recovery on a workspace with no schema cache emits SCHEMA_CACHE_MISSING envelope', async () => {
    const work = await mkdtemp(join(tmpdir(), 'dbcli-recovery-no-cache-'))
    await cp(FIXTURE, work, { recursive: true })
    await Bun.spawn(['rm', '-rf', join(work, '.dbcli/schemas')]).exited

    const { stdout, code } = await run(
      ['inspect', '--no-connect', '--require-schema-cache', '--recovery', '--format', 'json'],
      work
    )
    expect(code).not.toBe(0)
    const j = JSON.parse(stdout)
    expect(j.schemaVersion).toBe(1)
    expect(j.error.code).toBe('SCHEMA_CACHE_MISSING')
    expect(Array.isArray(j.recovery)).toBe(true)
    expect(j.recovery[0].command).toContain('dbcli schema --refresh')
  })

  test('--require-schema-cache without --recovery prints stderr and exits non-zero', async () => {
    const work = await mkdtemp(join(tmpdir(), 'dbcli-recovery-no-cache-'))
    await cp(FIXTURE, work, { recursive: true })
    await Bun.spawn(['rm', '-rf', join(work, '.dbcli/schemas')]).exited

    const { stdout, stderr, code } = await run(
      ['inspect', '--no-connect', '--require-schema-cache'],
      work
    )
    expect(code).not.toBe(0)
    expect(stdout.trim()).toBe('')
    expect(stderr.toLowerCase()).toContain('schema cache')
  })

  test('inspect without --require-schema-cache returns the snapshot (no throw)', async () => {
    const work = await mkdtemp(join(tmpdir(), 'dbcli-recovery-no-cache-'))
    await cp(FIXTURE, work, { recursive: true })
    await Bun.spawn(['rm', '-rf', join(work, '.dbcli/schemas')]).exited

    const { stdout, code } = await run(['inspect', '--no-connect', '--format', 'json'], work)
    expect(code).toBe(0)
    const j = JSON.parse(stdout)
    expect(j.schemaCache.available).toBe(false)
  })
})

describe('dbcli insert --recovery (integration)', () => {
  test('insert against empty workspace + --recovery emits a CONFIG_MISSING / CONN_* / UNKNOWN envelope', async () => {
    const { stdout, code } = await run(
      ['insert', 'users', '--data', '{"name":"a"}', '--recovery'],
      NO_CONFIG
    )
    expect(code).not.toBe(0)
    const j = JSON.parse(stdout)
    expect(j.schemaVersion).toBe(1)
    expect(typeof j.error.code).toBe('string')
    expect([
      'CONFIG_MISSING',
      'UNKNOWN',
      'CONN_REFUSED',
      'CONN_AUTH_FAILED',
      'CONN_TIMEOUT',
      'CONN_HOST_NOT_FOUND',
      'CONN_UNKNOWN',
    ]).toContain(j.error.code)
    expect(Array.isArray(j.recovery)).toBe(true)
  })

  test('insert against empty workspace WITHOUT --recovery preserves human error output', async () => {
    const { stderr, stdout, code } = await run(
      ['insert', 'users', '--data', '{"name":"a"}'],
      NO_CONFIG
    )
    expect(code).not.toBe(0)
    expect(stderr + stdout).not.toContain('"schemaVersion"')
  })
})

describe('dbcli update --recovery (integration)', () => {
  test('update against empty workspace + --recovery emits an envelope on stdout', async () => {
    const { stdout, code } = await run(
      ['update', 'users', '--where', 'id=1', '--set', '{"name":"a"}', '--recovery'],
      NO_CONFIG
    )
    expect(code).not.toBe(0)
    const j = JSON.parse(stdout)
    expect(j.schemaVersion).toBe(1)
    expect(Array.isArray(j.recovery)).toBe(true)
  })

  test('update WITHOUT --recovery preserves existing error output', async () => {
    const { stdout, code } = await run(
      ['update', 'users', '--where', 'id=1', '--set', '{"name":"a"}'],
      NO_CONFIG
    )
    expect(code).not.toBe(0)
    expect(stdout).not.toContain('"schemaVersion"')
  })
})

describe('dbcli delete --recovery (integration)', () => {
  test('delete against empty workspace + --recovery emits an envelope on stdout', async () => {
    const { stdout, code } = await run(
      ['delete', 'users', '--where', 'id=1', '--recovery'],
      NO_CONFIG
    )
    expect(code).not.toBe(0)
    const j = JSON.parse(stdout)
    expect(j.schemaVersion).toBe(1)
    expect(Array.isArray(j.recovery)).toBe(true)
  })

  test('delete WITHOUT --recovery preserves existing error output', async () => {
    const { stdout, code } = await run(['delete', 'users', '--where', 'id=1'], NO_CONFIG)
    expect(code).not.toBe(0)
    expect(stdout).not.toContain('"schemaVersion"')
  })
})

describe('dbcli export --recovery (integration)', () => {
  test('export against empty workspace + --recovery emits an envelope on stdout', async () => {
    const { stdout, code } = await run(
      ['export', 'SELECT * FROM users', '--format', 'json', '--recovery'],
      NO_CONFIG
    )
    expect(code).not.toBe(0)
    const j = JSON.parse(stdout)
    expect(j.schemaVersion).toBe(1)
    expect(Array.isArray(j.recovery)).toBe(true)
  })

  test('export WITHOUT --recovery preserves human stderr', async () => {
    const { stderr, code } = await run(
      ['export', 'SELECT * FROM users', '--format', 'json'],
      NO_CONFIG
    )
    expect(code).not.toBe(0)
    expect(stderr.length).toBeGreaterThan(0)
    expect(stderr).not.toContain('"schemaVersion"')
  })
})

describe('dbcli schema --recovery (integration)', () => {
  test('schema against empty workspace + --recovery emits an envelope on stdout', async () => {
    const { stdout, code } = await run(
      ['schema', 'users', '--format', 'json', '--recovery'],
      NO_CONFIG
    )
    expect(code).not.toBe(0)
    const j = JSON.parse(stdout)
    expect(j.schemaVersion).toBe(1)
    expect(Array.isArray(j.recovery)).toBe(true)
  })

  test('schema WITHOUT --recovery preserves human stderr', async () => {
    const { stderr, code } = await run(['schema', 'users', '--format', 'json'], NO_CONFIG)
    expect(code).not.toBe(0)
    expect(stderr.length).toBeGreaterThan(0)
    expect(stderr).not.toContain('"schemaVersion"')
  })
})

describe('auto-saved .dbcli/last-recovery.json', () => {
  test('query --recovery writes .dbcli/last-recovery.json on failure', async () => {
    const { code } = await run(
      ['query', 'SELECT 1', '--recovery', '--format', 'json'],
      NO_CONFIG
    )
    expect(code).not.toBe(0)
    const raw = await readFile(join(NO_CONFIG, '.dbcli/last-recovery.json'), 'utf8')
    const saved = JSON.parse(raw)
    expect(saved.schemaVersion).toBe(1)
    expect(saved.command.startsWith('dbcli query')).toBe(true)
    expect(saved.command).toContain('<sql>')
    expect(saved.cwd).toBe(await realpath(NO_CONFIG))
    expect(saved.envelope.error.code).toBeDefined()
  })

  test('q --recovery writes .dbcli/last-recovery.json on failure', async () => {
    const { code } = await run(
      ['q', '@nonexistent', '--recovery', '--format', 'json'],
      FIXTURE
    )
    expect(code).not.toBe(0)
    const raw = await readFile(join(FIXTURE, '.dbcli/last-recovery.json'), 'utf8')
    const saved = JSON.parse(raw)
    expect(saved.envelope.error.code).toBeDefined()
  })

  test('saved file does not include raw SQL or credential strings', async () => {
    await run(
      [
        'query',
        "SELECT * FROM users WHERE password='supersecret'",
        '--recovery',
        '--format',
        'json',
      ],
      NO_CONFIG
    )
    const raw = await readFile(join(NO_CONFIG, '.dbcli/last-recovery.json'), 'utf8')
    expect(raw).not.toContain('supersecret')
    expect(raw).not.toContain('SELECT * FROM users')
  })
})

describe('dbcli recover (registered)', () => {
  test('--help advertises --apply / --from / --allow-write / --format', async () => {
    const { stdout, code } = await run(['recover', '--help'])
    expect(code).toBe(0)
    expect(stdout).toContain('--apply')
    expect(stdout).toContain('--from')
    expect(stdout).toContain('--allow-write')
    expect(stdout).toContain('--format')
  })

  test('exits 2 with helpful message when no envelope is available', async () => {
    // Use a fresh empty dir to avoid pollution from earlier auto-save tests.
    const empty = await mkdtemp(join(tmpdir(), 'dbcli-recover-empty-2-'))
    const { stderr, code } = await run(['recover', '--apply'], empty)
    expect(code).toBe(2)
    expect(stderr).toContain('No recovery plan available')
  })
})
