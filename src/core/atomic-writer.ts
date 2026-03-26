/**
 * Atomic File Writer - Safe File Writing with Backups
 *
 * Ensures data integrity through atomic operations:
 * 1. Write to temporary file
 * 2. Create backup of original (if requested)
 * 3. Atomic rename of temp to target (prevents partial writes)
 * 4. Cleanup on error (rollback)
 */

import { join, dirname } from 'path'
import type { AtomicWriteOptions, WriteResult } from '@/types/schema-updater'

/**
 * Atomic File Writer - provides safe file writing with atomic guarantees
 *
 * Safety properties:
 * - Temporary file written to same filesystem for atomic rename
 * - Backup created before overwriting (if enabled)
 * - Atomic rename prevents partial writes from being visible
 * - Cleanup on error rolls back changes
 */
export class AtomicFileWriter {
  /**
   * Write content to file atomically
   *
   * Process:
   * 1. Create temp file in same directory
   * 2. Write content to temp file
   * 3. Create backup if requested
   * 4. Atomically rename temp to target
   * 5. Verify write success
   *
   * @param filePath Target file path
   * @param content Content to write (string or Buffer)
   * @param options Write options (backups, mode, timeout)
   * @returns WriteResult with file info
   * @throws Error if write fails or timeout exceeded
   */
  async write(
    filePath: string,
    content: string | Buffer,
    options?: AtomicWriteOptions
  ): Promise<WriteResult> {
    const startTime = Date.now()
    const timeout = options?.timeout || 5000 // Default 5s timeout
    const createBackup = options?.createBackup ?? true

    // Generate unique temp file
    const timestamp = Date.now()
    const tempPath = `${filePath}.${timestamp}.tmp`
    const backupPath = `${filePath}.backup.${timestamp}`

    let backupCreated = false
    let tempFileCreated = false

    try {
      // Check timeout before starting
      this.checkTimeout(startTime, timeout, 'write initialization')

      // Convert content to buffer if needed
      const buffer = typeof content === 'string'
        ? Buffer.from(content, 'utf-8')
        : content

      // Write to temporary file
      const tempFile = Bun.file(tempPath)
      await Bun.write(tempFile, buffer)
      tempFileCreated = true

      // Check timeout after temp write
      this.checkTimeout(startTime, timeout, 'temp file write')

      // Create backup if original exists
      if (createBackup) {
        const originalFile = Bun.file(filePath)
        if (await originalFile.exists()) {
          const originalContent = await originalFile.arrayBuffer()
          const backupFile = Bun.file(backupPath)
          await Bun.write(backupFile, originalContent)
          backupCreated = true
        }
      }

      // Check timeout after backup
      this.checkTimeout(startTime, timeout, 'backup creation')

      // Atomic rename using shell command (ensures same-filesystem move)
      // mv is atomic on Unix-like systems
      const moveResult = await Bun.spawn(['mv', tempPath, filePath]).exited
      if (moveResult !== 0) {
        throw new Error(`Atomic rename failed with exit code ${moveResult}`)
      }

      tempFileCreated = false // Temp file was successfully moved

      // Verify the write
      const writtenFile = Bun.file(filePath)
      const written = await writtenFile.exists()
      if (!written) {
        throw new Error('Verification failed: file not found after write')
      }

      const sizeBytes = writtenFile.size || buffer.length

      return {
        filePath,
        sizeBytes,
        timestamp: new Date().toISOString(),
        backupCreated,
        backupPath: backupCreated ? backupPath : undefined
      }
    } catch (error) {
      // Cleanup on error
      await this.cleanup(tempPath, tempFileCreated)
      throw new Error(
        `Atomic write failed: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  /**
   * Write JSON content to file atomically
   *
   * Convenience method for JSON serialization + atomic write
   *
   * @param filePath Target file path
   * @param data Object to serialize as JSON
   * @param options Write options
   * @returns WriteResult
   */
  async writeJSON<T>(
    filePath: string,
    data: T,
    options?: AtomicWriteOptions
  ): Promise<WriteResult> {
    const jsonContent = JSON.stringify(data, null, 2)
    return this.write(filePath, jsonContent, options)
  }

  /**
   * Read a file with timeout support
   *
   * @param filePath Path to read
   * @param timeout Timeout in milliseconds
   * @returns File content as string
   * @throws Error if file not found or timeout exceeded
   */
  async read(filePath: string, timeout: number = 5000): Promise<string> {
    const startTime = Date.now()
    this.checkTimeout(startTime, timeout, 'read start')

    const file = Bun.file(filePath)
    if (!(await file.exists())) {
      throw new Error(`File not found: ${filePath}`)
    }

    this.checkTimeout(startTime, timeout, 'file existence check')
    return await file.text()
  }

  /**
   * Create backup of existing file
   *
   * @param filePath Path to backup
   * @returns Path to backup file created, or null if file doesn't exist
   */
  async backup(filePath: string): Promise<string | null> {
    const file = Bun.file(filePath)
    if (!(await file.exists())) {
      return null
    }

    const timestamp = Date.now()
    const backupPath = `${filePath}.backup.${timestamp}`
    const content = await file.arrayBuffer()

    const backupFile = Bun.file(backupPath)
    await Bun.write(backupFile, content)

    return backupPath
  }

  /**
   * Restore file from backup
   *
   * Atomically restores a file from its backup by renaming
   *
   * @param backupPath Path to backup file
   * @param targetPath Target path to restore to
   * @returns true if restore successful
   */
  async restore(backupPath: string, targetPath: string): Promise<boolean> {
    try {
      const backupFile = Bun.file(backupPath)
      if (!(await backupFile.exists())) {
        throw new Error(`Backup file not found: ${backupPath}`)
      }

      // Read backup content
      const content = await backupFile.arrayBuffer()

      // Write to target using atomic write
      const result = await this.write(targetPath, Buffer.from(content), {
        createBackup: false // Don't create backup when restoring
      })

      return !!result
    } catch (error) {
      throw new Error(
        `File restore failed: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  /**
   * Check if operation exceeded timeout
   *
   * @param startTime Start time in milliseconds
   * @param timeout Timeout in milliseconds
   * @param stage Current operation stage (for error message)
   * @throws Error if timeout exceeded
   */
  private checkTimeout(startTime: number, timeout: number, stage: string): void {
    const elapsed = Date.now() - startTime
    if (elapsed > timeout) {
      throw new Error(`Operation timeout exceeded at ${stage}: ${elapsed}ms > ${timeout}ms`)
    }
  }

  /**
   * Cleanup temporary files on error
   *
   * @param tempPath Path to temp file
   * @param tempExists Whether temp file exists
   */
  private async cleanup(tempPath: string, tempExists: boolean): Promise<void> {
    if (!tempExists) return

    try {
      const tempFile = Bun.file(tempPath)
      if (await tempFile.exists()) {
        // Remove temp file by overwriting with empty content won't work
        // We need to use system command to delete
        await Bun.spawn(['rm', '-f', tempPath]).exited
      }
    } catch (error) {
      // Log but don't throw - cleanup failure shouldn't mask original error
      console.error(`Cleanup failed for temp file ${tempPath}:`, error)
    }
  }
}
