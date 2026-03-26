/**
 * Atomic File Writer - Unit Tests
 */

import { test, expect } from 'bun:test'
import { AtomicFileWriter } from './atomic-writer'
import { tmpdir } from 'os'
import { join } from 'path'

test('AtomicFileWriter - writes file successfully', async () => {
  const writer = new AtomicFileWriter()
  const testDir = join(tmpdir(), `atomic-test-${Date.now()}`)
  await Bun.spawn(['mkdir', '-p', testDir]).exited

  const filePath = join(testDir, 'test.json')
  const content = JSON.stringify({ test: 'data' })

  const result = await writer.write(filePath, content)

  expect(result).toBeDefined()
  expect(result.filePath).toBe(filePath)
  expect(result.sizeBytes).toBeGreaterThan(0)
  expect(result.backupCreated).toBe(false) // No backup for first write (no original)

  // Verify file exists
  const file = Bun.file(filePath)
  expect(await file.exists()).toBe(true)

  // Cleanup
  await Bun.spawn(['rm', '-rf', testDir]).exited
})

test('AtomicFileWriter - creates backup before overwrite', async () => {
  const writer = new AtomicFileWriter()
  const testDir = join(tmpdir(), `atomic-backup-${Date.now()}`)
  await Bun.spawn(['mkdir', '-p', testDir]).exited

  const filePath = join(testDir, 'test.txt')

  // Write initial content
  await writer.write(filePath, 'original content', { createBackup: false })

  // Write new content with backup enabled
  const result = await writer.write(filePath, 'new content', { createBackup: true })

  expect(result.backupCreated).toBe(true)
  expect(result.backupPath).toBeDefined()

  // Verify backup file exists
  const backupFile = Bun.file(result.backupPath!)
  expect(await backupFile.exists()).toBe(true)

  // Verify backup contains original content
  const backupContent = await backupFile.text()
  expect(backupContent).toBe('original content')

  // Cleanup
  await Bun.spawn(['rm', '-rf', testDir]).exited
})

test('AtomicFileWriter - writeJSON convenience method', async () => {
  const writer = new AtomicFileWriter()
  const testDir = join(tmpdir(), `atomic-json-${Date.now()}`)
  await Bun.spawn(['mkdir', '-p', testDir]).exited

  const filePath = join(testDir, 'data.json')
  const data = { name: 'test', value: 42 }

  const result = await writer.writeJSON(filePath, data)

  expect(result).toBeDefined()
  expect(result.sizeBytes).toBeGreaterThan(0)

  // Verify JSON is valid
  const file = Bun.file(filePath)
  const content = await file.json()
  expect(content.name).toBe('test')
  expect(content.value).toBe(42)

  // Cleanup
  await Bun.spawn(['rm', '-rf', testDir]).exited
})

test('AtomicFileWriter - read method works', async () => {
  const writer = new AtomicFileWriter()
  const testDir = join(tmpdir(), `atomic-read-${Date.now()}`)
  await Bun.spawn(['mkdir', '-p', testDir]).exited

  const filePath = join(testDir, 'read-test.txt')
  const content = 'test content for reading'

  // Write file first
  await writer.write(filePath, content, { createBackup: false })

  // Read it back
  const readContent = await writer.read(filePath)
  expect(readContent).toBe(content)

  // Cleanup
  await Bun.spawn(['rm', '-rf', testDir]).exited
})

test('AtomicFileWriter - read throws on missing file', async () => {
  const writer = new AtomicFileWriter()
  const nonexistentPath = '/tmp/nonexistent-file-12345.txt'

  try {
    await writer.read(nonexistentPath)
    expect(true).toBe(false) // Should not reach here
  } catch (error) {
    expect(error instanceof Error).toBe(true)
    expect(error.message).toContain('File not found')
  }
})

test('AtomicFileWriter - backup method works', async () => {
  const writer = new AtomicFileWriter()
  const testDir = join(tmpdir(), `atomic-backup-method-${Date.now()}`)
  await Bun.spawn(['mkdir', '-p', testDir]).exited

  const filePath = join(testDir, 'original.txt')
  await writer.write(filePath, 'original', { createBackup: false })

  const backupPath = await writer.backup(filePath)

  expect(backupPath).toBeDefined()
  expect(backupPath).toContain('.backup.')

  const backupFile = Bun.file(backupPath!)
  expect(await backupFile.exists()).toBe(true)

  const backupContent = await backupFile.text()
  expect(backupContent).toBe('original')

  // Cleanup
  await Bun.spawn(['rm', '-rf', testDir]).exited
})

test('AtomicFileWriter - restore method works', async () => {
  const writer = new AtomicFileWriter()
  const testDir = join(tmpdir(), `atomic-restore-${Date.now()}`)
  await Bun.spawn(['mkdir', '-p', testDir]).exited

  const originalPath = join(testDir, 'original.txt')
  const backupPath = join(testDir, 'backup.txt')

  // Create original and backup
  await writer.write(originalPath, 'original content', { createBackup: false })
  const backup = await writer.backup(originalPath)
  expect(backup).toBeDefined()

  // Modify original
  await writer.write(originalPath, 'modified content', { createBackup: false })

  // Restore from backup
  const restored = await writer.restore(backup!, originalPath)

  expect(restored).toBe(true)

  // Verify restoration
  const content = await writer.read(originalPath)
  expect(content).toBe('original content')

  // Cleanup
  await Bun.spawn(['rm', '-rf', testDir]).exited
})

test('AtomicFileWriter - no backup when disabled', async () => {
  const writer = new AtomicFileWriter()
  const testDir = join(tmpdir(), `atomic-no-backup-${Date.now()}`)
  await Bun.spawn(['mkdir', '-p', testDir]).exited

  const filePath = join(testDir, 'test.txt')

  const result = await writer.write(filePath, 'content', { createBackup: false })

  expect(result.backupCreated).toBe(false)
  expect(result.backupPath).toBeUndefined()

  // Cleanup
  await Bun.spawn(['rm', '-rf', testDir]).exited
})

test('AtomicFileWriter - handles Buffer content', async () => {
  const writer = new AtomicFileWriter()
  const testDir = join(tmpdir(), `atomic-buffer-${Date.now()}`)
  await Bun.spawn(['mkdir', '-p', testDir]).exited

  const filePath = join(testDir, 'buffer.bin')
  const buffer = Buffer.from('binary content')

  const result = await writer.write(filePath, buffer, { createBackup: false })

  expect(result).toBeDefined()

  const file = Bun.file(filePath)
  const content = await file.text()
  expect(content).toBe('binary content')

  // Cleanup
  await Bun.spawn(['rm', '-rf', testDir]).exited
})
