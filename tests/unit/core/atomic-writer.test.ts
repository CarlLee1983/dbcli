/**
 * Atomic File Writer - Unit Tests
 */

import { afterEach, beforeEach, test, expect } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { AtomicFileWriter } from '@/core/atomic-writer'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let testDirectory: string

beforeEach(async () => {
  testDirectory = await mkdtemp(join(tmpdir(), 'atomic-writer-test-'))
})

afterEach(async () => {
  await rm(testDirectory, { recursive: true, force: true })
})

test('AtomicFileWriter - writes file successfully', async () => {
  const writer = new AtomicFileWriter()

  const filePath = join(testDirectory, 'test.json')
  const content = JSON.stringify({ test: 'data' })

  const result = await writer.write(filePath, content)

  expect(result).toBeDefined()
  expect(result.filePath).toBe(filePath)
  expect(result.sizeBytes).toBeGreaterThan(0)
  expect(result.backupCreated).toBe(false) // No backup for first write (no original)

  // Verify file exists
  const file = Bun.file(filePath)
  expect(await file.exists()).toBe(true)
})

test('AtomicFileWriter - creates backup before overwrite', async () => {
  const writer = new AtomicFileWriter()

  const filePath = join(testDirectory, 'test.txt')

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
})

test('AtomicFileWriter - writeJSON convenience method', async () => {
  const writer = new AtomicFileWriter()

  const filePath = join(testDirectory, 'data.json')
  const data = { name: 'test', value: 42 }

  const result = await writer.writeJSON(filePath, data)

  expect(result).toBeDefined()
  expect(result.sizeBytes).toBeGreaterThan(0)

  // Verify JSON is valid
  const file = Bun.file(filePath)
  const content = await file.json()
  expect(content.name).toBe('test')
  expect(content.value).toBe(42)
})

test('AtomicFileWriter - read method works', async () => {
  const writer = new AtomicFileWriter()

  const filePath = join(testDirectory, 'read-test.txt')
  const content = 'test content for reading'

  // Write file first
  await writer.write(filePath, content, { createBackup: false })

  // Read it back
  const readContent = await writer.read(filePath)
  expect(readContent).toBe(content)
})

test('AtomicFileWriter - read throws on missing file', async () => {
  const writer = new AtomicFileWriter()
  const nonexistentPath = join(testDirectory, 'nonexistent-file.txt')

  try {
    await writer.read(nonexistentPath)
    expect(true).toBe(false) // Should not reach here
  } catch (error) {
    expect(error instanceof Error).toBe(true)
    expect((error as Error).message).toContain('File not found')
  }
})

test('AtomicFileWriter - backup method works', async () => {
  const writer = new AtomicFileWriter()

  const filePath = join(testDirectory, 'original.txt')
  await writer.write(filePath, 'original', { createBackup: false })

  const backupPath = await writer.backup(filePath)

  expect(backupPath).toBeDefined()
  expect(backupPath).toContain('.backup.')

  const backupFile = Bun.file(backupPath!)
  expect(await backupFile.exists()).toBe(true)

  const backupContent = await backupFile.text()
  expect(backupContent).toBe('original')
})

test('AtomicFileWriter - restore method works', async () => {
  const writer = new AtomicFileWriter()

  const originalPath = join(testDirectory, 'original.txt')
  const _backupPath = join(testDirectory, 'backup.txt')

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
})

test('AtomicFileWriter - no backup when disabled', async () => {
  const writer = new AtomicFileWriter()

  const filePath = join(testDirectory, 'test.txt')

  const result = await writer.write(filePath, 'content', { createBackup: false })

  expect(result.backupCreated).toBe(false)
  expect(result.backupPath).toBeUndefined()
})

test('AtomicFileWriter - handles Buffer content', async () => {
  const writer = new AtomicFileWriter()

  const filePath = join(testDirectory, 'buffer.bin')
  const buffer = Buffer.from('binary content')

  const result = await writer.write(filePath, buffer, { createBackup: false })

  expect(result).toBeDefined()

  const file = Bun.file(filePath)
  const content = await file.text()
  expect(content).toBe('binary content')
})
