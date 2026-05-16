/**
 * Phase 25 DOCS-02 / Plan 03 — unit tests for shouldEmbedRecent + loadRecentAudit.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { loadRecentAudit, shouldEmbedRecent, RECENT_AUDIT_DEFAULT_N } from '@/core/audit/recent'
import type { DbcliConfig } from '@/utils/validation'
import type { AuditEntry } from '@/core/audit/types'

function makeConfig(enabled: boolean): DbcliConfig {
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
    schema: {},
    metadata: { version: '1.0' },
    blacklist: { tables: [], columns: {} },
    audit: { enabled, rotation: { max_bytes: 10_485_760, max_entries: 1000 } },
  } as DbcliConfig
}

function makeEntry(i: number, ts: string): AuditEntry {
  return {
    id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    ts,
    session_id: 'sess-abc',
    engine: 'postgresql',
    command: 'query',
    side_effect_tier: 'readonly',
    target: 'users',
    success: true,
    redacted_query: 'dbcli query <sql>',
  }
}

describe('shouldEmbedRecent (Phase 25 D-57)', () => {
  test('returns true when forAgent is true (markdown format)', () => {
    expect(shouldEmbedRecent({ forAgent: true, format: 'markdown' })).toBe(true)
  })

  test('returns true when format is json (forAgent false)', () => {
    expect(shouldEmbedRecent({ forAgent: false, format: 'json' })).toBe(true)
  })

  test('returns false for human markdown without forAgent', () => {
    expect(shouldEmbedRecent({ forAgent: false, format: 'markdown' })).toBe(false)
  })

  test('returns false when forAgent is undefined and format is markdown', () => {
    expect(shouldEmbedRecent({ format: 'markdown' })).toBe(false)
  })
})

describe('RECENT_AUDIT_DEFAULT_N (Phase 25 D-58)', () => {
  test('is exactly 5 (hard-coded; no --audit-n flag)', () => {
    expect(RECENT_AUDIT_DEFAULT_N).toBe(5)
  })
})

describe('loadRecentAudit (Phase 25 D-58 / D-60)', () => {
  let workDir: string
  let configPath: string

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'dbcli-test-25-03-'))
    configPath = workDir
    await mkdir(join(workDir, '.dbcli'), { recursive: true })
  })

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true })
  })

  test('returns [] when audit.enabled === false (D-60)', async () => {
    const config = makeConfig(false)
    const r = await loadRecentAudit(config, configPath)
    expect(r).toEqual([])
  })

  test('returns [] when audit dir does not exist (ENOENT fall-through)', async () => {
    const config = makeConfig(true)
    const r = await loadRecentAudit(config, configPath)
    expect(r).toEqual([])
  })

  test('returns all entries (ASCending) when count <= N', async () => {
    const config = makeConfig(true)
    const auditDir = join(workDir, '.dbcli', 'audit')
    await mkdir(auditDir, { recursive: true })
    const auditFile = join(auditDir, 'default.jsonl')
    const lines =
      [
        JSON.stringify(makeEntry(1, '2026-05-15T10:00:00Z')),
        JSON.stringify(makeEntry(2, '2026-05-15T10:01:00Z')),
        JSON.stringify(makeEntry(3, '2026-05-15T10:02:00Z')),
      ].join('\n') + '\n'
    await writeFile(auditFile, lines, 'utf8')

    const r = await loadRecentAudit(config, configPath)
    expect(r).toHaveLength(3)
    expect(r[0]!.ts).toBe('2026-05-15T10:00:00Z')
    expect(r[2]!.ts).toBe('2026-05-15T10:02:00Z')
  })

  test('caps at default N=5 when more entries exist', async () => {
    const config = makeConfig(true)
    const auditDir = join(workDir, '.dbcli', 'audit')
    await mkdir(auditDir, { recursive: true })
    const auditFile = join(auditDir, 'default.jsonl')
    const lines =
      Array.from({ length: 10 }, (_, i) =>
        JSON.stringify(makeEntry(i + 1, `2026-05-15T10:0${i}:00Z`))
      ).join('\n') + '\n'
    await writeFile(auditFile, lines, 'utf8')

    const r = await loadRecentAudit(config, configPath)
    expect(r).toHaveLength(5)
    expect(r[0]!.ts).toBe('2026-05-15T10:05:00Z')
    expect(r[4]!.ts).toBe('2026-05-15T10:09:00Z')
  })

  test('returned items have EXACTLY 5 keys; D-59 forbidden keys absent', async () => {
    const config = makeConfig(true)
    const auditDir = join(workDir, '.dbcli', 'audit')
    await mkdir(auditDir, { recursive: true })
    const auditFile = join(auditDir, 'default.jsonl')
    await writeFile(auditFile, JSON.stringify(makeEntry(1, '2026-05-15T10:00:00Z')) + '\n', 'utf8')

    const r = await loadRecentAudit(config, configPath)
    expect(r).toHaveLength(1)
    const keys = Object.keys(r[0]!).sort()
    expect(keys).toEqual(['command', 'id', 'success', 'target', 'ts'])
    expect('redacted_query' in r[0]!).toBe(false)
    expect('redacted_sql' in r[0]!).toBe(false)
    expect('metadata' in r[0]!).toBe(false)
    expect('session_id' in r[0]!).toBe(false)
    expect('engine' in r[0]!).toBe(false)
    expect('side_effect_tier' in r[0]!).toBe(false)
  })

  test('reads rotated segment too (include_rotated: true)', async () => {
    const config = makeConfig(true)
    const auditDir = join(workDir, '.dbcli', 'audit')
    await mkdir(auditDir, { recursive: true })
    const currentFile = join(auditDir, 'default.jsonl')
    const rotatedFile = join(auditDir, 'default.jsonl.1')
    await writeFile(
      rotatedFile,
      [
        JSON.stringify(makeEntry(1, '2026-05-15T09:00:00Z')),
        JSON.stringify(makeEntry(2, '2026-05-15T09:01:00Z')),
      ].join('\n') + '\n',
      'utf8'
    )
    await writeFile(
      currentFile,
      JSON.stringify(makeEntry(3, '2026-05-15T10:00:00Z')) + '\n',
      'utf8'
    )

    const r = await loadRecentAudit(config, configPath)
    expect(r).toHaveLength(3)
    expect(r.map((e) => e.ts)).toEqual([
      '2026-05-15T09:00:00Z',
      '2026-05-15T09:01:00Z',
      '2026-05-15T10:00:00Z',
    ])
  })

  test('never throws on corrupted file — returns [] instead', async () => {
    const config = makeConfig(true)
    const auditDir = join(workDir, '.dbcli', 'audit')
    await mkdir(auditDir, { recursive: true })
    const auditFile = join(auditDir, 'default.jsonl')
    await writeFile(
      auditFile,
      [
        JSON.stringify(makeEntry(1, '2026-05-15T10:00:00Z')),
        'this-is-not-json',
        JSON.stringify(makeEntry(3, '2026-05-15T10:02:00Z')),
      ].join('\n') + '\n',
      'utf8'
    )
    const r = await loadRecentAudit(config, configPath)
    expect(r).toEqual([])
  })
})
