/**
 * AuditLogger — unit tests (Phase 21 / Plan 21-04 Task 2)
 *
 * Covers behavior Tests 1-13:
 * - Test 1: disabled short-circuit (no dir, no lockfile)
 * - Test 2: lazy mkdir on first write (D-12)
 * - Test 3: append O_APPEND single-line per call (STORE-01 / D-08)
 * - Test 4: rotation on max_bytes (STORE-02)
 * - Test 5: rotation on max_entries (STORE-02)
 * - Test 6: rotation overwrites existing .1 (D-10)
 * - Test 7: fail-soft on readonly dir (STORE-04 / D-16 first warning)
 * - Test 8: once-per-process warning cadence (D-16)
 * - Test 9: getHealth shape when disabled
 * - Test 10: getHealth shape after successful writes
 * - Test 11: AUDIT-02/03 wiring — session_id present on every entry
 * - Test 12: D-14 default.jsonl
 * - Test 13: lock-budget-exhausted fall-through
 */
import { afterEach, beforeEach, describe, expect, spyOn, test, type Mock } from 'bun:test'
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { AuditLogger } from '@/core/audit/logger'
import type { AuditLockManager, WithLockResult } from '@/core/audit/lock'
import { SessionIdService } from '@/core/audit/session-id'

let workDir: string
let auditDir: string
let auditFile: string
let originalEnv: string | undefined
let stderrSpy: Mock<typeof process.stderr.write> | null = null

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p)
    return true
  } catch {
    return false
  }
}

function makeLogger(opts: {
  enabled?: boolean
  maxBytes?: number
  maxEntries?: number
  connectionName?: string
  lockManager?: AuditLockManager
}): AuditLogger {
  return new AuditLogger({
    storagePath: workDir,
    connectionName: opts.connectionName ?? 'default',
    enabled: opts.enabled ?? true,
    rotation: {
      maxBytes: opts.maxBytes ?? 10_485_760,
      maxEntries: opts.maxEntries ?? 1000,
    },
    sessionIdService: new SessionIdService(workDir),
    ...(opts.lockManager !== undefined ? { lockManager: opts.lockManager } : {}),
  })
}

async function readLines(p: string): Promise<string[]> {
  const raw = await readFile(p, 'utf8')
  return raw.split('\n').filter(Boolean)
}

beforeEach(async () => {
  originalEnv = process.env.DBCLI_SESSION_ID
  delete process.env.DBCLI_SESSION_ID
  workDir = await mkdtemp(join(tmpdir(), 'dbcli-audit-logger-'))
  auditDir = join(workDir, '.dbcli', 'audit')
  auditFile = join(auditDir, 'default.jsonl')
})

afterEach(async () => {
  if (stderrSpy) {
    stderrSpy.mockRestore()
    stderrSpy = null
  }
  if (originalEnv === undefined) {
    delete process.env.DBCLI_SESSION_ID
  } else {
    process.env.DBCLI_SESSION_ID = originalEnv
  }
  // Restore writable permissions for cleanup if readonly was set.
  // Both `.dbcli` and `.dbcli/audit` may have been chmodded by individual tests.
  for (const p of [auditDir, join(workDir, '.dbcli')]) {
    try {
      await chmod(p, 0o755)
    } catch {
      /* ignore — dir may not exist */
    }
  }
  await rm(workDir, { recursive: true, force: true })
})

describe('Test 1: disabled short-circuit (CONFIG-02, success criterion 1)', () => {
  test('returns { skipped: "disabled" }; audit dir and lockfile NOT created', async () => {
    const logger = makeLogger({ enabled: false })
    const result = await logger.write({ test: 1 })

    expect(result).toEqual({ skipped: 'disabled' })
    expect(await pathExists(auditDir)).toBe(false)
    expect(await pathExists(auditFile)).toBe(false)
    expect(await pathExists(`${auditFile}.lock`)).toBe(false)
  })
})

