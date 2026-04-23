/**
 * Concurrent Lock - Unit Tests
 */

import { test, expect } from 'bun:test'
import { ConcurrentLockManager } from '@/core/concurrent-lock'
import { tmpdir } from 'os'
import { join } from 'path'

test('ConcurrentLockManager - acquires and releases lock', async () => {
  const testDir = join(tmpdir(), `lock-test-${Date.now()}`)
  await Bun.spawn(['mkdir', '-p', testDir]).exited

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
  await Bun.spawn(['rm', '-rf', testDir]).exited
})

test('ConcurrentLockManager - lock age tracking', async () => {
  const testDir = join(tmpdir(), `lock-age-${Date.now()}`)
  await Bun.spawn(['mkdir', '-p', testDir]).exited

  const manager = new ConcurrentLockManager(testDir)

  // No age before lock
  expect(manager.getLockAge()).toBe(null)

  // Acquire lock
  await manager.acquireLock('test')

  // Wait a bit and check age
  await new Promise((resolve) => setTimeout(resolve, 50))
  const age = manager.getLockAge()
  expect(age).not.toBe(null)
  expect(age!).toBeGreaterThanOrEqual(50)

  // Release and check age is null again
  await manager.releaseLock()
  expect(manager.getLockAge()).toBe(null)

  // Cleanup
  await Bun.spawn(['rm', '-rf', testDir]).exited
})

test('ConcurrentLockManager - withLock helper', async () => {
  const testDir = join(tmpdir(), `lock-helper-${Date.now()}`)
  await Bun.spawn(['mkdir', '-p', testDir]).exited

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
  await Bun.spawn(['rm', '-rf', testDir]).exited
})

test('ConcurrentLockManager - timeout on lock acquisition', async () => {
  const testDir = join(tmpdir(), `lock-timeout-${Date.now()}`)
  await Bun.spawn(['mkdir', '-p', testDir]).exited

  const manager1 = new ConcurrentLockManager(testDir, 100) // Very short timeout
  const manager2 = new ConcurrentLockManager(testDir, 100)

  // Manager1 acquires lock
  await manager1.acquireLock('operation1')

  // Manager2 tries to acquire with short timeout
  try {
    await manager2.acquireLock('operation2')
    expect(true).toBe(false) // Should timeout
  } catch (error) {
    expect(error instanceof Error).toBe(true)
    expect(error.message).toContain('timeout')
  }

  // Cleanup
  await manager1.releaseLock()
  await Bun.spawn(['rm', '-rf', testDir]).exited
})
