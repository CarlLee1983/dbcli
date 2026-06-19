import { describe, expect, test } from 'bun:test'
import { parseOlderThanDays, computeCutoffMs, selectPrunePlan } from '@/core/verification'
import type {
  ReadVerificationArtifactsResult,
  VerificationArtifactRecord,
  PruneCriteria,
} from '@/core/verification'

describe('parseOlderThanDays', () => {
  test('accepts positive whole-day durations', () => {
    expect(parseOlderThanDays('1d')).toBe(1)
    expect(parseOlderThanDays('7d')).toBe(7)
    expect(parseOlderThanDays('30d')).toBe(30)
    expect(parseOlderThanDays('365d')).toBe(365)
  })

  test('rejects non-day, zero, fractional, and bare values', () => {
    for (const bad of ['0d', '1h', '1.5d', '30', 'forever', '', '-5d', 'd', '10D']) {
      expect(() => parseOlderThanDays(bad)).toThrow()
    }
  })
})

describe('computeCutoffMs', () => {
  test('subtracts whole days in milliseconds', () => {
    const now = Date.parse('2026-06-19T00:00:00.000Z')
    const cutoff = computeCutoffMs(now, 30)
    expect(new Date(cutoff).toISOString()).toBe('2026-05-20T00:00:00.000Z')
  })
})

function rec(
  id: string,
  createdAt: string,
  over: { status?: string; subject?: { kind: string; name?: string } } = {}
): VerificationArtifactRecord {
  return {
    path: `/repo/.dbcli/verification/verification-${id}.json`,
    filename: `verification-${id}.json`,
    artifact: {
      schemaVersion: 1,
      id,
      createdAt,
      status: (over.status as VerificationArtifactRecord['artifact']['status']) ?? 'verified',
      subject: (over.subject as VerificationArtifactRecord['artifact']['subject']) ?? {
        kind: 'backfill',
        name: 'safe-backfill-verify',
      },
      summary: 'ok',
      evidence: [{ kind: 'assert', exitCode: 0 }],
    },
  }
}

/** Latest-first, like the reader guarantees. */
function read(
  artifacts: VerificationArtifactRecord[],
  invalid: ReadVerificationArtifactsResult['invalid'] = []
): ReadVerificationArtifactsResult {
  return { storageDir: '/repo/.dbcli/verification', artifacts, invalid }
}

const baseCriteria: PruneCriteria = { olderThanDays: 30, keepLatest: 0, includeInvalid: false }
const cutoff = Date.parse('2026-05-20T00:00:00.000Z')

