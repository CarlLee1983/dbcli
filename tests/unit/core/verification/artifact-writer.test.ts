import { describe, expect, test, beforeEach } from 'bun:test'
import { mkdtemp, readFile, readdir, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  writeVerificationArtifact,
  verificationArtifactFilename,
  VERIFICATION_DIR_RELATIVE,
  buildVerificationArtifact,
} from '@/core/verification'
import type { VerificationArtifact } from '@/core/verification'

function fixture(overrides: Partial<VerificationArtifact> = {}): VerificationArtifact {
  return buildVerificationArtifact({
    status: 'verified',
    subject: { kind: 'backfill', name: 'safe-backfill-verify' },
    summary: 'Read-back assertion passed.',
    evidence: [{ kind: 'assert', command: 'dbcli assert "..." --expect "rows == 0"' }],
    now: () => new Date('2026-06-18T13:45:09.000Z'),
    idFactory: () => 'ver_fixed_abcd1234',
    ...overrides,
  })
}

describe('writeVerificationArtifact', () => {
  let storage = ''
  beforeEach(async () => {
    storage = await mkdtemp(join(tmpdir(), 'dbcli-verif-'))
  })

  test('writes under .dbcli/verification and creates the directory if missing', async () => {
    const path = await writeVerificationArtifact(storage, fixture())
    expect(path).toContain(join(VERIFICATION_DIR_RELATIVE))
    const dir = join(storage, VERIFICATION_DIR_RELATIVE)
    const entries = await readdir(dir)
    expect(entries.length).toBe(1)
  })

  test('uses the expected filename pattern', async () => {
    const name = verificationArtifactFilename(fixture())
    expect(name).toMatch(/^verification-\d{8}-\d{6}-[a-z0-9]+\.json$/)
    expect(name).toContain('20260618-134509')
  })

  test('writes valid JSON matching the artifact', async () => {
    const artifact = fixture()
    const path = await writeVerificationArtifact(storage, artifact)
    const parsed = JSON.parse(await readFile(path, 'utf8')) as VerificationArtifact
    expect(parsed).toEqual(artifact)
  })

  test('sanitizes ids so path traversal cannot escape the directory', async () => {
    const evil = fixture({ id: '../../etc/ver_pwned' } as Partial<VerificationArtifact>)
    const path = await writeVerificationArtifact(storage, evil)
    expect(path.startsWith(join(storage, VERIFICATION_DIR_RELATIVE))).toBe(true)
    expect(path).not.toContain('..')
  })

  test('does not silently overwrite an existing artifact', async () => {
    const artifact = fixture()
    const dir = join(storage, VERIFICATION_DIR_RELATIVE)
    await mkdir(dir, { recursive: true })
    const name = verificationArtifactFilename(artifact)
    await writeFile(join(dir, name), '{"pre":"existing"}')
    await expect(writeVerificationArtifact(storage, artifact)).rejects.toThrow(/already exists/)
    expect(await readFile(join(dir, name), 'utf8')).toBe('{"pre":"existing"}')
  })
})
