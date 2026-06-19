import { describe, expect, test } from 'bun:test'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  readVerificationArtifacts,
  VERIFICATION_DIR_RELATIVE,
  filterVerificationArtifacts,
  summarizeVerificationArtifacts,
  findVerificationArtifact,
  VerificationArtifactSelectionError,
} from '@/core/verification'
import type {
  VerificationArtifact,
  VerificationArtifactRecord,
  ReadVerificationArtifactsResult,
} from '@/core/verification'

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

async function seed(files: Array<{ name: string; content: string }>): Promise<string> {
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
        content: JSON.stringify(
          artifact({ id: 'ver_aaaa', createdAt: '2026-06-19T01:02:03.000Z' })
        ),
      },
      {
        name: 'verification-20260619-020304-bbbb.json',
        content: JSON.stringify(
          artifact({ id: 'ver_bbbb', createdAt: '2026-06-19T02:03:04.000Z' })
        ),
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

function record(
  id: string,
  createdAt: string,
  over: Partial<VerificationArtifact> = {}
): VerificationArtifactRecord {
  const filename = `verification-x-${id}.json`
  return {
    path: `/repo/.dbcli/verification/${filename}`,
    filename,
    artifact: artifact({ id, createdAt, ...over }),
  }
}

function readResult(records: VerificationArtifactRecord[]): ReadVerificationArtifactsResult {
  return { storageDir: '/repo/.dbcli/verification', artifacts: records, invalid: [] }
}

describe('filterVerificationArtifacts', () => {
  const recs = [
    record('a', '2026-06-19T03:00:00.000Z', {
      status: 'verified',
      subject: { kind: 'backfill', name: 'one' },
    }),
    record('b', '2026-06-19T02:00:00.000Z', {
      status: 'not_verified',
      subject: { kind: 'backfill', name: 'two' },
    }),
    record('c', '2026-06-19T01:00:00.000Z', {
      status: 'verified',
      subject: { kind: 'migration', name: 'three' },
    }),
  ]

  test('filters by status', () => {
    expect(
      filterVerificationArtifacts(recs, { status: 'verified' }).map((r) => r.artifact.id)
    ).toEqual(['a', 'c'])
  })

  test('filters by subject kind only', () => {
    expect(
      filterVerificationArtifacts(recs, { subject: { kind: 'backfill' } }).map((r) => r.artifact.id)
    ).toEqual(['a', 'b'])
  })

  test('filters by subject kind and name', () => {
    expect(
      filterVerificationArtifacts(recs, { subject: { kind: 'backfill', name: 'two' } }).map(
        (r) => r.artifact.id
      )
    ).toEqual(['b'])
  })
})

describe('summarizeVerificationArtifacts', () => {
  test('counts statuses, picks latest, groups subjects', () => {
    const recs = [
      record('a', '2026-06-19T03:00:00.000Z', {
        status: 'verified',
        subject: { kind: 'backfill', name: 'one' },
      }),
      record('b', '2026-06-19T02:00:00.000Z', {
        status: 'not_verified',
        subject: { kind: 'backfill', name: 'one' },
      }),
      record('c', '2026-06-19T01:00:00.000Z', {
        status: 'blocked',
        subject: { kind: 'migration', name: 'm' },
      }),
    ]
    const input: ReadVerificationArtifactsResult = {
      storageDir: '/repo/.dbcli/verification',
      artifacts: recs,
      invalid: [
        {
          path: '/repo/.dbcli/verification/verification-bad.json',
          filename: 'verification-bad.json',
          error: 'bad',
        },
      ],
    }
    const s = summarizeVerificationArtifacts(input)
    expect(s.storageDir).toBe('/repo/.dbcli/verification')
    expect(s.latest?.id).toBe('a')
    expect(s.counts).toEqual({
      total: 3,
      verified: 1,
      not_verified: 1,
      indeterminate: 0,
      blocked: 1,
      invalid: 1,
    })
    expect(s.subjects[0]).toEqual({
      subject: { kind: 'backfill', name: 'one' },
      total: 2,
      latestStatus: 'verified',
      latestCreatedAt: '2026-06-19T03:00:00.000Z',
    })
  })

  test('empty input yields null latest and zero counts', () => {
    const s = summarizeVerificationArtifacts(readResult([]))
    expect(s.latest).toBeNull()
    expect(s.counts).toEqual({
      total: 0,
      verified: 0,
      not_verified: 0,
      indeterminate: 0,
      blocked: 0,
      invalid: 0,
    })
    expect(s.subjects).toEqual([])
  })
})

describe('findVerificationArtifact', () => {
  const recs = [
    record('ver_abcd1234', '2026-06-19T03:00:00.000Z'),
    record('ver_abce9999', '2026-06-19T02:00:00.000Z'),
    record('ver_zzzz0000', '2026-06-19T01:00:00.000Z'),
  ]
  const input = readResult(recs)

  test('matches by exact id', () => {
    expect(findVerificationArtifact(input, 'ver_abcd1234').artifact.id).toBe('ver_abcd1234')
  })

  test('matches by unique id prefix', () => {
    expect(findVerificationArtifact(input, 'ver_abcd').artifact.id).toBe('ver_abcd1234')
  })

  test('ambiguous prefix throws selection error', () => {
    expect(() => findVerificationArtifact(input, 'ver_abc')).toThrow(
      VerificationArtifactSelectionError
    )
  })

  test('matches by filename', () => {
    expect(findVerificationArtifact(input, 'verification-x-ver_zzzz0000.json').artifact.id).toBe(
      'ver_zzzz0000'
    )
  })

  test('no match throws selection error', () => {
    expect(() => findVerificationArtifact(input, 'ver_nope')).toThrow(
      VerificationArtifactSelectionError
    )
  })

  test('explicit path inside storage dir matches', () => {
    expect(
      findVerificationArtifact(input, '/repo/.dbcli/verification/verification-x-ver_abcd1234.json')
        .artifact.id
    ).toBe('ver_abcd1234')
  })

  test('explicit path outside storage dir throws', () => {
    expect(() =>
      findVerificationArtifact(input, '/repo/.dbcli/verification/../../etc/passwd')
    ).toThrow(VerificationArtifactSelectionError)
  })
})