describe('Test 2: lazy mkdir on first write (D-12)', () => {
  test('directory does not exist after construction; appears after first write', async () => {
    const logger = makeLogger({})
    expect(await pathExists(auditDir)).toBe(false)

    const result = await logger.write({ test: 1 })

    expect(await pathExists(auditDir)).toBe(true)
    expect(await pathExists(auditFile)).toBe(true)
    if (!('success' in result)) {
      throw new Error('expected success result, got: ' + JSON.stringify(result))
    }
    const lines = await readLines(auditFile)
    expect(lines.length).toBe(1)
    const parsed = JSON.parse(lines[0]!) as Record<string, unknown>
    expect(parsed['test']).toBe(1)
    expect(typeof parsed['session_id']).toBe('string')
  })
})

describe('Test 3: append O_APPEND single-line per call (STORE-01 / D-08)', () => {
  test('three writes -> three \\n-terminated JSON lines', async () => {
    const logger = makeLogger({})
    await logger.write({ i: 1 })
    await logger.write({ i: 2 })
    await logger.write({ i: 3 })

    const raw = await readFile(auditFile, 'utf8')
    expect(raw.endsWith('\n')).toBe(true)
    const lines = raw.split('\n').filter(Boolean)
    expect(lines.length).toBe(3)
    const parsed = lines.map((l) => JSON.parse(l) as Record<string, unknown>)
    expect(parsed[0]!['i']).toBe(1)
    expect(parsed[1]!['i']).toBe(2)
    expect(parsed[2]!['i']).toBe(3)
  })
})

describe('Test 4: rotation on max_bytes (STORE-02, success criterion 2)', () => {
  test('triggers when bytes cap met; .1 holds pre-rotation content; .jsonl holds new line', async () => {
    // Pin session_id to a short literal so per-line bytes are deterministic.
    // Each line is `{"i":N,"padding":"abc","session_id":"S"}\n` = 41 bytes.
    // With maxBytes=160: writes 1-3 stay below cap; write 4 crosses (123+41=164 >= 160).
    process.env.DBCLI_SESSION_ID = 'S'

    const logger = makeLogger({ maxBytes: 160, maxEntries: 10_000 })
    await logger.write({ i: 1, padding: 'abc' })
    await logger.write({ i: 2, padding: 'abc' })
    await logger.write({ i: 3, padding: 'abc' })
    const result = await logger.write({ i: 4, padding: 'abc' })

    if (!('success' in result)) {
      throw new Error('expected success, got: ' + JSON.stringify(result))
    }
    expect(result.rotated).toBe(true)

    expect(await pathExists(`${auditFile}.1`)).toBe(true)
    const previousLines = await readLines(`${auditFile}.1`)
    expect(previousLines.length).toBe(3)

    const currentLines = await readLines(auditFile)
    expect(currentLines.length).toBe(1)
    const parsed = JSON.parse(currentLines[0]!) as Record<string, unknown>
    expect(parsed['i']).toBe(4)

    const health = logger.getHealth()
    expect(health.currentEntryCount).toBe(1)
    expect(health.currentSizeBytes).toBeGreaterThan(0)
  })
})

describe('Test 5: rotation on max_entries (STORE-02, success criterion 2)', () => {
  test('rotation triggers when entry cap reached; .1 holds first 3 entries; current holds 4th', async () => {
    const logger = makeLogger({ maxBytes: 100_000_000, maxEntries: 3 })
    await logger.write({ n: 1 })
    await logger.write({ n: 2 })
    await logger.write({ n: 3 })
    const result = await logger.write({ n: 4 })

    if (!('success' in result)) {
      throw new Error('expected success, got: ' + JSON.stringify(result))
    }
    expect(result.rotated).toBe(true)

    const previousLines = await readLines(`${auditFile}.1`)
    expect(previousLines.length).toBe(3)
    const currentLines = await readLines(auditFile)
    expect(currentLines.length).toBe(1)
    expect((JSON.parse(currentLines[0]!) as Record<string, unknown>)['n']).toBe(4)
  })
})