describe('selectPrunePlan', () => {
  test('keep-latest protects the newest N; older remainder are candidates', () => {
    const plan = selectPrunePlan(
      read([
        rec('new', '2026-06-19T00:00:00.000Z'),
        rec('mid', '2026-01-02T00:00:00.000Z'),
        rec('old', '2026-01-01T00:00:00.000Z'),
      ]),
      { ...baseCriteria, keepLatest: 1 },
      cutoff,
      new Map()
    )
    expect(plan.protected.map((p) => p.id)).toEqual(['new'])
    expect(plan.protected[0]!.reason).toBe('keep-latest')
    expect(plan.candidates.map((c) => c.id)).toEqual(['mid', 'old'])
    expect(plan.candidates.every((c) => c.invalid === false)).toBe(true)
  })

  test('keep-latest 0 protects nothing; only artifacts older than cutoff are candidates', () => {
    const plan = selectPrunePlan(
      read([
        rec('new', '2026-06-19T00:00:00.000Z'),
        rec('old', '2026-01-01T00:00:00.000Z'),
      ]),
      baseCriteria,
      cutoff,
      new Map()
    )
    expect(plan.protected).toEqual([])
    expect(plan.candidates.map((c) => c.id)).toEqual(['old'])
  })

  test('status filter applies only to candidates', () => {
    const plan = selectPrunePlan(
      read([
        rec('a', '2026-01-02T00:00:00.000Z', { status: 'verified' }),
        rec('b', '2026-01-01T00:00:00.000Z', { status: 'not_verified' }),
      ]),
      { ...baseCriteria, status: 'verified' },
      cutoff,
      new Map()
    )
    expect(plan.candidates.map((c) => c.id)).toEqual(['a'])
  })

  test('subject filter matches kind and optional name', () => {
    const plan = selectPrunePlan(
      read([
        rec('a', '2026-01-02T00:00:00.000Z', { subject: { kind: 'backfill', name: 'one' } }),
        rec('b', '2026-01-01T00:00:00.000Z', { subject: { kind: 'migration', name: 'two' } }),
      ]),
      { ...baseCriteria, subject: { kind: 'migration' } },
      cutoff,
      new Map()
    )
    expect(plan.candidates.map((c) => c.id)).toEqual(['b'])
  })

  test('invalid records are excluded by default and selected (by mtime) only with includeInvalid', () => {
    const invalid = [
      { path: '/repo/.dbcli/verification/verification-broken.json', filename: 'verification-broken.json', error: 'bad json' },
    ]
    const mtimes = new Map<string, number>([
      ['/repo/.dbcli/verification/verification-broken.json', Date.parse('2026-01-01T00:00:00.000Z')],
    ])

    const off = selectPrunePlan(read([], invalid), baseCriteria, cutoff, mtimes)
    expect(off.candidates).toEqual([])

    const on = selectPrunePlan(read([], invalid), { ...baseCriteria, includeInvalid: true }, cutoff, mtimes)
    expect(on.candidates).toHaveLength(1)
    expect(on.candidates[0]!.invalid).toBe(true)
    expect(on.candidates[0]!.id).toBeNull()
    expect(on.candidates[0]!.filename).toBe('verification-broken.json')
  })

  test('includeInvalid keeps recent invalid files (mtime newer than cutoff) untouched', () => {
    const invalid = [
      { path: '/repo/.dbcli/verification/verification-recent.json', filename: 'verification-recent.json', error: 'bad json' },
    ]
    const mtimes = new Map<string, number>([
      ['/repo/.dbcli/verification/verification-recent.json', Date.parse('2026-06-18T00:00:00.000Z')],
    ])
    const plan = selectPrunePlan(read([], invalid), { ...baseCriteria, includeInvalid: true }, cutoff, mtimes)
    expect(plan.candidates).toEqual([])
  })

  test('invalid records with no mtime entry are excluded even with includeInvalid', () => {
    const invalid = [
      { path: '/repo/.dbcli/verification/verification-nomtime.json', filename: 'verification-nomtime.json', error: 'bad json' },
    ]
    const plan = selectPrunePlan(read([], invalid), { ...baseCriteria, includeInvalid: true }, cutoff, new Map())
    expect(plan.candidates).toEqual([])
  })

  test('keep-latest protects the newest artifact globally before status filter applies', () => {
    // Newest is not_verified; a status-scoped prune still protects it via keep-latest.
    const readResult: ReadVerificationArtifactsResult = {
      storageDir: '/repo/.dbcli/verification',
      artifacts: [
        rec('newest', '2026-06-19T05:00:00.000Z', { status: 'not_verified' }),
        rec('mid', '2026-06-18T05:00:00.000Z', { status: 'verified' }),
        rec('old', '2026-06-17T05:00:00.000Z', { status: 'verified' }),
      ],
      invalid: [],
    }
    const criteria: PruneCriteria = {
      olderThanDays: 1,
      keepLatest: 1,
      status: 'verified',
      includeInvalid: false,
    }
    // Cutoff far in the future so every artifact is age-eligible; only protection differs.
    const cutoffMs = Date.parse('2999-01-01T00:00:00.000Z')

    const plan = selectPrunePlan(readResult, criteria, cutoffMs, new Map())

    // keep-latest 1 protects the newest globally, even though it fails the status filter.
    expect(plan.protected.map((p) => p.id)).toEqual(['newest'])
    // The status filter then applies to the unprotected remainder.
    expect(plan.candidates.map((c) => c.id)).toEqual(['mid', 'old'])
    // The globally protected newest is never selected for deletion.
    expect(plan.candidates.some((c) => c.id === 'newest')).toBe(false)
  })
})

import { mkdtemp, mkdir, writeFile, utimes, symlink, stat, lstat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  pruneVerificationArtifacts,
  isInsideStorageDir,
  hasArtifactFilename,
  VERIFICATION_DIR_RELATIVE,
} from '@/core/verification'

const NOW = Date.parse('2026-06-19T00:00:00.000Z')
const OLD = '2026-01-01T00:00:00.000Z' // ~170d before NOW
const RECENT = '2026-06-18T00:00:00.000Z' // 1d before NOW

async function seedRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dbcli-prune-'))
  await mkdir(join(root, VERIFICATION_DIR_RELATIVE), { recursive: true })
  return root
}

