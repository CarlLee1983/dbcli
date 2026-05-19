import { describe, test, expect, beforeAll } from 'bun:test'
import { spawn } from 'node:child_process'
import { resolve, join } from 'node:path'
import { writeFile, mkdtemp, mkdir, cp, realpath, chmod } from 'node:fs/promises'
import { tmpdir } from 'node:os'

const FIXTURE_SRC = resolve(import.meta.dir, '../fixtures/inspect/v1-postgres')
const CLI = resolve(import.meta.dir, '../../src/cli.ts')
let FIXTURE = ''

function sanitizeEnv(): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {}
  let originalPath = ''
  for (const [k, v] of Object.entries(process.env)) {
    const uk = k.toUpperCase()
    if (uk === 'PATH') {
      originalPath = v || ''
    }
    if (/^DBCLI_/i.test(k)) continue
    if (k === 'DATABASE_URL') continue
    if (uk === 'PATH') continue
    out[k] = v
  }
  out.NODE_ENV = 'test'
  out.DBCLI_NO_UPDATE_CHECK = '1'
  const finalPath = FIXTURE
    ? `${FIXTURE}${process.platform === 'win32' ? ';' : ':'}${originalPath}`
    : originalPath
  out.PATH = finalPath
  if (process.platform === 'win32') {
    out.Path = finalPath
    out.path = finalPath
  }
  return out
}

