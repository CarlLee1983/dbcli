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
  cwd: string
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((res) => {
    const child = spawn('bun', ['run', CLI, ...args], { cwd, env: sanitizeEnv() })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (b) => (stdout += b.toString()))
    child.stderr.on('data', (b) => (stderr += b.toString()))
    child.on('close', (code) => res({ stdout, stderr, code: code ?? 0 }))
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
    expect(j.results[0].status).toBe('ok')
    expect(j.results[1].status).toBe('ok')
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
