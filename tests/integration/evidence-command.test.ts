import { afterEach, describe, expect, test } from 'bun:test'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const CLI = resolve(import.meta.dir, '../../src/cli.ts')
const AUDIT_ID = 'a1111111-evidence-audit'
const VERIFICATION_ID = 'ver_evidence-verify-1'

function config(blacklist: string[] = []): unknown {
  return {
    connection: {
      system: 'postgresql',
      host: 'localhost',
      port: 5432,
      user: 'u',
      password: 'p',
      database: 'd',
    },
    permission: 'query-only',
    metadata: { createdAt: '2026-08-08T00:00:00.000Z', version: '1.0' },
    ...(blacklist.length > 0 ? { blacklist: { tables: blacklist } } : {}),
  }
}

function sanitizeEnv(): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (!/^DBCLI_/i.test(key) && key !== 'DATABASE_URL') out[key] = value
  }
  out.NODE_ENV = 'test'
  out.DBCLI_NO_UPDATE_CHECK = '1'
  return out
}

function run(
  args: string[],
  workDir: string
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolveRun) => {
    const child = spawn('bun', ['run', CLI, '--config', workDir, ...args], {
      cwd: workDir,
      env: sanitizeEnv(),
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => (stdout += chunk.toString()))
    child.stderr.on('data', (chunk) => (stderr += chunk.toString()))
    child.on('close', (code) => resolveRun({ stdout, stderr, code: code ?? 0 }))
  })
}

async function seed(blacklist: string[] = []): Promise<string> {
  const work = await mkdtemp(join(tmpdir(), 'dbcli-evidence-command-'))
  await mkdir(join(work, '.dbcli', 'audit'), { recursive: true })
  await mkdir(join(work, '.dbcli', 'verification'), { recursive: true })
  await writeFile(join(work, 'config.json'), JSON.stringify(config(blacklist), null, 2))
  await writeFile(
    join(work, '.dbcli', 'audit', 'default.jsonl'),
    `${JSON.stringify({
      id: AUDIT_ID,
      ts: '2026-08-08T10:00:00.000Z',
      session_id: 'test-session',
      engine: 'postgresql',
      command: 'migrate',
      side_effect_tier: 'write',
      target: 'sensitive_users',
      success: true,
      redacted_sql: 'ALTER TABLE sensitive_users ADD COLUMN secret text',
      metadata: { private: 'must-not-leak' },
    })}\n`
  )
  await writeFile(
    join(work, '.dbcli', 'verification', 'verification-20260808-100000-evidenceverify1.json'),
    JSON.stringify({
      schemaVersion: 1,
      id: VERIFICATION_ID,
      createdAt: '2026-08-08T10:00:00.000Z',
      status: 'verified',
      subject: { kind: 'migration', name: 'add_safe_index' },
      summary: 'The migration verification passed.',
      evidence: [{ kind: 'manual', command: 'verify constraint' }],
    })
  )
  await writeFile(
    join(work, 'claims.json'),
    JSON.stringify({
      subject: { kind: 'migration', name: 'add_safe_index' },
      claims: [
        { id: 'outcome', text: 'The migration has a recorded successful verification result.' },
      ],
    })
  )
  return work
}

let work: string | undefined

afterEach(async () => {
  if (work) await rm(work, { recursive: true, force: true })
  work = undefined
})

