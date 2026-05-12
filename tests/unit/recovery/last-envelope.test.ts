import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  writeLastEnvelope,
  readLastEnvelope,
  sanitizeCommandSummary,
  LAST_ENVELOPE_PATH,
} from '@/core/recovery/last-envelope'
import type { RecoveryEnvelope } from '@/core/recovery'

let workspace = ''

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'dbcli-last-envelope-'))
})

afterEach(async () => {
  if (workspace) await rm(workspace, { recursive: true, force: true })
})

const ENV: RecoveryEnvelope = {
  schemaVersion: 1,
  generatedAt: '2026-05-10T11:23:45.000Z',
  ok: false,
  error: { code: 'CONFIG_MISSING', category: 'config', message: 'No config' },
  recovery: [],
}

describe('writeLastEnvelope / readLastEnvelope', () => {
  test('writes a SavedRecoveryEnvelope to .dbcli/last-recovery.json', async () => {
    await writeLastEnvelope(workspace, ENV, ['dbcli', 'query', 'SELECT 1', '--recovery'])
    const raw = await readFile(join(workspace, LAST_ENVELOPE_PATH), 'utf8')
    const parsed = JSON.parse(raw)
    expect(parsed.schemaVersion).toBe(1)
    expect(parsed.savedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(parsed.command).toBe('dbcli query <sql> --recovery')
    expect(parsed.cwd).toBe(workspace)
    expect(parsed.envelope.error.code).toBe('CONFIG_MISSING')
  })

  test('readLastEnvelope round-trips the saved file', async () => {
    await writeLastEnvelope(workspace, ENV, ['dbcli', 'q', '@foo', '--recovery'])
    const back = await readLastEnvelope(workspace)
    expect(back?.envelope.error.code).toBe('CONFIG_MISSING')
    expect(back?.command).toBe('dbcli q @foo --recovery')
  })

  test('readLastEnvelope returns null when file absent', async () => {
    const back = await readLastEnvelope(workspace)
    expect(back).toBeNull()
  })

  test('writeLastEnvelope creates .dbcli/ if missing', async () => {
    await writeLastEnvelope(workspace, ENV, ['dbcli', 'inspect'])
    const back = await readLastEnvelope(workspace)
    expect(back).not.toBeNull()
  })

  test('writeLastEnvelope is best-effort (no throw on permission failure)', async () => {
    // Simulate by passing a nonexistent parent that cannot be created.
    const bad = '/proc/this/path/should/not/exist/dbcli'
    await expect(writeLastEnvelope(bad, ENV, ['dbcli'])).resolves.toBeUndefined()
  })

  test('saved envelope command omits raw SQL and parameter secrets', async () => {
    await writeLastEnvelope(workspace, ENV, [
      'dbcli',
      'query',
      "SELECT * FROM users WHERE api_key = 'sk-test-secret'",
      '--param',
      'token=secret',
      '--format',
      'json',
      '--recovery',
    ])
    const raw = await readFile(join(workspace, LAST_ENVELOPE_PATH), 'utf8')
    expect(raw).not.toContain('sk-test-secret')
    expect(raw).not.toContain('token=secret')
    expect(JSON.parse(raw).command).toBe(
      'dbcli query <sql> --param <redacted> --format json --recovery'
    )
  })
})

describe('sanitizeCommandSummary', () => {
  test('replaces SQL positional with <sql>', () => {
    expect(sanitizeCommandSummary(['dbcli', 'query', 'SELECT * FROM users'])).toBe(
      'dbcli query <sql>'
    )
  })

  test('replaces --where / --set / --data values with <redacted>', () => {
    expect(
      sanitizeCommandSummary(['dbcli', 'update', 'orders', '--where', 'id=1', '--set', '{"a":"b"}'])
    ).toBe('dbcli update orders --where <redacted> --set <redacted>')
  })

  test('replaces --param value with <redacted>', () => {
    expect(sanitizeCommandSummary(['dbcli', 'q', '@foo', '--param', 'token=secret'])).toBe(
      'dbcli q @foo --param <redacted>'
    )
  })

  test('keeps benign flags (--format, --dry-run, --recovery, --for-agent)', () => {
    expect(
      sanitizeCommandSummary(['dbcli', 'query', 'SELECT 1', '--format', 'json', '--recovery'])
    ).toBe('dbcli query <sql> --format json --recovery')
  })

  test('redacts inline --config and --param values', () => {
    expect(
      sanitizeCommandSummary([
        'dbcli',
        'q',
        '@diag/secret',
        '--config=/tmp/project/.dbcli/config.json',
        '--param=apiKey=secret',
      ])
    ).toBe('dbcli q @diag/secret --config <redacted> --param <redacted>')
  })

  test('redacts SQL export body while preserving benign output format', () => {
    expect(
      sanitizeCommandSummary([
        'dbcli',
        'export',
        "SELECT * FROM users WHERE token = 'secret'",
        '--format',
        'csv',
        '--recovery',
      ])
    ).toBe('dbcli export <sql> --format csv --recovery')
  })

  test('returns "<unknown>" for empty argv', () => {
    expect(sanitizeCommandSummary([])).toBe('<unknown>')
  })
})
