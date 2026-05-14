/**
 * Phase 21 / Plan 21-05 — AuditLogger integration tests for STORE-03.
 *
 * These tests intentionally use two AuditLogger instances in one process. Phase
 * 21 has no CLI audit surface yet, so this is the planned integration-level
 * evidence that independent logger instances serialize through the shared
 * on-disk lockfile and produce parseable append-only JSONL.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { AuditLogger } from '../../../src/core/audit/logger'
import { SessionIdService } from '../../../src/core/audit/session-id'

let workDir: string
let originalEnv: string | undefined

function makeLogger(connectionName: string, sessionIdService: SessionIdService): AuditLogger {
  return new AuditLogger({
    storagePath: workDir,
    connectionName,
    enabled: true,
    rotation: { maxBytes: 10_000_000, maxEntries: 10_000 },
    sessionIdService,
  })
}

async function readJsonl(path: string): Promise<Array<Record<string, unknown>>> {
  const content = await readFile(path, 'utf8')
  const lines = content.split('\n').filter(Boolean)
  return lines.map((line) => JSON.parse(line) as Record<string, unknown>)
}

beforeEach(async () => {
  originalEnv = process.env.DBCLI_SESSION_ID
  process.env.DBCLI_SESSION_ID = 'concurrent-test-session'
  workDir = await mkdtemp(join(tmpdir(), 'dbcli-audit-conc-'))
})

afterEach(async () => {
  if (originalEnv === undefined) {
    delete process.env.DBCLI_SESSION_ID
  } else {
    process.env.DBCLI_SESSION_ID = originalEnv
  }
  await rm(workDir, { recursive: true, force: true })
})

describe('AuditLogger concurrent integration (STORE-03)', () => {
  test('STORE-03: two AuditLogger instances writing 50 entries each in parallel produce only valid JSONL lines', async () => {
    const sessionIdService = new SessionIdService(workDir)
    const loggerA = makeLogger('default', sessionIdService)
    const loggerB = makeLogger('default', sessionIdService)
    const entriesA = Array.from({ length: 50 }, (_, i) => ({ src: 'a', i }))
    const entriesB = Array.from({ length: 50 }, (_, i) => ({ src: 'b', i }))

    const results = await Promise.all([
      ...entriesA.map((entry) => loggerA.write(entry)),
      ...entriesB.map((entry) => loggerB.write(entry)),
    ])

    const successCount = results.filter((result) => 'success' in result && result.success === true).length
    const content = await readFile(join(workDir, '.dbcli', 'audit', 'default.jsonl'), 'utf8')
    const lines = content.split('\n').filter(Boolean)
    const parsed = lines.map((line) => JSON.parse(line) as Record<string, unknown>)

    expect(lines.length).toBe(successCount)
    expect(parsed.length).toBe(successCount)
    for (const row of parsed) {
      expect(row['session_id']).toBe('concurrent-test-session')
      expect(row['src'] === 'a' || row['src'] === 'b').toBe(true)
    }
    expect(successCount).toBeGreaterThanOrEqual(95)
  })

  test('STORE-03: different connections do not contend (D-06)', async () => {
    const sessionIdService = new SessionIdService(workDir)
    const loggerA = new AuditLogger({
      storagePath: workDir,
      connectionName: 'conn-a',
      enabled: true,
      rotation: { maxBytes: 10_000_000, maxEntries: 10_000 },
      sessionIdService,
    })
    const loggerB = new AuditLogger({
      storagePath: workDir,
      connectionName: 'conn-b',
      enabled: true,
      rotation: { maxBytes: 10_000_000, maxEntries: 10_000 },
      sessionIdService,
    })
    const entriesA = Array.from({ length: 50 }, (_, i) => ({ src: 'a', i }))
    const entriesB = Array.from({ length: 50 }, (_, i) => ({ src: 'b', i }))

    const results = await Promise.all([
      ...entriesA.map((entry) => loggerA.write(entry)),
      ...entriesB.map((entry) => loggerB.write(entry)),
    ])

    expect(results.every((result) => 'success' in result && result.success === true)).toBe(true)

    const connALines = await readJsonl(join(workDir, '.dbcli', 'audit', 'conn-a.jsonl'))
    const connBLines = await readJsonl(join(workDir, '.dbcli', 'audit', 'conn-b.jsonl'))

    expect(connALines.length).toBe(50)
    expect(connBLines.length).toBe(50)
    expect(connALines.every((row) => row['src'] === 'a')).toBe(true)
    expect(connBLines.every((row) => row['src'] === 'b')).toBe(true)
  })
})
