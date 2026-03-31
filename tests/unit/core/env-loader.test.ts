import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { loadEnvFile } from '@/core/env-loader'
import { join } from 'path'

const TMP_DIR = '/tmp/dbcli-env-loader-test'

describe('loadEnvFile', () => {
  beforeEach(async () => {
    await Bun.$`mkdir -p ${TMP_DIR}`
  })

  afterEach(async () => {
    await Bun.$`rm -rf ${TMP_DIR}`
    delete process.env.TEST_LOADER_HOST
    delete process.env.TEST_LOADER_PORT
    delete process.env.TEST_LOADER_PASSWORD
    delete process.env.TEST_LOADER_QUOTED
    delete process.env.TEST_LOADER_EXISTING
  })

  test('should load key=value pairs into process.env', async () => {
    const envPath = join(TMP_DIR, '.env.test')
    await Bun.file(envPath).write('TEST_LOADER_HOST=staging.example.com\nTEST_LOADER_PORT=5433\n')
    await loadEnvFile(envPath)
    expect(process.env.TEST_LOADER_HOST).toBe('staging.example.com')
    expect(process.env.TEST_LOADER_PORT).toBe('5433')
  })

  test('should not overwrite existing env vars', async () => {
    process.env.TEST_LOADER_EXISTING = 'original'
    const envPath = join(TMP_DIR, '.env.test')
    await Bun.file(envPath).write('TEST_LOADER_EXISTING=overwritten\n')
    await loadEnvFile(envPath)
    expect(process.env.TEST_LOADER_EXISTING).toBe('original')
  })

  test('should skip comments and empty lines', async () => {
    const envPath = join(TMP_DIR, '.env.test')
    await Bun.file(envPath).write('# comment\n\nTEST_LOADER_HOST=localhost\n  # another comment\n')
    await loadEnvFile(envPath)
    expect(process.env.TEST_LOADER_HOST).toBe('localhost')
  })

  test('should handle quoted values', async () => {
    const envPath = join(TMP_DIR, '.env.test')
    await Bun.file(envPath).write('TEST_LOADER_QUOTED="hello world"\n')
    await loadEnvFile(envPath)
    expect(process.env.TEST_LOADER_QUOTED).toBe('hello world')
  })

  test('should handle single-quoted values', async () => {
    const envPath = join(TMP_DIR, '.env.test')
    await Bun.file(envPath).write("TEST_LOADER_QUOTED='hello world'\n")
    await loadEnvFile(envPath)
    expect(process.env.TEST_LOADER_QUOTED).toBe('hello world')
  })

  test('should handle password with special characters', async () => {
    const envPath = join(TMP_DIR, '.env.test')
    await Bun.file(envPath).write('TEST_LOADER_PASSWORD=p@ss=w0rd#123\n')
    await loadEnvFile(envPath)
    expect(process.env.TEST_LOADER_PASSWORD).toBe('p@ss=w0rd#123')
  })

  test('should throw if file does not exist', async () => {
    const envPath = join(TMP_DIR, '.env.nonexistent')
    expect(loadEnvFile(envPath)).rejects.toThrow('找不到 env 檔案')
  })
})
