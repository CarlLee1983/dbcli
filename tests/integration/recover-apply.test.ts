import { describe, test, expect, beforeAll } from 'bun:test'
import { spawn } from 'node:child_process'
import { resolve, join } from 'node:path'
import { writeFile, readFile, mkdtemp, mkdir, cp, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'

const FIXTURE_SRC = resolve(import.meta.dir, '../fixtures/inspect/v1-postgres')
const CLI = resolve(import.meta.dir, '../../src/cli.ts')

let FIXTURE = ''
let NO_CONFIG = ''

function sanitizeEnv(): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {}
  let originalPath = ''
  for (const [k, v] of Object.entries(process.env)) {
    if (/^DBCLI_/i.test(k)) continue
    if (k === 'DATABASE_URL') continue
    if (k.toUpperCase() === 'PATH') {
      originalPath = v || ''
      continue
    }
    out[k] = v
  }
  out.NODE_ENV = 'test'
  out.DBCLI_NO_UPDATE_CHECK = '1'
  
  const pathKey = process.platform === 'win32' ? 'Path' : 'PATH'
  if (FIXTURE) {
    out[pathKey] = `${FIXTURE}${process.platform === 'win32' ? ';' : ':'}${originalPath}`
  } else {
    out[pathKey] = originalPath
  }
  return out
}

function run(
  args: string[],
  cwd: string
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((res) => {
    const child = spawn('bun', ['run', CLI, ...args], { cwd, env: sanitizeEnv() })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (b) => (stdout += b.toString()))
    child.stderr.on('data', (b) => (stderr += b.toString()))
    child.on('close', (code) => res({ stdout, stderr, code: code ?? 0 }))
    child.on('error', (err) => {
      console.error('SPAWN ERROR:', err)
      res({ stdout, stderr, code: 1 })
    })
  })
}

beforeAll(async () => {
  const fixDir = await mkdtemp(join(tmpdir(), 'dbcli-recover-apply-'))
  await cp(FIXTURE_SRC, fixDir, { recursive: true })
  const idxPath = resolve(fixDir, '.dbcli/schemas/index.json')
  const raw = JSON.parse(await readFile(idxPath, 'utf8'))
  raw.metadata.lastRefreshed = new Date().toISOString()
  await writeFile(idxPath, JSON.stringify(raw, null, 2))
  FIXTURE = await realpath(fixDir)

  // Create a local dbcli shim so recovery steps find it on PATH
  const shimName = process.platform === 'win32' ? 'dbcli.cmd' : 'dbcli'
  const shimPath = join(FIXTURE, shimName)
  const shimContent = process.platform === 'win32'
    ? `@bun run "${CLI}" %*`
    : `#!/bin/sh\nbun run "${CLI}" "$@"`
  await writeFile(shimPath, shimContent)
  if (process.platform !== 'win32') {
    const { chmod } = await import('node:fs/promises')
    await chmod(shimPath, 0o755)
  }

  const noCfg = await mkdtemp(join(tmpdir(), 'dbcli-recover-apply-empty-'))
  NO_CONFIG = await realpath(noCfg)
})

async function seedSavedEnvelope(cwd: string, envelope: Record<string, unknown>): Promise<void> {
  await mkdir(join(cwd, '.dbcli'), { recursive: true })
  await writeFile(
    join(cwd, '.dbcli/last-recovery.json'),
    JSON.stringify({
      schemaVersion: 1,
      savedAt: new Date().toISOString(),
      command: 'dbcli test',
      cwd,
      envelope,
    })
  )
}

