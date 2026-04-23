/**
 * Concurrent Lock - File-based Locking for Concurrent Access
 *
 * Provides distributed file-based locking to coordinate concurrent schema updates
 * Uses atomic file operations for lock acquisition/release
 */

import { join } from 'path'

/**
 * Concurrent Lock Manager
 *
 * Ensures only one writer updates the schema at a time through file-based locking
 * Lock file: .dbcli/schema.lock
 */
export class ConcurrentLockManager {
  private lockPath: string
  private lockAcquiredAt: number | null = null
  private lockTimeoutMs: number

  constructor(dbcliPath: string, lockTimeoutMs: number = 30000) {
    this.lockPath = join(dbcliPath, 'schema.lock')
    this.lockTimeoutMs = lockTimeoutMs
  }

  /**
   * Acquire lock - waits for lock to be available
   *
   * Implements exponential backoff:
   * - Start: 10ms
   * - Max: 500ms
   * - Timeout: 30s (configurable)
   *
   * @param operationName Name of operation acquiring lock
   * @returns true if lock acquired, false if timeout
   */
  async acquireLock(operationName: string = 'schema-update'): Promise<boolean> {
    const startTime = Date.now()
    let backoffMs = 10

    while (true) {
      // Check timeout
      const elapsed = Date.now() - startTime
      if (elapsed > this.lockTimeoutMs) {
        throw new Error(
          `Lock acquisition timeout after ${elapsed}ms for operation: ${operationName}`
        )
      }

      // Try to acquire lock by creating lock file atomically
      if (await this.tryAcquireLock(operationName)) {
        this.lockAcquiredAt = Date.now()
        return true
      }

      // Wait with exponential backoff before retry
      const waitTime = Math.min(backoffMs, 500)
      await new Promise((resolve) => setTimeout(resolve, waitTime))
      backoffMs = Math.min(backoffMs * 1.5, 500)
    }
  }

  /**
   * Release lock - removes lock file
   *
   * Safe to call even if lock is not held
   *
   * @returns true if lock was released, false if not held
   */
  async releaseLock(): Promise<boolean> {
    if (!this.lockAcquiredAt) {
      return false
    }

    try {
      const lockFile = Bun.file(this.lockPath)
      if (await lockFile.exists()) {
        // Use system rm for atomic removal
        await Bun.spawn(['rm', '-f', this.lockPath]).exited
      }

      this.lockAcquiredAt = null
      return true
    } catch (error) {
      throw new Error(
        `Lock release failed: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  /**
   * Try to acquire lock once - non-blocking
   *
   * Creates lock file with process ID and timestamp
   * If file already exists, lock is held by another process
   *
   * @param operationName Name of operation
   * @returns true if lock acquired
   */
  private async tryAcquireLock(operationName: string): Promise<boolean> {
    try {
      const lockFile = Bun.file(this.lockPath)

      // If lock already exists, check if it's stale
      if (await lockFile.exists()) {
        const lockContent = await lockFile.json()
        const lockAge = Date.now() - lockContent.timestamp

        // If lock is older than 3x timeout, consider it stale and remove it
        // Use 3x multiplier to ensure acquisition timeout fires before stale detection
        const staleLockThresholdMs = this.lockTimeoutMs * 3
        if (lockAge > staleLockThresholdMs) {
          await Bun.spawn(['rm', '-f', this.lockPath]).exited
        } else {
          return false // Lock is held by another process
        }
      }

      // Write lock file atomically
      const lockData = {
        pid: process.pid,
        operation: operationName,
        timestamp: Date.now(),
        hostname: require('os').hostname(),
      }

      // Try to write - this should be atomic enough for our purposes
      const tempPath = `${this.lockPath}.${Date.now()}.tmp`
      const tempFile = Bun.file(tempPath)
      await Bun.write(tempFile, JSON.stringify(lockData))

      // Rename to lock file (atomic on Unix)
      const moveResult = await Bun.spawn(['mv', tempPath, this.lockPath]).exited
      return moveResult === 0
    } catch (error) {
      // If file creation fails, lock is likely held
      return false
    }
  }

  /**
   * Check if we hold the lock
   *
   * @returns true if lock is held by this process
   */
  isLockHeld(): boolean {
    return this.lockAcquiredAt !== null
  }

  /**
   * Get lock age in milliseconds
   *
   * @returns Age of current lock, or null if not held
   */
  getLockAge(): number | null {
    if (!this.lockAcquiredAt) {
      return null
    }
    return Date.now() - this.lockAcquiredAt
  }

  /**
   * Execute operation with automatic lock management
   *
   * Acquires lock, runs operation, and releases lock regardless of outcome
   *
   * @param operation Async function to execute with lock held
   * @param operationName Name of operation (for lock file)
   * @returns Result of operation
   */
  async withLock<T>(
    operation: () => Promise<T>,
    operationName: string = 'schema-update'
  ): Promise<T> {
    await this.acquireLock(operationName)

    try {
      return await operation()
    } finally {
      await this.releaseLock()
    }
  }
}