function run(
  args: string[],
  cwd: string
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((res) => {
    const child = spawn(process.execPath, ['run', CLI, ...args], {
      cwd,
      env: sanitizeEnv(),
    })
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
  const fixDir = await mkdtemp(join(tmpdir(), 'dbcli-recover-branching-'))
  await cp(FIXTURE_SRC, fixDir, { recursive: true })
  FIXTURE = await realpath(fixDir)

  const shimName = process.platform === 'win32' ? 'dbcli.cmd' : 'dbcli'
  const shimPath = join(FIXTURE, shimName)
  const shimContent =
    process.platform === 'win32' ? `@bun run "${CLI}" %*` : `#!/bin/sh\nbun run "${CLI}" "$@"`
  await writeFile(shimPath, shimContent)
  if (process.platform !== 'win32') {
    await chmod(shimPath, 0o755)
  }
})

async function seedConnectionEnvelope(cwd: string): Promise<void> {
  await mkdir(join(cwd, '.dbcli'), { recursive: true })
  const { classifyError } = await import('@/core/recovery/classify')
  const { ConnectionError } = await import('@/adapters/types')
  const envelope = classifyError(new ConnectionError('ECONNREFUSED', 'refused', []), {
    operation: 'query',
  })
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

const DOCTOR_AUTH_JSON = JSON.stringify({
  results: [
    {
      group: 'connection',
      label: 'Connection',
      status: 'error',
      message: 'password authentication failed',
    },
  ],
  hasError: true,
})
const DOCTOR_NETWORK_JSON = JSON.stringify({
  results: [
    {
      group: 'connection',
      label: 'Connection',
      status: 'error',
      message: 'ECONNREFUSED 127.0.0.1:5432',
    },
  ],
  hasError: true,
})
const DOCTOR_CLEAN_JSON = JSON.stringify({
  results: [{ group: 'connection', label: 'Connection', status: 'pass', message: 'ok' }],
  hasError: false,
})

describe('dbcli recover --next branching (E2E)', () => {
  test('--after-step 1 with auth doctor JSON forks to doctor-auth-error', async () => {
    await seedConnectionEnvelope(FIXTURE)
    const r = await run(
      [
        'recover',
        '--next',
        '--after-step',
        '1',
        '--result',
        JSON.stringify({ status: 'ok', stdoutSummary: DOCTOR_AUTH_JSON }),
      ],
      FIXTURE
    )
    expect(r.code).toBe(0)
    const j = JSON.parse(r.stdout)
    expect(j.branchId).toBe('doctor-auth-error')
    expect(j.step.command).toBe('dbcli init --force')
  })

  test('post-fork continuation: --branch doctor-auth-error --after-step 1 → next branch step', async () => {
    await seedConnectionEnvelope(FIXTURE)
    const r = await run(
      [
        'recover',
        '--next',
        '--after-step',
        '1',
        '--branch',
        'doctor-auth-error',
        '--result',
        '{"status":"ok"}',
      ],
      FIXTURE
    )
    expect(r.code).toBe(0)
    const j = JSON.parse(r.stdout)
    expect(j.branchId).toBe('doctor-auth-error')
    expect(j.cursor).toBe(2)
    expect(j.step.command).toBe('dbcli inspect --no-connect --format json')
  })

  test('walking to the end of a branch returns done', async () => {
    await seedConnectionEnvelope(FIXTURE)
    const r = await run(
      [
        'recover',
        '--next',
        '--after-step',
        '2',
        '--branch',
        'doctor-auth-error',
        '--result',
        '{"status":"ok"}',
      ],
      FIXTURE
    )
    expect(r.code).toBe(0)
    const j = JSON.parse(r.stdout)
    expect(j.kind).toBe('done')
    expect(j.branchId).toBe('doctor-auth-error')
  })

  test('network doctor JSON forks to doctor-network-error', async () => {
    await seedConnectionEnvelope(FIXTURE)
    const r = await run(
      [
        'recover',
        '--next',
        '--after-step',
        '1',
        '--result',
        JSON.stringify({ status: 'ok', stdoutSummary: DOCTOR_NETWORK_JSON }),
      ],
      FIXTURE
    )
    expect(r.code).toBe(0)
    const j = JSON.parse(r.stdout)
    expect(j.branchId).toBe('doctor-network-error')
  })

  test('clean doctor JSON forks to doctor-clean (single-step branch)', async () => {
    await seedConnectionEnvelope(FIXTURE)
    const r = await run(
      [
        'recover',
        '--next',
        '--after-step',
        '1',
        '--result',
        JSON.stringify({ status: 'ok', stdoutSummary: DOCTOR_CLEAN_JSON }),
      ],
      FIXTURE
    )
    expect(r.code).toBe(0)
    const j = JSON.parse(r.stdout)
    expect(j.branchId).toBe('doctor-clean')
    expect(j.step.command).toBe('dbcli inspect --for-agent')
  })

  test('non-JSON result falls back to linear recovery', async () => {
    await seedConnectionEnvelope(FIXTURE)
    const r = await run(
      [
        'recover',
        '--next',
        '--after-step',
        '1',
        '--result',
        JSON.stringify({ status: 'failed', stdoutSummary: 'totally not json' }),
      ],
      FIXTURE
    )
    expect(r.code).toBe(0)
    const j = JSON.parse(r.stdout)
    expect(j.branchId).toBeUndefined()
    expect(j.step.command).toBe('dbcli inspect --no-connect --format json')
  })

  test('--branch on non-connection envelope exits 2', async () => {
    await mkdir(join(FIXTURE, '.dbcli'), { recursive: true })
    await writeFile(
      join(FIXTURE, '.dbcli/last-recovery.json'),
      JSON.stringify({
        schemaVersion: 1,
        savedAt: new Date().toISOString(),
        command: 'dbcli test',
        cwd: FIXTURE,
        envelope: {
          schemaVersion: 1,
          generatedAt: '2026-05-18T00:00:00.000Z',
          ok: false,
          error: { code: 'BLACKLIST_TABLE', category: 'blacklist', message: 'x' },
          recovery: [
            {
              order: 1,
              command: 'dbcli blacklist list --format json',
              rationale: 'r',
              risk: 'readonly',
              expects: 'e',
            },
          ],
        },
      })
    )
    const r = await run(
      [
        'recover',
        '--next',
        '--after-step',
        '1',
        '--branch',
        'doctor-clean',
        '--result',
        '{"status":"ok"}',
      ],
      FIXTURE
    )
    expect(r.code).toBe(2)
  })

  test('--apply on a connection envelope still walks recovery linearly (no branch use)', async () => {
    await seedConnectionEnvelope(FIXTURE)
    const r = await run(
      ['recover', '--apply', '--format', 'json', '--allow-write', 'readonly-cmd'],
      FIXTURE
    )
    if (r.stdout.trim().startsWith('{')) {
      const j = JSON.parse(r.stdout)
      // Apply walks `recovery` linearly: the apply response itself must not
      // carry a top-level branchId, and the executed `results[]` entries must
      // not be branch steps (no branchId field on result items).
      expect(j.branchId).toBeUndefined()
      for (const res of j.results ?? []) {
        expect(res.branchId).toBeUndefined()
      }
    }
  })

  test('--format markdown includes Branch surface', async () => {
    await seedConnectionEnvelope(FIXTURE)
    const r = await run(
      [
        'recover',
        '--next',
        '--after-step',
        '1',
        '--format',
        'markdown',
        '--result',
        JSON.stringify({ status: 'ok', stdoutSummary: DOCTOR_AUTH_JSON }),
      ],
      FIXTURE
    )
    expect(r.code).toBe(0)
    expect(r.stdout).toContain('**Branch:** `doctor-auth-error`')
  })
})
