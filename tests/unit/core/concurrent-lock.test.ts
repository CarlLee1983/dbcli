/**
 * Concurrent Lock - Unit Tests
 */

import { test, expect } from 'bun:test'
import { mkdir, rm } from 'node:fs/promises'
import { ConcurrentLockManager } from '@/core/concurrent-lock'
import { tmpdir } from 'os'
import { join } from 'path'

test('ConcurrentLockManager - acquires and releases lock', async () => {
  const testDir = join(tmpdir(), `lock-test-${Date.now()}`)
  await mkdir(testDir, { recursive: true })

  const manager = new ConcurrentLockManager(testDir)

  // Initially not held
  expect(manager.isLockHeld()).toBe(false)

  // Acquire lock
  const acquired = await manager.acquireLock('test-operation')
  expect(acquired).toBe(true)
  expect(manager.isLockHeld()).toBe(true)

  // Release lock
  const released = await manager.releaseLock()
  expect(released).toBe(true)
  expect(manager.isLockHeld()).toBe(false)

  // Cleanup
  await rm(testDir, { recursive: true, force: true })
})

test('ConcurrentLockManager - lock age tracking', async () => {
  const testDir = join(tmpdir(), `lock-age-${Date.now()}`)
  await mkdir(testDir, { recursive: true })

  const manager = new ConcurrentLockManager(testDir)

  // No age before lock
  expect(manager.getLockAge()).toBe(null)

  // Acquire lock
  await manager.acquireLock('test')

  // Wait a bit and check age
  await new Promise((resolve) => setTimeout(resolve, 100))
  const age = manager.getLockAge()
  expect(age).not.toBe(null)
  expect(age!).toBeGreaterThanOrEqual(50)

  // Release and check age is null again
  await manager.releaseLock()
  expect(manager.getLockAge()).toBe(null)

  // Cleanup
  await rm(testDir, { recursive: true, force: true })
})

test('ConcurrentLockManager - withLock helper', async () => {
  const testDir = join(tmpdir(), `lock-helper-${Date.now()}`)
  await mkdir(testDir, { recursive: true })

  const manager = new ConcurrentLockManager(testDir)

  let operationExecuted = false

  const result = await manager.withLock(async () => {
    operationExecuted = true
    return 'success'
  }, 'test-operation')

  expect(operationExecuted).toBe(true)
  expect(result).toBe('success')
  expect(manager.isLockHeld()).toBe(false) // Lock released after

  // Cleanup
  await rm(testDir, { recursive: true, force: true })
})

test('ConcurrentLockManager - timeout on lock acquisition', async () => {
  const testDir = join(tmpdir(), `lock-timeout-${Date.now()}`)
  await mkdir(testDir, { recursive: true })

  // Only the contender's acquisition is under test, so only it gets a short budget.
  // Sharing a 100ms budget made this flaky on Windows: every acquisition attempt
  // shells out to `mv` (and `rm`) via `Bun.spawn`, which on a loaded runner costs
  // more than the whole budget — so the holder could time out taking an *uncontended*
  // lock and fail the test on line one, before the assertion was ever reached. The
  // failing run took 547ms for a test whose nominal cost is ~220ms.
  const holder = new ConcurrentLockManager(testDir)
  // 1000ms, not 100ms, for a second reason: `tryAcquireLock` treats a lock older than
  // 3x the timeout as stale and *deletes* it. The elapsed check runs at the top of the
  // loop and the staleness check inside the attempt, so an attempt that stalls longer
  // than 3x the budget makes the contender steal the lock and succeed — turning a
  // 300ms hiccup into a red build. At 1000ms that race needs a 3s stall inside a
  // single attempt. The assertions below are what make the test pass or fail; the
  // budget only decides how long it waits to find out.
  const contender = new ConcurrentLockManager(testDir, 1000)

  try {
    await holder.acquireLock('operation1')

    await expect(contender.acquireLock('operation2')).rejects.toThrow(/timeout/)

    // The lock is still the holder's. Without this, the stale-lock race above would
    // read as a pass on the day it fires: `rejects.toThrow` is the only other
    // assertion, and a contender that stole the lock would simply not throw.
    const lock = await Bun.file(join(testDir, 'schema.lock')).json()
    expect(lock.operation).toBe('operation1')
    expect(holder.isLockHeld()).toBe(true)
  } finally {
    await holder.releaseLock()
    await rm(testDir, { recursive: true, force: true })
  }
})
