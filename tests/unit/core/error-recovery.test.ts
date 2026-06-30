/**
 * Error Recovery - Unit Tests
 */

import { test, expect } from 'bun:test'
import { mkdir, rm } from 'node:fs/promises'
import { ErrorRecoveryManager } from '@/core/error-recovery'
import type { DbcliConfig } from '@/utils/validation'
import { tmpdir } from 'os'
import { join } from 'path'

const mockConfig: DbcliConfig = {
  connection: {
    system: 'postgresql',
    host: 'localhost',
    port: 5432,
    user: 'test',
    password: 'test',
    database: 'testdb',
  },
  permission: 'query-only',
  schema: {},
  metadata: { version: '1.0' },
  blacklist: { tables: [], columns: {} },
}

test('ErrorRecoveryManager - initialize creates recovery dir', async () => {
  const testDir = join(tmpdir(), `recovery-test-${Date.now()}`)
  await mkdir(testDir, { recursive: true })

  const manager = new ErrorRecoveryManager(testDir)
  const initialized = await manager.initialize()

  expect(initialized).toBe(true)

  // Cleanup
  await rm(testDir, { recursive: true, force: true })
})

test('ErrorRecoveryManager - creates recovery point', async () => {
  const testDir = join(tmpdir(), `recovery-point-${Date.now()}`)
  await mkdir(testDir, { recursive: true })

  const manager = new ErrorRecoveryManager(testDir)
  await manager.initialize()

  const point = await manager.createRecoveryPoint(mockConfig, 'test-backup')

  expect(point).toBeDefined()
  expect(point.timestamp).toBeDefined()
  expect(point.backupPath).toContain('recovery')
  expect(point.sizeBytes).toBeGreaterThan(0)
  expect(point.reason).toBe('test-backup')

  // Verify backup file exists
  const backupFile = Bun.file(point.backupPath)
  expect(await backupFile.exists()).toBe(true)

  // Cleanup
  await rm(testDir, { recursive: true, force: true })
})

test('ErrorRecoveryManager - restores from recovery point', async () => {
  const testDir = join(tmpdir(), `recovery-restore-${Date.now()}`)
  await mkdir(testDir, { recursive: true })

  const manager = new ErrorRecoveryManager(testDir)
  await manager.initialize()

  // Create recovery point
  const point = await manager.createRecoveryPoint(mockConfig, 'test')

  // Restore from backup
  const restored = await manager.restore(point.backupPath)

  expect(restored).toBeDefined()
  expect(restored.connection.system).toBe('postgresql')
  expect(restored.permission).toBe('query-only')

  // Cleanup
  await rm(testDir, { recursive: true, force: true })
})

test('ErrorRecoveryManager - getRecoveryState works', async () => {
  const testDir = join(tmpdir(), `recovery-state-${Date.now()}`)
  await mkdir(testDir, { recursive: true })

  const manager = new ErrorRecoveryManager(testDir)
  await manager.initialize()

  // Create a recovery point
  await manager.createRecoveryPoint(mockConfig, 'backup1')

  // Get recovery state
  const state = await manager.getRecoveryState()

  expect(state).toBeDefined()
  expect(state.recoveryDir).toContain('recovery')
  expect(state.maxBackups).toBe(10)

  // Cleanup
  await rm(testDir, { recursive: true, force: true })
})

test('ErrorRecoveryManager - cleanup respects maxBackups', async () => {
  const testDir = join(tmpdir(), `recovery-cleanup-${Date.now()}`)
  await mkdir(testDir, { recursive: true })

  const manager = new ErrorRecoveryManager(testDir, 2) // Max 2 backups
  await manager.initialize()

  // Create multiple recovery points
  for (let i = 0; i < 4; i++) {
    await manager.createRecoveryPoint(mockConfig, `backup${i}`)
    await new Promise((resolve) => setTimeout(resolve, 5))
  }

  // Get recovery state - should respect maxBackups limit
  const state = await manager.getRecoveryState()
  expect(state.maxBackups).toBe(2)

  // Cleanup
  await rm(testDir, { recursive: true, force: true })
})

test('ErrorRecoveryManager - withRecovery restores on error', async () => {
  const testDir = join(tmpdir(), `recovery-with-${Date.now()}`)
  await mkdir(testDir, { recursive: true })

  const manager = new ErrorRecoveryManager(testDir)
  await manager.initialize()

  const configPath = join(testDir, 'config.json')
  await Bun.write(Bun.file(configPath), JSON.stringify(mockConfig, null, 2))

  let operationFailed = false

  try {
    await manager.withRecovery(
      mockConfig,
      async () => {
        throw new Error('Operation failed')
      },
      configPath
    )
  } catch (error) {
    operationFailed = true
    expect(error instanceof Error).toBe(true)
  }

  expect(operationFailed).toBe(true)

  // Verify config was restored
  const restored = await Bun.file(configPath).json()
  expect(restored.connection.system).toBe('postgresql')

  // Cleanup
  await rm(testDir, { recursive: true, force: true })
})

test('ErrorRecoveryManager - withRecovery succeeds on success', async () => {
  const testDir = join(tmpdir(), `recovery-success-${Date.now()}`)
  await mkdir(testDir, { recursive: true })

  const manager = new ErrorRecoveryManager(testDir)
  await manager.initialize()

  const result = await manager.withRecovery(
    mockConfig,
    async () => {
      return 'success'
    },
    '/dummy/path'
  )

  expect(result).toBe('success')

  // Cleanup
  await rm(testDir, { recursive: true, force: true })
})
