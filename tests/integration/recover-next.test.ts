import { describe, test, expect, beforeAll } from 'bun:test'
import { spawn } from 'node:child_process'
import { resolve, join } from 'node:path'
import { writeFile, mkdtemp, mkdir, cp, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'

const FIXTURE_SRC = resolve(import.meta.dir, '../fixtures/inspect/v1-postgres')
const CLI = resolve(import.meta.dir, '../../src/cli.ts')

let FIXTURE = ''

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
  const fixDir = await mkdtemp(join(tmpdir(), 'dbcli-recover-next-'))
  await cp(FIXTURE_SRC, fixDir, { recursive: true })
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

const threeStepEnvelope = {
  schemaVersion: 1,
  generatedAt: '2026-05-10T11:30:00.000Z',
  ok: false,
  error: { code: 'BLACKLIST_TABLE', category: 'blacklist', message: 'x' },
  recovery: [
    {
      order: 1,
      command: 'dbcli blacklist list --format json',
      rationale: 'r1',
      risk: 'readonly',
      expects: 'e1',
    },
    {
      order: 2,
      command: 'dbcli inspect --for-agent',
      rationale: 'r2',
      risk: 'readonly',
      expects: 'e2',
    },
    {
      order: 3,
      command: 'dbcli blacklist remove orders',
      rationale: 'r3',
      risk: 'write',
      expects: 'e3',
    },
  ],
}

describe('dbcli recover --next happy path', () => {
  test('after step 1 returns step 2', async () => {
    await seedSavedEnvelope(FIXTURE, threeStepEnvelope)
    const r = await run(
      ['recover', '--next', '--after-step', '1', '--result', '{"status":"ok","exitCode":0}'],
      FIXTURE
    )
    expect(r.code).toBe(0)
    const j = JSON.parse(r.stdout)
    expect(j.schemaVersion).toBe(1)
    expect(j.kind).toBe('step')
    expect(j.cursor).toBe(2)
    expect(j.totalSteps).toBe(3)
    expect(j.errorCode).toBe('BLACKLIST_TABLE')
    expect(j.step.command).toBe('dbcli inspect --for-agent')
  })

  test('after step 3 (final) returns done', async () => {
    await seedSavedEnvelope(FIXTURE, threeStepEnvelope)
    const r = await run(
      ['recover', '--next', '--after-step', '3', '--result', '{"status":"ok"}'],
      FIXTURE
    )
    expect(r.code).toBe(0)
    const j = JSON.parse(r.stdout)
    expect(j.kind).toBe('done')
    expect(j.cursor).toBe(3)
    expect(j.step).toBeUndefined()
  })

  test('walks the entire plan deterministically', async () => {
    await seedSavedEnvelope(FIXTURE, threeStepEnvelope)
    const cmds: string[] = []
    for (let n = 1; n <= 3; n++) {
      const r = await run(
        [
          'recover',
          '--next',
          '--after-step',
          String(n),
          '--result',
          '{"status":"ok","exitCode":0}',
        ],
        FIXTURE
      )
      expect(r.code).toBe(0)
      const j = JSON.parse(r.stdout)
      if (j.kind === 'step') cmds.push(j.step.command)
    }
    expect(cmds).toEqual(['dbcli inspect --for-agent', 'dbcli blacklist remove orders'])
  })
})

describe('dbcli recover --next error paths', () => {
  test('--next without --after-step exits 2', async () => {
    await seedSavedEnvelope(FIXTURE, threeStepEnvelope)
    const r = await run(['recover', '--next', '--result', '{"status":"ok"}'], FIXTURE)
    expect(r.code).not.toBe(0)
    expect(r.stderr).toContain('--after-step')
  })

  test('--next without --result exits 2', async () => {
    await seedSavedEnvelope(FIXTURE, threeStepEnvelope)
    const r = await run(['recover', '--next', '--after-step', '1'], FIXTURE)
    expect(r.code).not.toBe(0)
    expect(r.stderr).toContain('--result')
  })

  test('--next + --apply exits 2', async () => {
    await seedSavedEnvelope(FIXTURE, threeStepEnvelope)
    const r = await run(
      ['recover', '--next', '--apply', '--after-step', '1', '--result', '{"status":"ok"}'],
      FIXTURE
    )
    expect(r.code).not.toBe(0)
    expect(r.stderr).toContain('cannot be combined')
  })

  test('--after-step out of range exits 2', async () => {
    await seedSavedEnvelope(FIXTURE, threeStepEnvelope)
    const r = await run(
      ['recover', '--next', '--after-step', '99', '--result', '{"status":"ok"}'],
      FIXTURE
    )
    expect(r.code).not.toBe(0)
    expect(r.stderr).toContain('exceeds plan length')
  })

  test('--after-step 0 exits 2', async () => {
    await seedSavedEnvelope(FIXTURE, threeStepEnvelope)
    const r = await run(
      ['recover', '--next', '--after-step', '0', '--result', '{"status":"ok"}'],
      FIXTURE
    )
    expect(r.code).not.toBe(0)
    expect(r.stderr).toContain('>= 1')
  })

  test('--result malformed JSON exits 2', async () => {
    await seedSavedEnvelope(FIXTURE, threeStepEnvelope)
    const r = await run(['recover', '--next', '--after-step', '1', '--result', 'not json'], FIXTURE)
    expect(r.code).not.toBe(0)
    expect(r.stderr).toContain('JSON')
  })

  test('--result schema-malformed exits 2', async () => {
    await seedSavedEnvelope(FIXTURE, threeStepEnvelope)
    const r = await run(
      ['recover', '--next', '--after-step', '1', '--result', '{"status":"weird"}'],
      FIXTURE
    )
    expect(r.code).not.toBe(0)
    expect(r.stderr).toContain('status')
  })
})

describe('dbcli recover --next --result @file', () => {
  test('reads result from file', async () => {
    await seedSavedEnvelope(FIXTURE, threeStepEnvelope)
    await writeFile(
      join(FIXTURE, 'r.json'),
      JSON.stringify({ status: 'ok', exitCode: 0, stdoutSummary: 'snapshot' })
    )
    const r = await run(['recover', '--next', '--after-step', '1', '--result', '@r.json'], FIXTURE)
    expect(r.code).toBe(0)
    const j = JSON.parse(r.stdout)
    expect(j.kind).toBe('step')
    expect(j.step.order).toBe(2)
  })

  test('@file missing exits 2', async () => {
    await seedSavedEnvelope(FIXTURE, threeStepEnvelope)
    const r = await run(
      ['recover', '--next', '--after-step', '1', '--result', '@no-such-file.json'],
      FIXTURE
    )
    expect(r.code).not.toBe(0)
    expect(r.stderr).toContain('not readable')
  })
})

describe('dbcli recover --next --format markdown', () => {
  test('renders human-readable next step', async () => {
    await seedSavedEnvelope(FIXTURE, threeStepEnvelope)
    const r = await run(
      [
        'recover',
        '--next',
        '--after-step',
        '1',
        '--result',
        '{"status":"ok"}',
        '--format',
        'markdown',
      ],
      FIXTURE
    )
    expect(r.code).toBe(0)
    expect(r.stdout).toContain('# dbcli recover --next')
    expect(r.stdout).toContain('## Next step (2 of 3)')
    expect(r.stdout).toContain('`dbcli inspect --for-agent`')
  })

  test('renders done when plan exhausted', async () => {
    await seedSavedEnvelope(FIXTURE, threeStepEnvelope)
    const r = await run(
      [
        'recover',
        '--next',
        '--after-step',
        '3',
        '--result',
        '{"status":"ok"}',
        '--format',
        'markdown',
      ],
      FIXTURE
    )
    expect(r.code).toBe(0)
    expect(r.stdout).toContain('## Done')
    expect(r.stdout).toContain('All 3 steps consumed')
  })
})

describe('dbcli recover --next --from <file>', () => {
  test('reads envelope from --from path', async () => {
    const envFile = join(FIXTURE, 'env.json')
    await writeFile(envFile, JSON.stringify(threeStepEnvelope))
    const r = await run(
      [
        'recover',
        '--next',
        '--after-step',
        '2',
        '--result',
        '{"status":"ok"}',
        '--from',
        'env.json',
      ],
      FIXTURE
    )
    expect(r.code).toBe(0)
    const j = JSON.parse(r.stdout)
    expect(j.kind).toBe('step')
    expect(j.cursor).toBe(3)
    expect(j.source.kind).toBe('from')
  })
})

describe('dbcli recover --next flag precedence', () => {
  test('--next + --apply is rejected before envelope resolution', async () => {
    // Use a fresh empty cwd with no .dbcli/last-recovery.json — the mutual
    // exclusion check must fire before we try to read the missing envelope.
    const emptyCwd = await realpath(await mkdtemp(join(tmpdir(), 'dbcli-recover-next-empty-')))
    const r = await run(
      ['recover', '--next', '--apply', '--after-step', '1', '--result', '{"status":"ok"}'],
      emptyCwd
    )
    expect(r.code).not.toBe(0)
    expect(r.stderr).toContain('cannot be combined')
    expect(r.stderr).not.toContain('No recovery plan available')
  })

  test('--next ignores --allow-write (any value, including invalid)', async () => {
    await seedSavedEnvelope(FIXTURE, threeStepEnvelope)
    const r = await run(
      [
        'recover',
        '--next',
        '--after-step',
        '1',
        '--result',
        '{"status":"ok"}',
        '--allow-write',
        'bad',
      ],
      FIXTURE
    )
    expect(r.code).toBe(0)
    const j = JSON.parse(r.stdout)
    expect(j.kind).toBe('step')
    expect(j.cursor).toBe(2)
  })
})
