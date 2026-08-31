/**
 * `dbcli evidence validate` over artifacts the current format does not own.
 *
 * The machine-readable result has to separate three answers that used to
 * collapse into one: a current pack, a recognised old pack, and something the
 * reader cannot name. Frozen fixtures, never regenerated — see
 * `tests/fixtures/evidence-legacy/README.md`.
 */

import { afterEach, describe, expect, test } from 'bun:test'
import { spawn } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const CLI = resolve(import.meta.dir, '../../src/cli.ts')
const FIXTURES = resolve(import.meta.dir, '../fixtures/evidence-legacy')

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

const created: string[] = []

async function workspace(): Promise<string> {
  const work = await mkdtemp(join(tmpdir(), 'dbcli-evidence-legacy-'))
  created.push(work)
  await mkdir(join(work, '.dbcli', 'evidence'), { recursive: true })
  await writeFile(
    join(work, 'config.json'),
    JSON.stringify({
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
    })
  )
  return work
}

async function place(work: string, fixture: string): Promise<string> {
  const relativePath = join('.dbcli', 'evidence', 'pack.json')
  await copyFile(join(FIXTURES, fixture), join(work, relativePath))
  return relativePath
}

afterEach(async () => {
  await Promise.all(created.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('dbcli evidence validate (legacy artifacts)', () => {
  test.each([
    ['legacy-v1-pack.json', 'v1-coverage', 'dbcli 2.1.0 or earlier'],
    ['v3-mislabeled-pack.json', 'v1-untagged-v3', 'dbcli 3.0.0'],
  ])('%s reports recognized-legacy and never current-valid', async (fixture, legacy, producer) => {
    const work = await workspace()
    const file = await place(work, fixture)
    const result = await run(['evidence', 'validate', '--file', file, '--format', 'json'], work)
    expect(result.code).toBe(1)
    const parsed = JSON.parse(result.stdout)
    expect(parsed).toMatchObject({
      status: 'recognized-legacy',
      format: 'legacy',
      formatVersion: 1,
      trust: 'not-current-valid',
      integrity: 'legacy-verified',
      references: 'not-evaluated',
      legacyFormat: legacy,
      producedBy: producer,
    })
    // The old failure mode: an old artifact reported as a corrupt one.
    expect(result.stdout).not.toContain('digest mismatch')
  })

  test('an unknown version fails closed as unsupported', async () => {
    const work = await workspace()
    const raw = JSON.parse(readFileSync(join(FIXTURES, 'v3-mislabeled-pack.json'), 'utf8'))
    raw.version = 42
    const file = join('.dbcli', 'evidence', 'pack.json')
    await writeFile(join(work, file), JSON.stringify(raw, null, 2))
    const result = await run(['evidence', 'validate', '--file', file, '--format', 'json'], work)
    expect(result.code).toBe(1)
    expect(JSON.parse(result.stdout)).toMatchObject({
      status: 'unsupported',
      format: 'unsupported',
      formatVersion: 42,
      trust: 'not-current-valid',
      references: 'not-evaluated',
    })
  })

  test('render refuses a legacy pack with a legacy message, not a digest complaint', async () => {
    const work = await workspace()
    const file = await place(work, 'legacy-v1-pack.json')
    const result = await run(['evidence', 'render', '--file', file], work)
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('legacy format v1-coverage')
    expect(result.stderr).not.toContain('digest mismatch')
  })

  test('compose refuses a legacy receipt reference instead of trusting it', async () => {
    const work = await workspace()
    await copyFile(
      join(FIXTURES, 'legacy-v1-receipt-assert.json'),
      join(work, '.dbcli', 'evidence', 'receipt.json')
    )
    await writeFile(
      join(work, 'claims.json'),
      JSON.stringify({
        subject: { kind: 'table', name: 'orders' },
        claims: [{ id: 'claim-a', text: 'The reviewed window matches the change request.' }],
      })
    )
    const result = await run(
      [
        'evidence',
        'compose',
        '--claims',
        'claims.json',
        '--receipt',
        join('.dbcli', 'evidence', 'receipt.json'),
        '--output',
        join('.dbcli', 'evidence', 'pack.json'),
      ],
      work
    )
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('legacy format v1-observation-fingerprint')
  })
})
