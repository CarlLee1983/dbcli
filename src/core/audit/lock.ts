/**
 * AuditLockManager - short-budget file lock for audit writes.
 *
 * Decisions (the record they pointed to is gone; they are the record now):
 * - D-05: NOT a reuse of ConcurrentLockManager; tunings differ.
 * - D-06: one lock per audit file (`<auditFilePath>.lock`).
 * - D-07: total retry budget ~200ms; on exhaustion RETURN false (do NOT throw).
 *
 * Mechanism (lockfile + exp backoff + stale takeover) is copied from
 * src/core/concurrent-lock.ts; tunings come from this module's constants.
 *
 * Fail-soft contract:
 * - acquireLock returns false (never throws) when the retry budget is exhausted.
 * - releaseLock catches all filesystem errors and clears internal state regardless;
 *   it never throws. This protects engine call chains from audit-internal failures.
 * - withLock returns { skipped: 'lock-budget-exhausted' } instead of running the
 *   operation when the lock cannot be acquired in time.
 */

import { hostname } from 'node:os'
import { dirname } from 'node:path'
import { mkdir, open, rm } from 'node:fs/promises'

export const LOCK_RETRY_BUDGET_MS = 200
export const LOCK_BACKOFF_START_MS = 5
export const LOCK_BACKOFF_MAX_MS = 50
export const STALE_LOCK_MULTIPLIER = 10 // 2000ms stale threshold (200ms * 10)

export interface LockfileContent {
  pid: number
  operation: string
  timestamp: number
  hostname: string
}

export type WithLockResult<T> = T | { skipped: 'lock-budget-exhausted' }

export class AuditLockManager {
  private readonly lockPath: string
  private lockAcquiredAt: number | null = null

  constructor(private readonly auditFilePath: string) {
    this.lockPath = `${auditFilePath}.lock`
  }

  /**
   * Get the lockfile path (for tests / introspection).
   */
  getLockfilePath(): string {
    return this.lockPath
  }

  /**
   * Whether THIS manager instance currently holds the lock.
   */
  isLockHeld(): boolean {
    return this.lockAcquiredAt !== null
  }

  /**
   * Acquire the lock with a bounded retry budget.
   *
   * @returns true if the lock was acquired; false if the budget was exhausted
   *   (D-07 fail-soft). NEVER throws.
   */
  async acquireLock(operationName: string = 'audit-write'): Promise<boolean> {
    const startTime = Date.now()
    let backoffMs = LOCK_BACKOFF_START_MS

    while (true) {
      const elapsed = Date.now() - startTime
      if (elapsed > LOCK_RETRY_BUDGET_MS) {
        // D-07: fail-soft - do NOT throw.
        return false
      }
      if (await this.tryAcquireLock(operationName)) {
        this.lockAcquiredAt = Date.now()
        return true
      }
      const waitTime = Math.min(backoffMs, LOCK_BACKOFF_MAX_MS)
      await new Promise((resolve) => setTimeout(resolve, waitTime))
      backoffMs = Math.min(backoffMs * 1.5, LOCK_BACKOFF_MAX_MS)
    }
  }

  /**
   * Release the lock.
   *
   * Audit context: NEVER throws. If the lockfile vanished externally,
   * internal state is still cleared and the method returns peacefully.
   *
   * @returns true if a lock was held and the underlying state was cleared;
   *   false if the manager was not holding a lock or the underlying remove
   *   step swallowed an error.
   */
  async releaseLock(): Promise<boolean> {
    if (!this.lockAcquiredAt) return false
    try {
      await rm(this.lockPath, { force: true })
      this.lockAcquiredAt = null
      return true
    } catch {
      // Audit context: never throw on release. Clear internal state anyway.
      this.lockAcquiredAt = null
      return false
    }
  }

  /**
   * Execute an operation while holding the lock.
   *
   * - If acquisition fails within the retry budget, the operation is NOT invoked
   *   and { skipped: 'lock-budget-exhausted' } is returned (D-07 fail-soft).
   * - If the operation throws, the lock is still released via finally and the
   *   error is re-thrown to the caller.
   */
  async withLock<T>(
    operation: () => Promise<T>,
    operationName: string = 'audit-write'
  ): Promise<WithLockResult<T>> {
    const acquired = await this.acquireLock(operationName)
    if (!acquired) {
      return { skipped: 'lock-budget-exhausted' }
    }
    try {
      return await operation()
    } finally {
      await this.releaseLock()
    }
  }

  /**
   * Single non-blocking attempt to acquire the lock.
   *
   * Pre-creates the parent directory (lazy mkdir) because the audit dir may
   * not yet exist on first call. Performs stale-lock detection: lockfiles
   * older than LOCK_RETRY_BUDGET_MS * STALE_LOCK_MULTIPLIER are removed
   * before the new lockfile is written.
   */
  private async tryAcquireLock(operationName: string): Promise<boolean> {
    try {
      // Ensure parent dir exists (audit dir may not have been created yet).
      await mkdir(dirname(this.lockPath), { recursive: true })

      const lockFile = Bun.file(this.lockPath)
      if (await lockFile.exists()) {
        const lockContent = (await lockFile.json()) as LockfileContent
        const lockAge = Date.now() - lockContent.timestamp
        const staleLockThresholdMs = LOCK_RETRY_BUDGET_MS * STALE_LOCK_MULTIPLIER
        if (lockAge > staleLockThresholdMs) {
          await rm(this.lockPath, { force: true })
        } else {
          return false
        }
      }

      const lockData: LockfileContent = {
        pid: process.pid,
        operation: operationName,
        timestamp: Date.now(),
        hostname: hostname(),
      }
      const handle = await open(this.lockPath, 'wx')
      try {
        await handle.writeFile(JSON.stringify(lockData), 'utf8')
      } finally {
        await handle.close()
      }
      return true
    } catch {
      return false
    }
  }
}
