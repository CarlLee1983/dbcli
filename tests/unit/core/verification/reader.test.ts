import { describe, expect, test, beforeEach } from 'bun:test'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  readVerificationArtifacts,
  VERIFICATION_DIR_RELATIVE,
} from '@/core/verification'
import type { VerificationArtifact } from '@/core/verification'

function artifact(overrides: Partial<VerificationArtifact> = {}): VerificationArtifact {
  return {
    schemaVersion: 1,
    id: 'ver_aaaa',
    createdAt: '2026-06-19T01:02:03.000Z',
    status: 'verified',
    subject: { kind: 'backfill', name: 'safe-backfill-verify' },
    summary: 'Assertion verified the expected state.',
    evidence: [{ kind: 'assert', exitCode: 0 }],
    ...overrides,
  }
}

async function seed(
  files: Array<{ name: string; content: string }>
): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dbcli-vreader-'))
  const dir = join(root, VERIFICATION_DIR_RELATIVE)
  await mkdir(dir, { recursive: true })
  for (const f of files) await writeFile(join(dir, f.name), f.content, 'utf8')
  return root
}

describe('readVerificationArtifacts', () => {
  test('missing directory yields empty result without throwing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dbcli-vreader-empty-'))
    const result = await readVerificationArtifacts(root)
    expect(result.storageDir).toBe(join(root, VERIFICATION_DIR_RELATIVE))
    expect(result.artifacts).toEqual([])
    expect(result.invalid).toEqual([])
  })

  test('reads only verification-*.json and sorts latest-first', async () => {
    const root = await seed([
      {
        name: 'verification-20260619-010203-aaaa.json',
        content: JSON.stringify(artifact({ id: 'ver_aaaa', createdAt: '2026-06-19T01:02:03.000Z' })),
      },
      {
        name: 'verification-20260619-020304-bbbb.json',
        content: JSON.stringify(artifact({ id: 'ver_bbbb', createdAt: '2026-06-19T02:03:04.000Z' })),
      },
      { name: 'not-a-verification.json', content: '{}' },
      { name: 'verification-readme.txt', content: 'ignore me' },
    ])
    const result = await readVerificationArtifacts(root)
    expect(result.artifacts.map((r) => r.artifact.id)).toEqual(['ver_bbbb', 'ver_aaaa'])
    expect(result.artifacts[0]!.filename).toBe('verification-20260619-020304-bbbb.json')
    expect(result.invalid).toEqual([])
  })

  test('ties on createdAt break by filename ascending', async () => {
    const root = await seed([
      {
        name: 'verification-20260619-010203-bbbb.json',
        content: JSON.stringify(artifact({ id: 'ver_b', createdAt: '2026-06-19T01:02:03.000Z' })),
      },
      {
        name: 'verification-20260619-010203-aaaa.json',
        content: JSON.stringify(artifact({ id: 'ver_a', createdAt: '2026-06-19T01:02:03.000Z' })),
      },
    ])
    const result = await readVerificationArtifacts(root)
    expect(result.artifacts.map((r) => r.filename)).toEqual([
      'verification-20260619-010203-aaaa.json',
      'verification-20260619-010203-bbbb.json',
    ])
  })

  test('malformed and schema-invalid files become bounded invalid records', async () => {
    const root = await seed([
      { name: 'verification-bad-json.json', content: '{ not json' },
      {
        name: 'verification-bad-schema.json',
        content: JSON.stringify(artifact({ schemaVersion: 2 as never })),
      },
      {
        name: 'verification-bad-status.json',
        content: JSON.stringify(artifact({ status: 'nope' as never })),
      },
      {
        name: 'verification-good.json',
        content: JSON.stringify(artifact({ id: 'ver_ok' })),
      },
    ])
    const result = await readVerificationArtifacts(root)
    expect(result.artifacts.map((r) => r.artifact.id)).toEqual(['ver_ok'])
    expect(result.invalid).toHaveLength(3)
    for (const inv of result.invalid) {
      expect(inv.error.length).toBeGreaterThan(0)
      expect(inv.error).not.toContain('\n')
      expect(inv.error.length).toBeLessThanOrEqual(200)
    }
  })
})