describe('dbcli evidence (CLI)', () => {
  test('composes a restricted pack, validates it, and renders it offline', async () => {
    work = await seed()
    const compose = await run(
      [
        'evidence',
        'compose',
        '--claims',
        'claims.json',
        '--verification',
        VERIFICATION_ID,
        '--audit',
        AUDIT_ID.slice(0, 8),
        '--output',
        '.dbcli/evidence/pack.json',
      ],
      work
    )

    expect(compose.code).toBe(0)
    const composed = JSON.parse(compose.stdout)
    expect(composed.path).toEndWith('/.dbcli/evidence/pack.json')

    const persisted = await Bun.file(join(work, '.dbcli/evidence/pack.json')).json()
    expect(JSON.stringify(persisted)).not.toContain('sensitive_users')
    expect(JSON.stringify(persisted)).not.toContain('redacted_sql')
    expect(JSON.stringify(persisted)).not.toContain('must-not-leak')
    expect(persisted.claims[0].evidence).toEqual([
      {
        kind: 'audit',
        id: AUDIT_ID,
        createdAt: '2026-08-08T10:00:00.000Z',
        connectionName: 'default',
        command: 'migrate',
        success: true,
      },
      {
        kind: 'verification-artifact',
        id: VERIFICATION_ID,
        createdAt: '2026-08-08T10:00:00.000Z',
        status: 'verified',
        subjectKind: 'migration',
      },
    ])

    const valid = await run(['evidence', 'validate', '--file', '.dbcli/evidence/pack.json'], work)
    expect(valid.code).toBe(0)
    expect(JSON.parse(valid.stdout)).toMatchObject({
      integrity: 'valid',
      references: 'valid',
      expired: [],
    })

    const rendered = await run(['evidence', 'render', '--file', '.dbcli/evidence/pack.json'], work)
    expect(rendered.code).toBe(0)
    expect(rendered.stdout).toContain('External claim — not a dbcli verification verdict.')
  })

  test('reports source-expired after audit retention while rendering remains available', async () => {
    work = await seed()
    const compose = await run(
      [
        'evidence',
        'compose',
        '--claims',
        'claims.json',
        '--audit',
        AUDIT_ID,
        '--output',
        '.dbcli/evidence/pack.json',
      ],
      work
    )
    expect(compose.code).toBe(0)
    await unlink(join(work, '.dbcli', 'audit', 'default.jsonl'))

    const validation = await run(
      ['evidence', 'validate', '--file', '.dbcli/evidence/pack.json'],
      work
    )
    expect(validation.code).toBe(1)
    expect(JSON.parse(validation.stdout)).toEqual({
      integrity: 'valid',
      references: 'source-expired',
      expired: [{ kind: 'audit', id: AUDIT_ID }],
    })

    const rendered = await run(
      ['evidence', 'render', '--file', '.dbcli/evidence/pack.json', '--format', 'json'],
      work
    )
    expect(rendered.code).toBe(0)
    expect(JSON.parse(rendered.stdout).id).toBeDefined()
  })

  test('reports source-expired when a retained audit id has changed safe evidence fields', async () => {
    work = await seed()
    const compose = await run(
      [
        'evidence',
        'compose',
        '--claims',
        'claims.json',
        '--audit',
        AUDIT_ID,
        '--output',
        '.dbcli/evidence/pack.json',
      ],
      work
    )
    expect(compose.code).toBe(0)
    await writeFile(
      join(work, '.dbcli', 'audit', 'default.jsonl'),
      `${JSON.stringify({
        id: AUDIT_ID,
        ts: '2026-08-08T10:00:00.000Z',
        session_id: 'test-session',
        engine: 'postgresql',
        command: 'query',
        side_effect_tier: 'readonly',
        target: 'other',
        success: false,
        redacted_query: 'dbcli query ?',
      })}\n`
    )

    const validation = await run(
      ['evidence', 'validate', '--file', '.dbcli/evidence/pack.json'],
      work
    )
    expect(validation.code).toBe(1)
    expect(JSON.parse(validation.stdout)).toMatchObject({ references: 'source-expired' })
  })

  test('refuses verification evidence for a different claims subject kind', async () => {
    work = await seed()
    await writeFile(
      join(work, 'claims.json'),
      JSON.stringify({
        subject: { kind: 'table', name: 'safe_table' },
        claims: [
          { id: 'outcome', text: 'The table has a recorded successful verification result.' },
        ],
      })
    )

    const result = await run(
      [
        'evidence',
        'compose',
        '--claims',
        'claims.json',
        '--verification',
        VERIFICATION_ID,
        '--output',
        '.dbcli/evidence/pack.json',
      ],
      work
    )
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('does not match the claims subject kind')
  })

  test('refuses to render a retained pack after its exposed subject becomes blacklisted', async () => {
    work = await seed()
    const compose = await run(
      [
        'evidence',
        'compose',
        '--claims',
        'claims.json',
        '--audit',
        AUDIT_ID,
        '--output',
        '.dbcli/evidence/pack.json',
      ],
      work
    )
    expect(compose.code).toBe(0)
    await writeFile(join(work, 'config.json'), JSON.stringify(config(['add_safe_index']), null, 2))

    const rendered = await run(['evidence', 'render', '--file', '.dbcli/evidence/pack.json'], work)
    expect(rendered.code).toBe(1)
    expect(rendered.stderr).toContain('blocked identifier')
  })

  test('rejects externally supplied claims that contain a blacklisted identifier', async () => {
    work = await seed(['secret_customer'])
    await writeFile(
      join(work, 'claims.json'),
      JSON.stringify({
        subject: { kind: 'secret_customer', name: 'add_safe_index' },
        claims: [{ id: 'secret_customer', text: 'The migration has completed.' }],
      })
    )

    const result = await run(
      [
        'evidence',
        'compose',
        '--claims',
        'claims.json',
        '--audit',
        AUDIT_ID,
        '--output',
        '.dbcli/evidence/pack.json',
      ],
      work
    )
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('blocked identifier')
    expect(await Bun.file(join(work, '.dbcli/evidence/pack.json')).exists()).toBe(false)
  })
})
