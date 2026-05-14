/**
 * Phase 21 / Plan 21-05 — AuditLogger integration tests for STORE-04 / D6.
 *
 * The engine/CLI call chain is not wired until later phases, so these tests
 * exercise fail-soft behavior through the public AuditLogger.write API and a
 * simulated main-command function.
 */
import { afterEach, beforeEach, describe, expect, spyOn, test, type Mock } from 'bun:test'
import { chmod, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { AuditLogger } from '../../../src/core/audit/logger'
import { SessionIdService } from '../../../src/core/audit/session-id'

let workDir: string
let auditDir: string
let originalEnv: string | undefined
let stderrSpy: Mock<typeof process.stderr.write> | null = null

function makeLogger(): AuditLogger {
  return new AuditLogger({
    storagePath: workDir,
    connectionName: 'default',
    enabled: true,
    rotation: { maxBytes: 10_000_000, maxEntries: 10_000 },
    sessionIdService: new SessionIdService(workDir),
  })
}

async function makeReadonlyAuditDir(): Promise<void> {
  await mkdir(auditDir, { recursive: true })
  await chmod(auditDir, 0o555)
}

function auditWarningCalls(): unknown[][] {
  if (!stderrSpy) return []
  return stderrSpy.mock.calls.filter((call) => typeof call[0] === 'string' && call[0].includes('[dbcli audit]'))
}

beforeEach(async () => {
  originalEnv = process.env.DBCLI_SESSION_ID
  process.env.DBCLI_SESSION_ID = 'readonly-test-session'
  workDir = await mkdtemp(join(tmpdir(), 'dbcli-audit-readonly-'))
  auditDir = join(workDir, '.dbcli', 'audit')
})

afterEach(async () => {
  if (stderrSpy) {
    stderrSpy.mockRestore()
    stderrSpy = null
  }
  try {
    await chmod(auditDir, 0o755)
  } catch {
    /* ignore — dir may not exist */
  }
  try {
    await chmod(join(workDir, '.dbcli'), 0o755)
  } catch {
    /* ignore — dir may not exist */
  }
  if (originalEnv === undefined) {
    delete process.env.DBCLI_SESSION_ID
  } else {
    process.env.DBCLI_SESSION_ID = originalEnv
  }
  await rm(workDir, { recursive: true, force: true })
})

describe('AuditLogger readonly-dir integration (STORE-04 / D6)', () => {
  test('STORE-04 / criterion 4: write() on readonly audit dir returns skip marker, does NOT throw, emits ONE stderr warning over many failures', async () => {
    await makeReadonlyAuditDir()
    stderrSpy = spyOn(process.stderr, 'write').mockImplementation(() => true)
    const logger = makeLogger()

    const first = await logger.write({ i: 1 })

    // A readonly audit dir commonly exhausts the lock budget because the
    // lockfile temp write cannot succeed; either skip marker is fail-soft.
    expect(first).toEqual(expect.objectContaining({ skipped: expect.any(String) }))
    for (let i = 2; i <= 6; i += 1) {
      const result = await logger.write({ i })
      expect(result).toEqual(expect.objectContaining({ skipped: expect.any(String) }))
    }

    expect(auditWarningCalls().length).toBe(1)
    const health = logger.getHealth()
    expect(health.lastError).not.toBeNull()
    expect(typeof health.lastError?.ts).toBe('string')
    expect(typeof health.lastError?.message).toBe('string')
    expect(health.lastWrite?.success).toBe(false)
  })

  test('STORE-04 / criterion 4: write failure does not affect the awaiting caller\'s downstream code', async () => {
    await makeReadonlyAuditDir()
    stderrSpy = spyOn(process.stderr, 'write').mockImplementation(() => true)
    const logger = makeLogger()

    async function simulatedMainCommand(auditLogger: AuditLogger) {
      const result = { rows: 3, command: 'query' }
      await auditLogger.write({ command: 'query', success: true, rowsAffected: 3 })
      return { result, exitCode: 0 }
    }

    const out = await simulatedMainCommand(logger)

    expect(out.result).toEqual({ rows: 3, command: 'query' })
    expect(out.exitCode).toBe(0)
  })

  test('after restoring writable permissions in a fresh logger, writes resume normally', async () => {
    await makeReadonlyAuditDir()
    stderrSpy = spyOn(process.stderr, 'write').mockImplementation(() => true)
    const logger1 = makeLogger()
    const failed = await logger1.write({ beforeRestore: true })
    expect(failed).toEqual(expect.objectContaining({ skipped: expect.any(String) }))

    await chmod(auditDir, 0o755)
    const logger2 = makeLogger()
    const result = await logger2.write({ recovered: true })

    expect(result).toEqual(expect.objectContaining({ success: true }))
    const raw = await readFile(join(auditDir, 'default.jsonl'), 'utf8')
    const lines = raw.split('\n').filter(Boolean)
    expect(lines.length).toBe(1)
    expect(JSON.parse(lines[0]!)).toEqual({ recovered: true, session_id: 'readonly-test-session' })
  })
})
