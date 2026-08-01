import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { loadEnvFile } from '@/agent-core/public'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let tempDirectory: string

describe('loadEnvFile', () => {
  beforeEach(async () => {
    tempDirectory = await mkdtemp(join(tmpdir(), 'dbcli-env-loader-test-'))
  })

  afterEach(async () => {
    await rm(tempDirectory, { recursive: true, force: true })
    delete process.env.TEST_LOADER_HOST
    delete process.env.TEST_LOADER_PORT
    delete process.env.TEST_LOADER_PASSWORD
    delete process.env.TEST_LOADER_QUOTED
    delete process.env.TEST_LOADER_EXISTING
    delete process.env.TEST_LOADER_EMPTY
    delete process.env.TEST_LOADER_URL
    delete process.env.TEST_LOADER_INLINE
    delete process.env.TEST_LOADER_CRLF
    delete process.env.TEST_LOADER_DUP
    delete process.env.TEST_LOADER_MISQUOTE
    delete process.env.TEST_LOADER_SPACED
    delete process.env.TEST_LOADER_LONG
    delete process.env['']
  })

  test('should load key=value pairs into process.env', async () => {
    const envPath = join(tempDirectory, '.env.test')
    await Bun.file(envPath).write('TEST_LOADER_HOST=staging.example.com\nTEST_LOADER_PORT=5433\n')
    await loadEnvFile(envPath)
    expect(process.env.TEST_LOADER_HOST).toBe('staging.example.com')
    expect(process.env.TEST_LOADER_PORT).toBe('5433')
  })

  test('should not overwrite existing env vars', async () => {
    process.env.TEST_LOADER_EXISTING = 'original'
    const envPath = join(tempDirectory, '.env.test')
    await Bun.file(envPath).write('TEST_LOADER_EXISTING=overwritten\n')
    await loadEnvFile(envPath)
    expect(process.env.TEST_LOADER_EXISTING).toBe('original')
  })

  test('should skip comments and empty lines', async () => {
    const envPath = join(tempDirectory, '.env.test')
    await Bun.file(envPath).write('# comment\n\nTEST_LOADER_HOST=localhost\n  # another comment\n')
    await loadEnvFile(envPath)
    expect(process.env.TEST_LOADER_HOST).toBe('localhost')
  })

  test('should handle quoted values', async () => {
    const envPath = join(tempDirectory, '.env.test')
    await Bun.file(envPath).write('TEST_LOADER_QUOTED="hello world"\n')
    await loadEnvFile(envPath)
    expect(process.env.TEST_LOADER_QUOTED).toBe('hello world')
  })

  test('should handle single-quoted values', async () => {
    const envPath = join(tempDirectory, '.env.test')
    await Bun.file(envPath).write("TEST_LOADER_QUOTED='hello world'\n")
    await loadEnvFile(envPath)
    expect(process.env.TEST_LOADER_QUOTED).toBe('hello world')
  })

  test('should handle password with special characters', async () => {
    const envPath = join(tempDirectory, '.env.test')
    await Bun.file(envPath).write('TEST_LOADER_PASSWORD=p@ss=w0rd#123\n')
    await loadEnvFile(envPath)
    expect(process.env.TEST_LOADER_PASSWORD).toBe('p@ss=w0rd#123')
  })

  test('should throw if file does not exist', async () => {
    const envPath = join(tempDirectory, '.env.nonexistent')
    expect(loadEnvFile(envPath)).rejects.toThrow('找不到 env 檔案')
  })

  test('empty value (KEY=) sets an empty string', async () => {
    const envPath = join(tempDirectory, '.env.test')
    await Bun.file(envPath).write('TEST_LOADER_EMPTY=\n')
    await loadEnvFile(envPath)
    expect(process.env.TEST_LOADER_EMPTY).toBe('')
  })

  test('value containing additional = signs preserves the right-hand side verbatim', async () => {
    const envPath = join(tempDirectory, '.env.test')
    // typical for connection strings / JWTs / base64 secrets
    await Bun.file(envPath).write('TEST_LOADER_URL=postgres://u:p=word@host:5432/db?ssl=true\n')
    await loadEnvFile(envPath)
    expect(process.env.TEST_LOADER_URL).toBe('postgres://u:p=word@host:5432/db?ssl=true')
  })

  test('inline `#` is NOT treated as a comment (kept inside value)', async () => {
    // Document current behaviour so a future change to strip inline comments
    // cannot silently truncate a real password that happens to contain '#'.
    const envPath = join(tempDirectory, '.env.test')
    await Bun.file(envPath).write('TEST_LOADER_INLINE=secret#notacomment\n')
    await loadEnvFile(envPath)
    expect(process.env.TEST_LOADER_INLINE).toBe('secret#notacomment')
  })

  test('CRLF line endings are tolerated and trimmed', async () => {
    const envPath = join(tempDirectory, '.env.test')
    await Bun.file(envPath).write('TEST_LOADER_CRLF=windows-value\r\n')
    await loadEnvFile(envPath)
    expect(process.env.TEST_LOADER_CRLF).toBe('windows-value')
  })

  test('duplicate keys: first occurrence wins (no-overwrite semantics)', async () => {
    // loadEnvFile only writes when process.env[key] is undefined, so within a
    // single file the *first* assignment sticks. This protects pre-set secrets
    // from being silently overridden by a later line in the same file.
    const envPath = join(tempDirectory, '.env.test')
    await Bun.file(envPath).write('TEST_LOADER_DUP=first\nTEST_LOADER_DUP=second\n')
    await loadEnvFile(envPath)
    expect(process.env.TEST_LOADER_DUP).toBe('first')
  })

  test('mismatched quotes are preserved verbatim (not stripped)', async () => {
    const envPath = join(tempDirectory, '.env.test')
    await Bun.file(envPath).write(`TEST_LOADER_MISQUOTE="oops'\n`)
    await loadEnvFile(envPath)
    expect(process.env.TEST_LOADER_MISQUOTE).toBe(`"oops'`)
  })

  test('keys are trimmed but values keep leading whitespace after `=`', async () => {
    // Documents current parser behaviour: parser only `slice(eqIndex + 1)` for value,
    // so `KEY = value` yields value of ` value`. Quoting is the recommended fix.
    const envPath = join(tempDirectory, '.env.test')
    await Bun.file(envPath).write('TEST_LOADER_SPACED   = padded\n')
    await loadEnvFile(envPath)
    expect(process.env.TEST_LOADER_SPACED).toBe(' padded')
  })

  test('long secret-like values (>1KB with mixed bytes) round-trip safely', async () => {
    const envPath = join(tempDirectory, '.env.test')
    const value = 'A'.repeat(1024) + '!@#$%^&*()_+-=[]{}|;:,.<>?/`~'
    await Bun.file(envPath).write(`TEST_LOADER_LONG=${value}\n`)
    await loadEnvFile(envPath)
    expect(process.env.TEST_LOADER_LONG).toBe(value)
  })
})