describe('dbcli recover --apply happy path', () => {
  test('runs all readonly steps for BLACKLIST_TABLE and exits 0', async () => {
    // Note: uses inspect --for-agent for readonly steps because that subcommand is
    // dependable across dbcli versions on PATH; the orchestrator-under-test does
    // not care which dbcli step runs, only that the gate→exec→aggregate flow works.
    await seedSavedEnvelope(FIXTURE, {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      ok: false,
      error: {
        code: 'BLACKLIST_TABLE',
        category: 'blacklist',
        message: 'x',
        details: { table: 'orders' },
      },
      recovery: [
        {
          order: 1,
          command: 'dbcli inspect --for-agent',
          rationale: '',
          risk: 'readonly',
          expects: '',
        },
        {
          order: 2,
          command: 'dbcli inspect --for-agent',
          rationale: '',
          risk: 'readonly',
          expects: '',
        },
        {
          order: 3,
          command: 'dbcli blacklist remove orders',
          rationale: '',
          risk: 'write',
          expects: '',
        },
      ],
    })
    const { stdout, code } = await run(['recover', '--apply', '--format', 'json'], FIXTURE)
    expect(code).toBe(0)
    const j = JSON.parse(stdout)
    expect(j.finalStatus).toBe('ok')
    expect(j.results.length).toBe(3)
    expect(j.results[0].status).toBe('ok')
    expect(j.results[2].status).toBe('skipped:risk')
  })

  test('exits 3 (skipped-only) when every step is gated out', async () => {
    await seedSavedEnvelope(FIXTURE, {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      ok: false,
      error: { code: 'CONFIG_MISSING', category: 'config', message: 'x' },
      recovery: [
        {
          order: 1,
          command: 'dbcli init',
          rationale: '',
          risk: 'write',
          expects: '',
          interactive: true,
        },
      ],
    })
    const { code } = await run(['recover', '--apply', '--format', 'json'], FIXTURE)
    expect(code).toBe(3)
  })

  test('--allow-write=readonly-cmd promotes local-write step to ok', async () => {
    await seedSavedEnvelope(FIXTURE, {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      ok: false,
      error: { code: 'BLACKLIST_TABLE', category: 'blacklist', message: 'x' },
      recovery: [
        {
          order: 1,
          command: 'dbcli inspect --for-agent',
          rationale: '',
          risk: 'readonly',
          expects: '',
        },
      ],
    })
    const { stdout, code } = await run(
      ['recover', '--apply', '--allow-write=readonly-cmd', '--format', 'json'],
      FIXTURE
    )
    expect(code).toBe(0)
    const j = JSON.parse(stdout)
    expect(j.finalStatus).toBe('ok')
  })

  test('--from with raw envelope synthesizes cwd and runs', async () => {
    const path = join(FIXTURE, 'raw-env.json')
    await writeFile(
      path,
      JSON.stringify({
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        ok: false,
        error: { code: 'BLACKLIST_TABLE', category: 'blacklist', message: 'x' },
        recovery: [
          {
            order: 1,
            command: 'dbcli inspect --for-agent',
            rationale: '',
            risk: 'readonly',
            expects: '',
          },
        ],
      })
    )
    const { code, stdout } = await run(
      ['recover', '--apply', '--from', path, '--format', 'json'],
      FIXTURE
    )
    expect(code).toBe(0)
    const j = JSON.parse(stdout)
    expect(j.source.kind).toBe('from')
  })

  test('--apply default format is JSON (no --format flag)', async () => {
    await seedSavedEnvelope(FIXTURE, {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      ok: false,
      error: { code: 'BLACKLIST_TABLE', category: 'blacklist', message: 'x' },
      recovery: [
        {
          order: 1,
          command: 'dbcli inspect --for-agent',
          rationale: '',
          risk: 'readonly',
          expects: '',
        },
      ],
    })
    const { stdout, code } = await run(['recover', '--apply'], FIXTURE)
    expect(code).toBe(0)
    // Must be JSON.parse-able by default (not Markdown).
    const j = JSON.parse(stdout)
    expect(j.finalStatus).toBe('ok')
    expect(j.schemaVersion).toBe(1)
  })

  test('--apply --format markdown emits Markdown', async () => {
    await seedSavedEnvelope(FIXTURE, {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      ok: false,
      error: { code: 'BLACKLIST_TABLE', category: 'blacklist', message: 'x' },
      recovery: [
        {
          order: 1,
          command: 'dbcli inspect --for-agent',
          rationale: '',
          risk: 'readonly',
          expects: '',
        },
      ],
    })
    const { stdout, code } = await run(['recover', '--apply', '--format', 'markdown'], FIXTURE)
    expect(code).toBe(0)
    expect(stdout).toContain('# dbcli recover --apply')
  })
})

describe('dbcli recover --apply security boundary', () => {
  test('rejects shell metacharacters with skipped:unsafe-command', async () => {
    await seedSavedEnvelope(FIXTURE, {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      ok: false,
      error: { code: 'BLACKLIST_TABLE', category: 'blacklist', message: 'x' },
      recovery: [
        {
          order: 1,
          command: 'dbcli inspect --for-agent; rm -rf /tmp/owned',
          rationale: '',
          risk: 'readonly',
          expects: '',
        },
      ],
    })
    const { stdout, code } = await run(
      ['recover', '--apply', '--allow-write=write-cmd', '--format', 'json'],
      FIXTURE
    )
    expect(code).toBe(3)
    const j = JSON.parse(stdout)
    expect(j.results[0].status).toBe('skipped:unsafe-command')
  })

  test('rejects non-allowlisted dbcli subcommand', async () => {
    await seedSavedEnvelope(FIXTURE, {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      ok: false,
      error: { code: 'CONFIG_MISSING', category: 'config', message: 'x' },
      recovery: [
        { order: 1, command: 'dbcli query SELECT 1', rationale: '', risk: 'readonly', expects: '' },
      ],
    })
    const { stdout, code } = await run(['recover', '--apply', '--format', 'json'], FIXTURE)
    expect(code).toBe(3)
    const j = JSON.parse(stdout)
    expect(j.results[0].status).toBe('skipped:unsafe-command')
  })
})

describe('dbcli recover --apply auto-source missing', () => {
  test('exits 2 when no envelope is available', async () => {
    const { stderr, code } = await run(['recover', '--apply'], NO_CONFIG)
    expect(code).toBe(2)
    expect(stderr).toContain('No recovery plan available')
  })

  test('--from with malformed JSON exits 2', async () => {
    const path = join(FIXTURE, 'bad.json')
    await writeFile(path, '{ not json')
    const { code } = await run(['recover', '--apply', '--from', path], FIXTURE)
    expect(code).toBe(2)
  })
})

