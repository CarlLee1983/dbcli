/**
 * writeAuditEntry — unit tests for Phase 25 D-J / D-K return-id contract
 * and recovery_ref pass-through.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { writeAuditEntry } from '@/core/audit/integration-helper'
import type { DbcliConfig } from '@/utils/validation'

function makeConfig(enabled: boolean): DbcliConfig {
  return {
    connection: {
      system: 'postgresql',
      host: 'localhost',
      port: 5432,
      user: 'u',
      password: 'p',
      database: 'd',
    },
    permission: 'query-only',
    schema: {},
    metadata: { version: '1.0' },
    blacklist: { tables: [], columns: {} },
    audit: { strict: false, enabled, rotation: { max_bytes: 10_485_760, max_entries: 1000 } },
  } as DbcliConfig
}

describe('writeAuditEntry return value (Phase 25 D-K)', () => {
  let workDir: string

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'dbcli-test-25-02-'))
    await mkdir(join(workDir, '.dbcli'), { recursive: true })
  })

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true })
  })

  test('returns a UUID string on success when audit is enabled', async () => {
    const config = makeConfig(true)
    const id = await writeAuditEntry(
      config,
      'query',
      { config: workDir },
      { success: true, target: 'users' }
    )
    expect(id).not.toBeNull()
    expect(typeof id).toBe('string')
    expect(id!).toMatch(/^[0-9a-f-]{36}$/)
  })

  test('returns null when audit is disabled (CONFIG-02)', async () => {
    const config = makeConfig(false)
    const id = await writeAuditEntry(
      config,
      'query',
      { config: workDir },
      { success: true, target: 'users' }
    )
    expect(id).toBeNull()
  })

  test('persists recovery_ref onto the audit entry when provided (D-J)', async () => {
    const config = makeConfig(true)
    const ref = 'f47ac10b-58cc-4372-a567-0e02b2c3d479'
    const id = await writeAuditEntry(
      config,
      'query',
      { config: workDir },
      { success: false, target: 'users', error: new Error('boom'), recovery_ref: ref }
    )
    expect(id).not.toBeNull()
    const file = join(workDir, '.dbcli', 'audit', 'default.jsonl')
    const raw = await Bun.file(file).text()
    const last = JSON.parse(raw.trim().split('\n').pop()!) as { recovery_ref?: string }
    expect(last.recovery_ref).toBe(ref)
  })

  test('omits recovery_ref on disk when not supplied', async () => {
    const config = makeConfig(true)
    const id = await writeAuditEntry(
      config,
      'query',
      { config: workDir },
      { success: true, target: 'users' }
    )
    expect(id).not.toBeNull()
    const file = join(workDir, '.dbcli', 'audit', 'default.jsonl')
    const raw = await Bun.file(file).text()
    const last = JSON.parse(raw.trim().split('\n').pop()!)
    expect('recovery_ref' in last).toBe(false)
  })

  test('return-ignoring callers continue to work (backward compat for 17 existing call sites)', async () => {
    const config = makeConfig(true)
    // No `const id = await ...` — drop the result, matching the pattern at
    // src/commands/inspect.ts:63 and the other 16 pre-Phase-25 sites.
    await writeAuditEntry(config, 'query', { config: workDir }, { success: true, target: 'users' })
    expect(true).toBe(true)
  })

  test('explicit connection context selects the per-connection audit file', async () => {
    const config = makeConfig(true)
    await writeAuditEntry(
      config,
      'query',
      { config: workDir, connectionName: 'staging' },
      { success: true, target: 'users' }
    )

    expect(await Bun.file(join(workDir, '.dbcli', 'audit', 'staging.jsonl')).exists()).toBe(true)
    expect(await Bun.file(join(workDir, '.dbcli', 'audit', 'default.jsonl')).exists()).toBe(false)
  })

  test('runtime resolved connection identity selects the per-connection audit file', async () => {
    const config = {
      ...makeConfig(true),
      effectiveConnectionName: 'staging',
    }
    await writeAuditEntry(config, 'query', { config: workDir }, { success: true, target: 'users' })

    expect(await Bun.file(join(workDir, '.dbcli', 'audit', 'staging.jsonl')).exists()).toBe(true)
    expect(await Bun.file(join(workDir, '.dbcli', 'audit', 'default.jsonl')).exists()).toBe(false)
  })

  test('persists resolved connection and environment identity without credentials', async () => {
    const config = {
      ...makeConfig(true),
      effectiveConnectionName: 'production',
      effectiveEnvironment: 'production',
    }
    await writeAuditEntry(config, 'query', { config: workDir }, { success: true, target: 'users' })

    const raw = await Bun.file(join(workDir, '.dbcli', 'audit', 'production.jsonl')).text()
    const last = JSON.parse(raw.trim().split('\n').pop()!)
    expect(last.metadata).toMatchObject({
      connection_name: 'production',
      environment: 'production',
    })
    expect(JSON.stringify(last.metadata)).not.toContain('localhost')
    expect(JSON.stringify(last.metadata)).not.toContain('password')
  })
})