async function writeArtifact(root: string, id: string, createdAt: string, over: object = {}): Promise<string> {
  const file = join(root, VERIFICATION_DIR_RELATIVE, `verification-${id}.json`)
  const artifact = {
    schemaVersion: 1,
    id,
    createdAt,
    status: 'verified',
    subject: { kind: 'backfill', name: 'safe-backfill-verify' },
    summary: 'ok',
    evidence: [{ kind: 'assert', exitCode: 0 }],
    ...over,
  }
  await writeFile(file, JSON.stringify(artifact), 'utf8')
  return file
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

describe('isInsideStorageDir / hasArtifactFilename', () => {
  test('rejects traversal and non-artifact filenames', () => {
    const dir = '/repo/.dbcli/verification'
    expect(isInsideStorageDir(dir, '/repo/.dbcli/verification/verification-a.json')).toBe(true)
    expect(isInsideStorageDir(dir, '/repo/.dbcli/verification/../../etc/passwd')).toBe(false)
    expect(isInsideStorageDir(dir, '/repo/.dbcli/other/verification-a.json')).toBe(false)
    expect(hasArtifactFilename('/repo/.dbcli/verification/verification-a.json')).toBe(true)
    expect(hasArtifactFilename('/repo/.dbcli/verification/notes.json')).toBe(false)
    expect(hasArtifactFilename('/repo/.dbcli/verification/verification-a.txt')).toBe(false)
  })
})

describe('pruneVerificationArtifacts', () => {
  test('missing directory yields an empty result, exit-safe', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dbcli-prune-empty-'))
    const result = await pruneVerificationArtifacts(
      root,
      { olderThanDays: 30, keepLatest: 20, includeInvalid: false },
      { execute: false, nowMs: NOW }
    )
    expect(result.dryRun).toBe(true)
    expect(result.candidates).toEqual([])
    expect(result.protected).toEqual([])
    expect(result.deleted).toEqual([])
    expect(result.skipped).toEqual([])
    expect(result.cutoff).toBe('2026-05-20T00:00:00.000Z')
    expect(result.storageDir).toContain('.dbcli/verification')
  })

  test('dry-run reports candidates and deletes nothing', async () => {
    const root = await seedRoot()
    const oldFile = await writeArtifact(root, 'old', OLD)
    const newFile = await writeArtifact(root, 'new', RECENT)
    const result = await pruneVerificationArtifacts(
      root,
      { olderThanDays: 30, keepLatest: 0, includeInvalid: false },
      { execute: false, nowMs: NOW }
    )
    expect(result.dryRun).toBe(true)
    expect(result.candidates.map((c) => c.id)).toEqual(['old'])
    expect(result.deleted).toEqual([])
    expect(await exists(oldFile)).toBe(true)
    expect(await exists(newFile)).toBe(true)
  })

  test('execute deletes only selected candidates', async () => {
    const root = await seedRoot()
    const oldFile = await writeArtifact(root, 'old', OLD)
    const newFile = await writeArtifact(root, 'new', RECENT)
    const result = await pruneVerificationArtifacts(
      root,
      { olderThanDays: 30, keepLatest: 0, includeInvalid: false },
      { execute: true, nowMs: NOW }
    )
    expect(result.dryRun).toBe(false)
    expect(result.candidates).toEqual([])
    expect(result.deleted.map((d) => d.id)).toEqual(['old'])
    expect(result.skipped).toEqual([])
    expect(await exists(oldFile)).toBe(false)
    expect(await exists(newFile)).toBe(true)
  })

  test('keep-latest protects the newest valid artifacts even in execute mode', async () => {
    const root = await seedRoot()
    const f1 = await writeArtifact(root, 'old1', '2026-01-01T00:00:00.000Z')
    const f2 = await writeArtifact(root, 'old2', '2026-01-02T00:00:00.000Z')
    await writeArtifact(root, 'old3', '2026-01-03T00:00:00.000Z')
    const result = await pruneVerificationArtifacts(
      root,
      { olderThanDays: 30, keepLatest: 2, includeInvalid: false },
      { execute: true, nowMs: NOW }
    )
    expect(result.protected.map((p) => p.id).sort()).toEqual(['old2', 'old3'])
    expect(result.deleted.map((d) => d.id)).toEqual(['old1'])
    expect(await exists(f1)).toBe(false)
    expect(await exists(f2)).toBe(true)
  })

  test('include-invalid selects old malformed files by mtime', async () => {
    const root = await seedRoot()
    await writeArtifact(root, 'valid', OLD)
    const broken = join(root, VERIFICATION_DIR_RELATIVE, 'verification-broken.json')
    await writeFile(broken, '{ not json', 'utf8')
    const oldSeconds = OLD // utimes accepts a Date
    await utimes(broken, new Date(oldSeconds), new Date(oldSeconds))

    const off = await pruneVerificationArtifacts(
      root,
      { olderThanDays: 30, keepLatest: 0, includeInvalid: false },
      { execute: false, nowMs: NOW }
    )
    expect(off.candidates.some((c) => c.invalid)).toBe(false)

    const on = await pruneVerificationArtifacts(
      root,
      { olderThanDays: 30, keepLatest: 0, includeInvalid: true },
      { execute: false, nowMs: NOW }
    )
    expect(on.candidates.some((c) => c.invalid && c.filename === 'verification-broken.json')).toBe(true)
  })

  test('symlinks inside the storage dir are skipped, not deleted', async () => {
    const root = await seedRoot()
    const real = await writeArtifact(root, 'old', OLD)
    const link = join(root, VERIFICATION_DIR_RELATIVE, 'verification-link.json')
    await symlink(real, link)
    const result = await pruneVerificationArtifacts(
      root,
      { olderThanDays: 30, keepLatest: 0, includeInvalid: false },
      { execute: true, nowMs: NOW }
    )
    // Both the real file and the symlink read as valid (readFile follows links).
    expect(result.deleted.map((d) => d.filename)).toContain('verification-old.json')
    const skippedLink = result.skipped.find((s) => s.filename === 'verification-link.json')
    expect(skippedLink?.reason).toBe('not-regular-file')
    expect((await lstat(link)).isSymbolicLink()).toBe(true) // entry still present (now dangling)
  })
})