describe('dbcli recover (no --apply)', () => {
  test('prints the saved envelope as Markdown by default', async () => {
    await seedSavedEnvelope(FIXTURE, {
      schemaVersion: 1,
      generatedAt: '2026-05-10T00:00:00.000Z',
      ok: false,
      error: { code: 'BLACKLIST_TABLE', category: 'blacklist', message: 'x' },
      recovery: [],
    })
    const { stdout, code } = await run(['recover'], FIXTURE)
    expect(code).toBe(0)
    expect(stdout).toContain('BLACKLIST_TABLE')
  })

  test('--format json prints the envelope as JSON', async () => {
    await seedSavedEnvelope(FIXTURE, {
      schemaVersion: 1,
      generatedAt: '2026-05-10T00:00:00.000Z',
      ok: false,
      error: { code: 'BLACKLIST_TABLE', category: 'blacklist', message: 'x' },
      recovery: [],
    })
    const { stdout, code } = await run(['recover', '--format', 'json'], FIXTURE)
    expect(code).toBe(0)
    const j = JSON.parse(stdout)
    expect(j.error.code).toBe('BLACKLIST_TABLE')
  })
})

describe('dbcli recover --apply verify (P4)', () => {
  test('runs verify after success on BLACKLIST_TABLE and reports verifyStatus passed', async () => {
    await seedSavedEnvelope(FIXTURE, {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      ok: false,
      error: { code: 'BLACKLIST_TABLE', category: 'blacklist', message: 'x' },
      recovery: [
        {
          order: 1,
          command: 'dbcli inspect --for-agent',
          rationale: '',
          risk: 'readonly',
          expects: '',
        },
      ],
      verify: {
        order: 0,
        command: 'dbcli inspect --for-agent',
        rationale: '',
        risk: 'readonly',
        expects: '',
      },
    })
    const { stdout, code } = await run(['recover', '--apply', '--format', 'json'], FIXTURE)
    expect(code).toBe(0)
    const payload = JSON.parse(stdout)
    expect(payload.finalStatus).toBe('ok')
    expect(payload.verifyStatus).toBe('passed')
    expect(payload.verifyResult).toBeDefined()
    expect(payload.verifyResult.command).toBe('dbcli inspect --for-agent')
    expect(payload.verifyResult.status).toBe('ok')
  })

  test('no-verify flag suppresses the verify step', async () => {
    await seedSavedEnvelope(FIXTURE, {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      ok: false,
      error: { code: 'BLACKLIST_TABLE', category: 'blacklist', message: 'x' },
      recovery: [
        {
          order: 1,
          command: 'dbcli inspect --for-agent',
          rationale: '',
          risk: 'readonly',
          expects: '',
        },
      ],
      verify: {
        order: 0,
        command: 'dbcli inspect --for-agent',
        rationale: '',
        risk: 'readonly',
        expects: '',
      },
    })
    const { stdout, code } = await run(
      ['recover', '--apply', '--no-verify', '--format', 'json'],
      FIXTURE
    )
    expect(code).toBe(0)
    const payload = JSON.parse(stdout)
    expect(payload.finalStatus).toBe('ok')
    expect(payload.verifyStatus).toBeUndefined()
    expect(payload.verifyResult).toBeUndefined()
  })

  test('skipped-only main loop suppresses verify', async () => {
    await seedSavedEnvelope(FIXTURE, {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      ok: false,
      error: { code: 'BLACKLIST_TABLE', category: 'blacklist', message: 'x' },
      recovery: [
        {
          order: 1,
          command: 'dbcli blacklist remove orders',
          rationale: '',
          risk: 'write',
          expects: '',
        },
      ],
      verify: {
        order: 0,
        command: 'dbcli inspect --for-agent',
        rationale: '',
        risk: 'readonly',
        expects: '',
      },
    })
    const { stdout, code } = await run(['recover', '--apply', '--format', 'json'], FIXTURE)
    expect(code).toBe(3)
    const payload = JSON.parse(stdout)
    expect(payload.finalStatus).toBe('skipped-only')
    expect(payload.verifyStatus).toBeUndefined()
  })

  test('SCHEMA_CACHE_MISSING verify uses inspect --format json and reports passed when cache available', async () => {
    await seedSavedEnvelope(FIXTURE, {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      ok: false,
      error: { code: 'SCHEMA_CACHE_MISSING', category: 'schema-cache', message: 'x' },
      recovery: [
        {
          order: 1,
          command: 'dbcli inspect --for-agent',
          rationale: '',
          risk: 'readonly',
          expects: '',
        },
      ],
      verify: {
        order: 0,
        command: 'dbcli inspect --format json',
        rationale: '',
        risk: 'readonly',
        expects: '',
      },
    })
    const { stdout, code } = await run(['recover', '--apply', '--format', 'json'], FIXTURE)
    expect(code).toBe(0)
    const payload = JSON.parse(stdout)
    expect(payload.verifyStatus).toBe('passed')
  })
})
