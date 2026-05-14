/**
 * AuditLockManager - Unit Tests
 *
 * Covers Plan 21-03 behavior tests 1-8:
 * - Acquire / release roundtrip
 * - Release idempotency when not held
 * - Contention -> fail-soft after ~200ms budget (D-07)
 * - Stale-lock takeover
 * - withLock releases on operation throw
 * - withLock returns skipped marker on budget exhaustion
 * - Per-connection lockfile isolation (D-06)
 * - Release fail-soft when lockfile vanishes externally
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, stat, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import {
  AuditLockManager,
  LOCK_BACKOFF_MAX_MS,
  LOCK_BACKOFF_START_MS,
  LOCK_RETRY_BUDGET_MS,
  STALE_LOCK_MULTIPLIER,
} from '@/core/audit/lock'
import type { LockfileContent } from '@/core/audit/lock'

let workDir: string
let auditFile: string

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p)
    return true
  } catch {
    return false
  }
}

async function readLockfile(path: string): Promise<LockfileContent> {
  const raw = await readFile(path, 'utf8')
  return JSON.parse(raw) as LockfileContent
}

async function writeLockfileFixture(path: string, content: LockfileContent): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(content), 'utf8')
}

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'dbcli-audit-lock-'))
  auditFile = join(workDir, '.dbcli', 'audit', 'default.jsonl')
})

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true })
})

describe('AuditLockManager - exported constants (D-05/D-07)', () => {
  test('constants match plan spec (200ms budget, 5..50ms backoff, 10x stale)', () => {
    expect(LOCK_RETRY_BUDGET_MS).toBe(200)
    expect(LOCK_BACKOFF_START_MS).toBe(5)
    expect(LOCK_BACKOFF_MAX_MS).toBe(50)
    expect(STALE_LOCK_MULTIPLIER).toBe(10)
  })
})

describe('AuditLockManager - Test 1: acquire/release roundtrip', () => {
  test('acquireLock writes lockfile JSON; releaseLock removes it', async () => {
    const manager = new AuditLockManager(auditFile)

    expect(manager.isLockHeld()).toBe(false)
    expect(manager.getLockfilePath()).toBe(`${auditFile}.lock`)

    const acquired = await manager.acquireLock('audit-write')
    expect(acquired).toBe(true)
    expect(manager.isLockHeld()).toBe(true)

    const lockfilePath = manager.getLockfilePath()
    expect(await pathExists(lockfilePath)).toBe(true)

    const content = await readLockfile(lockfilePath)
    expect(content.pid).toBe(process.pid)
    expect(content.operation).toBe('audit-write')
    expect(typeof content.timestamp).toBe('number')
    expect(typeof content.hostname).toBe('string')
    expect(content.hostname.length).toBeGreaterThan(0)

    const released = await manager.releaseLock()
    expect(released).toBe(true)
    expect(manager.isLockHeld()).toBe(false)
    expect(await pathExists(lockfilePath)).toBe(false)
  })
})

describe('AuditLockManager - Test 2: release idempotency', () => {
  test('releaseLock on fresh manager returns false without throwing', async () => {
    const manager = new AuditLockManager(auditFile)
    const released = await manager.releaseLock()
    expect(released).toBe(false)
    expect(manager.isLockHeld()).toBe(false)
  })
})

describe('AuditLockManager - Test 3: contention -> fail-soft after ~200ms budget (D-07)', () => {
  test('acquireLock returns false within ~budget when another process holds the lock', async () => {
    // Pre-create a fresh lockfile owned by a different (non-current) pid
    const lockfilePath = `${auditFile}.lock`
    await writeLockfileFixture(lockfilePath, {
      pid: process.pid + 12345, // not us
      operation: 'audit-write-other',
      timestamp: Date.now(), // fresh -> not stale
      hostname: 'other-host',
    })

    const manager = new AuditLockManager(auditFile)

    const start = performance.now()
    const acquired = await manager.acquireLock('audit-write')
    const elapsedMs = performance.now() - start

    expect(acquired).toBe(false)
    expect(manager.isLockHeld()).toBe(false)
    expect(elapsedMs).toBeGreaterThanOrEqual(180) // ~200ms budget, allow lower jitter
    expect(elapsedMs).toBeLessThan(600) // CI upper bound

    // Lockfile must remain owned by the fixture pid (we did NOT take over)
    const after = await readLockfile(lockfilePath)
    expect(after.pid).toBe(process.pid + 12345)
  })
})

describe('AuditLockManager - Test 4: stale-lock takeover', () => {
  test('lockfile older than STALE threshold is removed and taken over', async () => {
    const lockfilePath = `${auditFile}.lock`
    // 5s old, well beyond LOCK_RETRY_BUDGET_MS * STALE_LOCK_MULTIPLIER (=2000ms)
    await writeLockfileFixture(lockfilePath, {
      pid: process.pid + 99999,
      operation: 'audit-write-stale',
      timestamp: Date.now() - 5_000,
      hostname: 'stale-host',
    })

    const manager = new AuditLockManager(auditFile)
    const acquired = await manager.acquireLock('audit-write')
    expect(acquired).toBe(true)
    expect(manager.isLockHeld()).toBe(true)

    const after = await readLockfile(lockfilePath)
    expect(after.pid).toBe(process.pid)
    expect(after.operation).toBe('audit-write')

    await manager.releaseLock()
  })
})

describe('AuditLockManager - Test 5: withLock releases on operation throw', () => {
  test('withLock re-throws and removes lockfile via finally', async () => {
    const manager = new AuditLockManager(auditFile)
    const lockfilePath = manager.getLockfilePath()

    let thrown: unknown = null
    try {
      await manager.withLock(async () => {
        throw new Error('boom')
      }, 'audit-write')
    } catch (err) {
      thrown = err
    }

    expect(thrown).toBeInstanceOf(Error)
    expect((thrown as Error).message).toBe('boom')
    expect(manager.isLockHeld()).toBe(false)
    expect(await pathExists(lockfilePath)).toBe(false)
  })
})

describe('AuditLockManager - Test 6: withLock returns skipped marker on budget exhaustion', () => {
  test('operation is NOT invoked when acquire fails; result === { skipped: "lock-budget-exhausted" }', async () => {
    const lockfilePath = `${auditFile}.lock`
    await writeLockfileFixture(lockfilePath, {
      pid: process.pid + 7777,
      operation: 'audit-write-other',
      timestamp: Date.now(),
      hostname: 'other-host',
    })

    const manager = new AuditLockManager(auditFile)
    let invocations = 0

    const result = await manager.withLock(async () => {
      invocations += 1
      return 'should-not-run'
    }, 'audit-write')

    expect(invocations).toBe(0)
    expect(result).toEqual({ skipped: 'lock-budget-exhausted' })
  })
})

describe('AuditLockManager - Test 7: per-connection lockfile isolation (D-06)', () => {
  test('two managers on different audit files acquire in parallel without contention', async () => {
    const auditA = join(workDir, '.dbcli', 'audit', 'conn-a.jsonl')
    const auditB = join(workDir, '.dbcli', 'audit', 'conn-b.jsonl')
    const a = new AuditLockManager(auditA)
    const b = new AuditLockManager(auditB)

    const [acquiredA, acquiredB] = await Promise.all([
      a.acquireLock('audit-write'),
      b.acquireLock('audit-write'),
    ])

    expect(acquiredA).toBe(true)
    expect(acquiredB).toBe(true)
    expect(a.getLockfilePath()).not.toBe(b.getLockfilePath())
    expect(await pathExists(a.getLockfilePath())).toBe(true)
    expect(await pathExists(b.getLockfilePath())).toBe(true)

    expect(await a.releaseLock()).toBe(true)
    expect(await b.releaseLock()).toBe(true)
  })
})

describe('AuditLockManager - Test 8: release fail-soft when lockfile vanishes', () => {
  test('releaseLock after external deletion does NOT throw', async () => {
    const manager = new AuditLockManager(auditFile)
    const acquired = await manager.acquireLock('audit-write')
    expect(acquired).toBe(true)

    // Externally remove the lockfile (simulates another process / fs race)
    await unlink(manager.getLockfilePath())

    // Must not throw; return value can be true or false either is fine
    let threw = false
    try {
      await manager.releaseLock()
    } catch {
      threw = true
    }
    expect(threw).toBe(false)
    expect(manager.isLockHeld()).toBe(false)
  })
})
