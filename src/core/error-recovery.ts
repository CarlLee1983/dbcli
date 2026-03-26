/**
 * Error Recovery & Rollback - Backup and Recovery Support
 *
 * Provides mechanisms to recover from failed schema updates:
 * 1. Automatic backups before updates
 * 2. Rollback to previous state on failure
 * 3. Recovery state inspection
 */

import { join } from 'path'
import type { DbcliConfig } from '@/utils/validation'

/**
 * Recovery point - snapshot of schema state
 */
export interface RecoveryPoint {
  /** Timestamp when backup was created */
  timestamp: string
  /** Path to backup file */
  backupPath: string
  /** Size of backup in bytes */
  sizeBytes: number
  /** Reason for backup */
  reason: string
}

/**
 * Recovery state
 */
export interface RecoveryState {
  /** Available recovery points */
  points: RecoveryPoint[]
  /** Path to recovery directory */
  recoveryDir: string
  /** Maximum backups to keep */
  maxBackups: number
}

/**
 * Error Recovery Manager
 *
 * Manages backups and recovery points for schema updates
 * Stores backups in .dbcli/recovery/ directory
 */
export class ErrorRecoveryManager {
  private recoveryDir: string
  private maxBackups: number = 10

  constructor(dbcliPath: string, maxBackups?: number) {
    this.recoveryDir = join(dbcliPath, 'recovery')
    if (maxBackups) {
      this.maxBackups = maxBackups
    }
  }

  /**
   * Initialize recovery directory
   *
   * Creates .dbcli/recovery/ if it doesn't exist
   *
   * @returns true if directory created/exists, false on error
   */
  async initialize(): Promise<boolean> {
    try {
      const dir = Bun.file(this.recoveryDir)
      if (!(await dir.exists())) {
        await Bun.spawn(['mkdir', '-p', this.recoveryDir]).exited
      }
      return true
    } catch (error) {
      console.error('Failed to initialize recovery directory:', error)
      return false
    }
  }

  /**
   * Create recovery point - backup current config before update
   *
   * Stores backup in .dbcli/recovery/config-{timestamp}.json
   * Automatically cleans up old backups to stay within maxBackups limit
   *
   * @param config Config to backup
   * @param reason Why backup was created
   * @returns RecoveryPoint with backup info
   */
  async createRecoveryPoint(
    config: DbcliConfig,
    reason: string = 'pre-update-backup'
  ): Promise<RecoveryPoint> {
    try {
      const timestamp = new Date().toISOString()
      const backupName = `config-${Date.now()}.json`
      const backupPath = join(this.recoveryDir, backupName)

      // Write backup
      const backupFile = Bun.file(backupPath)
      const content = JSON.stringify(config, null, 2)
      await Bun.write(backupFile, content)

      const sizeBytes = Buffer.byteLength(content, 'utf-8')

      // Cleanup old backups
      await this.cleanupOldBackups()

      return {
        timestamp,
        backupPath,
        sizeBytes,
        reason
      }
    } catch (error) {
      throw new Error(
        `Failed to create recovery point: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  /**
   * Restore from recovery point
   *
   * Loads a previous config from backup
   *
   * @param backupPath Path to backup file
   * @returns Restored DbcliConfig
   */
  async restore(backupPath: string): Promise<DbcliConfig> {
    try {
      const backupFile = Bun.file(backupPath)
      if (!(await backupFile.exists())) {
        throw new Error(`Backup file not found: ${backupPath}`)
      }

      const content = await backupFile.json() as DbcliConfig
      return content
    } catch (error) {
      throw new Error(
        `Failed to restore from backup: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  /**
   * Get recovery state - list available recovery points
   *
   * @returns RecoveryState with all available backups
   */
  async getRecoveryState(): Promise<RecoveryState> {
    try {
      const points: RecoveryPoint[] = []

      // Check if recovery directory exists
      const dir = Bun.file(this.recoveryDir)
      if (!(await dir.exists())) {
        return {
          points,
          recoveryDir: this.recoveryDir,
          maxBackups: this.maxBackups
        }
      }

      // List files in directory using glob pattern
      // Since Bun's file API doesn't have good directory listing,
      // we'll look for backup files more directly
      const glob = new Bun.Glob('config-*.json')
      const scanner = glob.scan(this.recoveryDir)

      // Scan is async iterable - collect all results
      for await (const entry of scanner) {
        const backupPath = join(this.recoveryDir, entry)
        const file = Bun.file(backupPath)

        if (await file.exists()) {
          const sizeBytes = file.size || 0
          // Extract timestamp from filename (config-{timestamp}.json)
          const match = entry.match(/config-(\d+)\.json/)
          const timestamp = match
            ? new Date(parseInt(match[1])).toISOString()
            : new Date().toISOString()

          points.push({
            timestamp,
            backupPath,
            sizeBytes,
            reason: 'backup'
          })
        }
      }

      // Sort by timestamp descending (newest first)
      points.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())

      return {
        points,
        recoveryDir: this.recoveryDir,
        maxBackups: this.maxBackups
      }
    } catch (error) {
      console.error('Failed to get recovery state:', error)
      return {
        points: [],
        recoveryDir: this.recoveryDir,
        maxBackups: this.maxBackups
      }
    }
  }

  /**
   * Cleanup old backups - keep only maxBackups most recent
   *
   * @returns Number of backups removed
   */
  private async cleanupOldBackups(): Promise<number> {
    try {
      const state = await this.getRecoveryState()

      if (state.points.length <= this.maxBackups) {
        return 0
      }

      let removed = 0
      const toRemove = state.points.slice(this.maxBackups)

      for (const point of toRemove) {
        try {
          await Bun.spawn(['rm', '-f', point.backupPath]).exited
          removed++
        } catch (error) {
          console.error(`Failed to remove backup ${point.backupPath}:`, error)
        }
      }

      return removed
    } catch (error) {
      console.error('Backup cleanup failed:', error)
      return 0
    }
  }

  /**
   * Execute operation with automatic recovery on failure
   *
   * Creates backup before operation, restores on error
   *
   * @param currentConfig Current config before operation
   * @param operation Operation to execute
   * @param targetPath Path to config file to restore on failure
   * @returns Result of operation
   */
  async withRecovery<T>(
    currentConfig: DbcliConfig,
    operation: () => Promise<T>,
    targetPath: string
  ): Promise<T> {
    // Create backup before starting
    const recoveryPoint = await this.createRecoveryPoint(
      currentConfig,
      'pre-operation-backup'
    )

    try {
      // Execute operation
      return await operation()
    } catch (error) {
      // On failure, restore from backup
      console.error('Operation failed, restoring from backup...')
      try {
        const restored = await this.restore(recoveryPoint.backupPath)
        const targetFile = Bun.file(targetPath)
        await Bun.write(targetFile, JSON.stringify(restored, null, 2))
        console.error('Successfully restored from backup')
      } catch (restoreError) {
        console.error('Restore failed:', restoreError)
      }

      throw error
    }
  }
}