describe('Test 6: rotation overwrites existing .1 (D-10 single rolling segment)', () => {
  test('pre-seeded .1 is replaced with NEW pre-rotation content, not preserved', async () => {
    await mkdir(auditDir, { recursive: true })
    await writeFile(`${auditFile}.1`, 'OLD CONTENT\n', 'utf8')

    const logger = makeLogger({ maxBytes: 100_000_000, maxEntries: 2 })
    await logger.write({ n: 'first-after-rotation' })
    await logger.write({ n: 'second' })
    // 3rd write triggers rotation (2 + 1 > 2).
    await logger.write({ n: 'third' })

    const previousRaw = await readFile(`${auditFile}.1`, 'utf8')
    expect(previousRaw.includes('OLD CONTENT')).toBe(false)
    const lines = previousRaw.split('\n').filter(Boolean)
    expect(lines.length).toBe(2)
    const parsedFirst = JSON.parse(lines[0]!) as Record<string, unknown>
    expect(parsedFirst['n']).toBe('first-after-rotation')
  })
})

describe('Test 7: fail-soft on readonly dir (STORE-04, success criterion 4)', () => {
  test('returns skipped:write-failed; getHealth.lastError populated; one stderr warning', async () => {
    // Make `.dbcli/` readonly so the lazy `mkdir(auditDir, {recursive:true})`
    // inside write() fails with EACCES. (Chmodding auditDir itself causes the
    // lock manager — whose lockfile lives inside auditDir — to fail-soft with
    // `lock-budget-exhausted` before write() ever reaches the append step.)
    const dbcliDir = join(workDir, '.dbcli')
    await mkdir(dbcliDir, { recursive: true })
    await chmod(dbcliDir, 0o555)

    stderrSpy = spyOn(process.stderr, 'write')

    const logger = makeLogger({})
    const result = await logger.write({ test: 1 })

    expect('skipped' in result).toBe(true)
    if (!('skipped' in result)) throw new Error('unreachable')
    expect(result.skipped).toBe('write-failed')

    const health = logger.getHealth()
    expect(health.lastError).not.toBeNull()
    expect(typeof health.lastError?.ts).toBe('string')
    expect(typeof health.lastError?.message).toBe('string')

    const writes = stderrSpy.mock.calls.filter((call) => {
      const arg = call[0]
      return typeof arg === 'string' && arg.includes('dbcli audit')
    })
    expect(writes.length).toBe(1)
  })
})

describe('Test 8: once-per-process warning cadence (D-16)', () => {
  test('three more failed writes after the first -> total stderr warnings remains 1; lastError updates', async () => {
    // Same readonly-`.dbcli` setup as Test 7 — mkdir fails inside write().
    const dbcliDir = join(workDir, '.dbcli')
    await mkdir(dbcliDir, { recursive: true })
    await chmod(dbcliDir, 0o555)

    stderrSpy = spyOn(process.stderr, 'write')

    const logger = makeLogger({})
    await logger.write({ test: 1 })
    const firstErrorTs = logger.getHealth().lastError?.ts

    await new Promise((r) => setTimeout(r, 5))
    await logger.write({ test: 2 })
    await new Promise((r) => setTimeout(r, 5))
    await logger.write({ test: 3 })
    await new Promise((r) => setTimeout(r, 5))
    await logger.write({ test: 4 })

    const writes = stderrSpy.mock.calls.filter((call) => {
      const arg = call[0]
      return typeof arg === 'string' && arg.includes('dbcli audit')
    })
    expect(writes.length).toBe(1)

    const finalErrorTs = logger.getHealth().lastError?.ts
    expect(finalErrorTs).not.toBeUndefined()
    expect(finalErrorTs).not.toBe(firstErrorTs)
  })
})

