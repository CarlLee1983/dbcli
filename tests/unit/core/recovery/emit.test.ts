/**
 * Phase 25 D-51 / D-53 — unit tests for emit.ts (envelope id pre-gen) and
 * last-envelope.ts writeLastEnvelope (id + auditRef pass-through).
 *
 * emitRecoveryEnvelope calls process.exit(), so we exercise it via subprocess.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { writeLastEnvelope } from '@/core/recovery/last-envelope'
import type { RecoveryEnvelope } from '@/core/recovery/types'

const emitModulePath = resolve(import.meta.dir, '../../../../src/core/recovery/emit.ts')

function emitScript(workDir: string, opts: Record<string, unknown>): string {
  return `
import { emitRecoveryEnvelope } from '${emitModulePath}'
try {
  emitRecoveryEnvelope(
    new Error('boom'),
    { operation: 'query' },
    ${JSON.stringify({ cwd: workDir, argv: ['dbcli', 'query', 'select 1'], ...opts })}
  )
} catch (e) {
  console.error(e)
  process.exit(99)
}
`
}

function runEmit(
  workDir: string,
  opts: Record<string, unknown> = {}
): { code: number; stdout: string } {
  const r = spawnSync('bun', ['-e', emitScript(workDir, opts)], { encoding: 'utf8' })
  return { code: r.status ?? -1, stdout: r.stdout }
}

describe('emitRecoveryEnvelope id + audit_ref (Phase 25 D-51 / D-53)', () => {
  let workDir: string

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'dbcli-test-25-04-'))
  })

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true })
  })

  test('pre-generates a UUID for id when envelopeId is omitted', async () => {
    const { code } = runEmit(workDir)
    expect(code).toBe(1)
    const raw = await readFile(join(workDir, '.dbcli/last-recovery.json'), 'utf8')
    const parsed = JSON.parse(raw) as { id?: string; audit_ref?: string }
    expect(parsed.id).toMatch(/^[0-9a-f-]{36}$/)
  })

  test('persists the caller-supplied envelopeId verbatim', async () => {
    const FIXED_ID = 'f47ac10b-58cc-4372-a567-0e02b2c3d479'
    const { code } = runEmit(workDir, { envelopeId: FIXED_ID })
    expect(code).toBe(1)
    const raw = await readFile(join(workDir, '.dbcli/last-recovery.json'), 'utf8')
    const parsed = JSON.parse(raw) as { id?: string }
    expect(parsed.id).toBe(FIXED_ID)
  })

  test('persists audit_ref when supplied', async () => {
    const AUDIT_REF = '8b3c8f0c-1234-4abc-9def-0123456789ab'
    const { code } = runEmit(workDir, { envelopeId: 'X', auditRef: AUDIT_REF })
    expect(code).toBe(1)
    const raw = await readFile(join(workDir, '.dbcli/last-recovery.json'), 'utf8')
    const parsed = JSON.parse(raw) as { id?: string; audit_ref?: string }
    expect(parsed.id).toBe('X')
    expect(parsed.audit_ref).toBe(AUDIT_REF)
  })

  test('omits audit_ref key from JSON when auditRef is undefined (D-53)', async () => {
    const { code } = runEmit(workDir, { envelopeId: 'X' })
    expect(code).toBe(1)
    const raw = await readFile(join(workDir, '.dbcli/last-recovery.json'), 'utf8')
    const parsed = JSON.parse(raw) as Record<string, unknown>
    expect(parsed.id).toBe('X')
    expect('audit_ref' in parsed).toBe(false)
  })

  test('stdout JSON renders RecoveryEnvelope body shape unchanged (D-52)', async () => {
    const { code, stdout } = runEmit(workDir, { envelopeId: 'X', auditRef: 'A' })
    expect(code).toBe(1)
    const env = JSON.parse(stdout) as Record<string, unknown>
    expect(env.schemaVersion).toBe(1)
    expect(env.ok).toBe(false)
    expect('error' in env).toBe(true)
    expect('recovery' in env).toBe(true)
    // D-52: stdout does NOT carry wrapper fields
    expect('id' in env).toBe(false)
    expect('audit_ref' in env).toBe(false)
  })
})

function minimalEnvelope(): RecoveryEnvelope {
  return {
    schemaVersion: 1,
    generatedAt: '2026-05-15T10:00:00Z',
    ok: false,
    error: { code: 'UNKNOWN', category: 'unknown', message: 'test' },
    recovery: [],
  }
}

describe('writeLastEnvelope id + audit_ref (Phase 25 K1)', () => {
  let workDir: string

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'dbcli-test-25-04b-'))
  })

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true })
  })

  test('defaults id to UUID v4 when id arg is omitted', async () => {
    await writeLastEnvelope(workDir, minimalEnvelope(), ['dbcli', 'query', 'select 1'])
    const raw = await readFile(join(workDir, '.dbcli/last-recovery.json'), 'utf8')
    const parsed = JSON.parse(raw) as { id?: string; audit_ref?: string }
    expect(parsed.id).toMatch(/^[0-9a-f-]{36}$/)
    expect('audit_ref' in parsed).toBe(false)
  })

  test('persists explicit id and audit_ref', async () => {
    await writeLastEnvelope(
      workDir,
      minimalEnvelope(),
      ['dbcli', 'query', 'select 1'],
      () => new Date('2026-05-15T10:00:00Z'),
      'fixed-id-X',
      'fixed-audit-A'
    )
    const raw = await readFile(join(workDir, '.dbcli/last-recovery.json'), 'utf8')
    const parsed = JSON.parse(raw) as { id?: string; audit_ref?: string }
    expect(parsed.id).toBe('fixed-id-X')
    expect(parsed.audit_ref).toBe('fixed-audit-A')
  })

  test('omits audit_ref when 6th arg is undefined', async () => {
    await writeLastEnvelope(
      workDir,
      minimalEnvelope(),
      ['dbcli', 'query', 'select 1'],
      () => new Date('2026-05-15T10:00:00Z'),
      'fixed-id-X',
      undefined
    )
    const raw = await readFile(join(workDir, '.dbcli/last-recovery.json'), 'utf8')
    const parsed = JSON.parse(raw) as Record<string, unknown>
    expect(parsed.id).toBe('fixed-id-X')
    expect('audit_ref' in parsed).toBe(false)
  })
})
