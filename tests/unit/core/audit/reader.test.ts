/**
 * Audit reader — unit tests (Phase 24 / Plan 24-01 Task 2)
 *
 * Covers:
 * - readEntries: missing file, valid lines, truncated last line tolerance,
 *   middle-line corruption hard-fail, include_rotated concat order
 * - discoverConnections: missing dir, jsonl + jsonl.1 grouping, .lock exclusion,
 *   per-connection file ordering (rotated first), connection-name sort
 * - tailEntries: ascending slice, n<=0, n exceeds length
 * - mergeByTimestamp: cross-connection merge, tie-break by connection name
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  spyOn,
  test,
  type Mock,
} from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  discoverConnections,
  mergeByTimestamp,
  readEntries,
  tailEntries,
} from '@/core/audit/reader'
import type { AuditEntry } from '@/core/audit/types'

let workDir: string
let auditDir: string
let auditFile: string
let stderrSpy: Mock<typeof process.stderr.write> | null = null

function makeEntry(
  overrides: Partial<AuditEntry> & { ts: string; id: string },
): AuditEntry {
  return {
    id: overrides.id,
    ts: overrides.ts,
    session_id: overrides.session_id ?? 'test-session',
    engine: overrides.engine ?? 'postgresql',
    command: overrides.command ?? 'query',
    side_effect_tier: overrides.side_effect_tier ?? 'readonly',
    target: overrides.target ?? 'users',
    success: overrides.success ?? true,
    redacted_query: overrides.redacted_query ?? 'dbcli query ?',
    ...overrides,
  }
}

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'dbcli-audit-reader-'))
  auditDir = join(workDir, '.dbcli', 'audit')
  await mkdir(auditDir, { recursive: true })
  auditFile = join(auditDir, 'default.jsonl')
})

afterEach(async () => {
  if (stderrSpy) {
    stderrSpy.mockRestore()
    stderrSpy = null
  }
  await rm(workDir, { recursive: true, force: true })
})

describe('readEntries', () => {
  test('returns [] when file does not exist', async () => {
    expect(await readEntries(auditFile)).toEqual([])
  })

  test('parses 3 valid JSONL lines into 3 entries (preserves order)', async () => {
    const entries = [
      makeEntry({ id: 'a', ts: '2026-05-15T10:00:00.000Z' }),
      makeEntry({ id: 'b', ts: '2026-05-15T10:01:00.000Z' }),
      makeEntry({ id: 'c', ts: '2026-05-15T10:02:00.000Z' }),
    ]
    await writeFile(auditFile, entries.map((e) => JSON.stringify(e)).join('\n') + '\n')
    const result = await readEntries(auditFile)
    expect(result).toHaveLength(3)
    expect(result.map((r) => r.id)).toEqual(['a', 'b', 'c'])
  })

  test('tolerates truncated last line and warns to stderr', async () => {
    stderrSpy = spyOn(process.stderr, 'write').mockImplementation(() => true)
    const valid1 = JSON.stringify(makeEntry({ id: 'v1', ts: '2026-05-15T10:00:00.000Z' }))
    const valid2 = JSON.stringify(makeEntry({ id: 'v2', ts: '2026-05-15T10:01:00.000Z' }))
    const truncated = '{"id":"trunc","ts":'
    await writeFile(auditFile, `${valid1}\n${valid2}\n${truncated}`)

    const result = await readEntries(auditFile)
    expect(result).toHaveLength(2)
    expect(result.map((r) => r.id)).toEqual(['v1', 'v2'])

    const wroteWarn = stderrSpy.mock.calls
      .flat()
      .some((s) => String(s).includes('skipping truncated last line'))
    expect(wroteWarn).toBe(true)
  })

  test('throws on middle-line corruption with dbcli audit clear hint', async () => {
    const valid1 = JSON.stringify(makeEntry({ id: 'v1', ts: '2026-05-15T10:00:00.000Z' }))
    const valid2 = JSON.stringify(makeEntry({ id: 'v2', ts: '2026-05-15T10:02:00.000Z' }))
    const broken = 'NOT JSON AT ALL'
    await writeFile(auditFile, `${valid1}\n${broken}\n${valid2}\n`)

    await expect(readEntries(auditFile)).rejects.toThrow(/corrupted line 2/)
    await expect(readEntries(auditFile)).rejects.toThrow(/dbcli audit clear/)
  })

  test('include_rotated=true concatenates .1 entries before current', async () => {
    const rotated = [
      makeEntry({ id: 'r1', ts: '2026-05-15T09:00:00.000Z' }),
      makeEntry({ id: 'r2', ts: '2026-05-15T09:01:00.000Z' }),
    ]
    const current = [
      makeEntry({ id: 'c1', ts: '2026-05-15T10:00:00.000Z' }),
      makeEntry({ id: 'c2', ts: '2026-05-15T10:01:00.000Z' }),
    ]
    await writeFile(`${auditFile}.1`, rotated.map((e) => JSON.stringify(e)).join('\n') + '\n')
    await writeFile(auditFile, current.map((e) => JSON.stringify(e)).join('\n') + '\n')

    const result = await readEntries(auditFile, { include_rotated: true })
    expect(result).toHaveLength(4)
    expect(result.map((r) => r.id)).toEqual(['r1', 'r2', 'c1', 'c2'])
  })

  test('include_rotated=true with no rotated file returns current only', async () => {
    const current = makeEntry({ id: 'c1', ts: '2026-05-15T10:00:00.000Z' })
    await writeFile(auditFile, JSON.stringify(current) + '\n')
    const result = await readEntries(auditFile, { include_rotated: true })
    expect(result).toHaveLength(1)
    expect(result[0]!.id).toBe('c1')
  })
})

describe('discoverConnections', () => {
  test('returns [] when audit dir does not exist', async () => {
    expect(await discoverConnections(join(workDir, 'no-such-dir'))).toEqual([])
  })

  test('groups jsonl + jsonl.1 by basename and excludes .lock', async () => {
    await writeFile(join(auditDir, 'prod.jsonl'), '')
    await writeFile(join(auditDir, 'prod.jsonl.1'), '')
    await writeFile(join(auditDir, 'staging.jsonl'), '')
    await writeFile(join(auditDir, 'prod.jsonl.lock'), '')

    const result = await discoverConnections(auditDir)
    expect(result).toHaveLength(2)
    expect(result.map((r) => r.connection)).toEqual(['prod', 'staging'])

    const prodGroup = result.find((r) => r.connection === 'prod')!
    expect(prodGroup.files).toHaveLength(2)
    expect(prodGroup.files.some((f) => f.endsWith('.lock'))).toBe(false)

    const stagingGroup = result.find((r) => r.connection === 'staging')!
    expect(stagingGroup.files).toHaveLength(1)
  })

  test('sorts files within connection: rotated first, current last', async () => {
    await writeFile(join(auditDir, 'prod.jsonl'), '')
    await writeFile(join(auditDir, 'prod.jsonl.1'), '')

    const result = await discoverConnections(auditDir)
    const prodGroup = result.find((r) => r.connection === 'prod')!
    expect(prodGroup.files[0]!.endsWith('.jsonl.1')).toBe(true)
    expect(prodGroup.files[1]!.endsWith('prod.jsonl')).toBe(true)
  })

  test('returns connections sorted by name ascending', async () => {
    await writeFile(join(auditDir, 'zeta.jsonl'), '')
    await writeFile(join(auditDir, 'alpha.jsonl'), '')
    await writeFile(join(auditDir, 'mid.jsonl'), '')

    const result = await discoverConnections(auditDir)
    expect(result.map((r) => r.connection)).toEqual(['alpha', 'mid', 'zeta'])
  })
})

describe('tailEntries', () => {
  const unsorted: AuditEntry[] = [
    makeEntry({ id: 'a', ts: '2026-05-15T10:00:00.000Z' }),
    makeEntry({ id: 'b', ts: '2026-05-15T08:00:00.000Z' }),
    makeEntry({ id: 'c', ts: '2026-05-15T09:00:00.000Z' }),
  ]

  test('returns last N sorted ascending (latest last)', () => {
    const result = tailEntries(unsorted, 2)
    expect(result.map((r) => r.id)).toEqual(['c', 'a'])
  })

  test('returns [] when n <= 0', () => {
    expect(tailEntries(unsorted, 0)).toEqual([])
    expect(tailEntries(unsorted, -1)).toEqual([])
  })

  test('returns all when n exceeds length, ascending', () => {
    const result = tailEntries(unsorted, 100)
    expect(result).toHaveLength(3)
    expect(result.map((r) => r.id)).toEqual(['b', 'c', 'a'])
  })
})

describe('mergeByTimestamp', () => {
  test('merges across connections sorted by ts ascending', () => {
    const byConn = new Map<string, AuditEntry[]>([
      [
        'prod',
        [
          makeEntry({ id: 'p1', ts: '2026-05-15T10:00:00.000Z' }),
          makeEntry({ id: 'p3', ts: '2026-05-15T10:02:00.000Z' }),
        ],
      ],
      ['staging', [makeEntry({ id: 's2', ts: '2026-05-15T10:01:00.000Z' })]],
    ])
    const result = mergeByTimestamp(byConn)
    expect(result.map((x) => `${x.connection}/${x.entry.id}`)).toEqual([
      'prod/p1',
      'staging/s2',
      'prod/p3',
    ])
  })

  test('breaks ties by connection name lexicographic ascending', () => {
    const sameTs = '2026-05-15T10:00:00.000Z'
    const byConn = new Map<string, AuditEntry[]>([
      ['staging', [makeEntry({ id: 's1', ts: sameTs })]],
      ['prod', [makeEntry({ id: 'p1', ts: sameTs })]],
    ])
    const result = mergeByTimestamp(byConn)
    expect(result.map((x) => x.connection)).toEqual(['prod', 'staging'])
  })

  test('returns envelope shape { connection, entry }', () => {
    const byConn = new Map<string, AuditEntry[]>([
      ['prod', [makeEntry({ id: 'p1', ts: '2026-05-15T10:00:00.000Z' })]],
    ])
    const result = mergeByTimestamp(byConn)
    expect(result[0]).toHaveProperty('connection')
    expect(result[0]).toHaveProperty('entry')
    expect(result[0]!.entry.id).toBe('p1')
  })
})