describe('Test 9: getHealth shape when disabled', () => {
  test('returns full AuditHealthReport shape with disabled flags', () => {
    const logger = makeLogger({ enabled: false })
    const h = logger.getHealth()

    const expectedKeys = new Set([
      'enabled',
      'writerInitialized',
      'currentFile',
      'currentSizeBytes',
      'currentEntryCount',
      'rotationUsage',
      'lock',
      'lastWrite',
      'lastError',
      'sessionId',
      'rotation',
    ])
    expect(new Set(Object.keys(h))).toEqual(expectedKeys)

    expect(h.enabled).toBe(false)
    expect(h.writerInitialized).toBe(false)
    expect(h.sessionId).toBe(null)
    expect(h.lastWrite).toBe(null)
    expect(h.lastError).toBe(null)
    expect(typeof h.rotationUsage.bytes.max).toBe('number')
    expect(typeof h.rotationUsage.entries.max).toBe('number')
    expect(h.lock.state === 'held' || h.lock.state === 'free').toBe(true)
  })
})

describe('Test 10: getHealth shape after successful writes', () => {
  test('two writes -> writerInitialized true, counters > 0, lastWrite.success true, sessionId non-empty', async () => {
    const logger = makeLogger({ maxBytes: 1_000_000, maxEntries: 100 })
    await logger.write({ a: 1 })
    await logger.write({ a: 2 })

    const h = logger.getHealth()
    expect(h.enabled).toBe(true)
    expect(h.writerInitialized).toBe(true)
    expect(h.currentEntryCount).toBe(2)
    expect(h.currentSizeBytes).toBeGreaterThan(0)

    expect(h.rotationUsage.entries.current).toBe(2)
    expect(h.rotationUsage.entries.max).toBe(100)
    expect(h.rotationUsage.entries.pct).toBeCloseTo((2 / 100) * 100)

    expect(h.lastWrite).not.toBeNull()
    expect(h.lastWrite?.success).toBe(true)
    expect(typeof h.sessionId).toBe('string')
    expect((h.sessionId ?? '').length).toBeGreaterThan(0)
  })
})

describe('Test 11: AUDIT-02 / AUDIT-03 wiring — session_id present on every entry', () => {
  test('with DBCLI_SESSION_ID env, all entries share the same session_id (cache reuse)', async () => {
    process.env.DBCLI_SESSION_ID = 'wired-id-abc'

    const logger = makeLogger({})
    await logger.write({ i: 1 })
    await logger.write({ i: 2 })
    await logger.write({ i: 3 })

    const lines = await readLines(auditFile)
    expect(lines.length).toBe(3)
    for (const l of lines) {
      const parsed = JSON.parse(l) as Record<string, unknown>
      expect(parsed['session_id']).toBe('wired-id-abc')
    }
  })
})

describe('Test 12: D-14 default.jsonl for unnamed/V1 connections', () => {
  test('connectionName "default" -> file path is .dbcli/audit/default.jsonl', async () => {
    const logger = makeLogger({ connectionName: 'default' })
    await logger.write({ a: 1 })

    const expected = join(workDir, '.dbcli', 'audit', 'default.jsonl')
    expect(await pathExists(expected)).toBe(true)

    const health = logger.getHealth()
    expect(health.currentFile).toBe(expected)
  })
})

describe('Test 13: lock-budget-exhausted fall-through (STORE-03 / D-07 fail-soft)', () => {
  test('stub lockManager returns skipped marker -> logger surfaces it and warns once', async () => {
    // Minimal stub: only the surface AuditLogger uses (withLock, isLockHeld).
    const stub: Pick<AuditLockManager, 'withLock' | 'isLockHeld'> = {
      async withLock<T>(_op: () => Promise<T>): Promise<WithLockResult<T>> {
        return { skipped: 'lock-budget-exhausted' }
      },
      isLockHeld(): boolean {
        return false
      },
    }

    stderrSpy = spyOn(process.stderr, 'write')

    const logger = makeLogger({ lockManager: stub as AuditLockManager })
    const result = await logger.write({ test: 1 })

    expect('skipped' in result).toBe(true)
    if (!('skipped' in result)) throw new Error('unreachable')
    expect(result.skipped).toBe('lock-budget-exhausted')

    const health = logger.getHealth()
    expect(health.lastError).not.toBeNull()

    const writes = stderrSpy.mock.calls.filter((call) => {
      const arg = call[0]
      return typeof arg === 'string' && arg.includes('dbcli audit')
    })
    expect(writes.length).toBe(1)
  })
})
