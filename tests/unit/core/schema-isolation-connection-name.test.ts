/**
 * Schema path isolation: resolved connection name for V2 .dbcli/config.json
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { setGlobalConnectionName, getSchemaIsolationConnectionName } from '@/core/config'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let tempDirectory: string

const V2_CONFIG = {
  version: 2,
  default: 'primary',
  connections: {
    primary: {
      system: 'postgresql',
      host: 'primary.db.local',
      port: 5432,
      user: 'admin',
      password: 'primary-secret',
      database: 'app_db',
    },
    staging: {
      system: 'postgresql',
      host: 'staging.db.local',
      port: 5433,
      user: 'staging_user',
      password: 'staging-secret',
      database: 'staging_db',
    },
  },
  schema: {},
  metadata: { version: '2.0' },
}

describe('getSchemaIsolationConnectionName', () => {
  let configPath: string

  beforeEach(async () => {
    setGlobalConnectionName(undefined)
    tempDirectory = await mkdtemp(join(tmpdir(), 'dbcli-schema-isolation-name-test-'))
    configPath = join(tempDirectory, '.dbcli')
    await mkdir(configPath, { recursive: true })
    await Bun.file(join(configPath, 'config.json')).write(JSON.stringify(V2_CONFIG, null, 2))
  })

  afterEach(async () => {
    setGlobalConnectionName(undefined)
    await rm(tempDirectory, { recursive: true, force: true })
  })

  test('V2 + no --use → default connection name', async () => {
    setGlobalConnectionName(undefined)
    const name = await getSchemaIsolationConnectionName(configPath)
    expect(name).toBe('primary')
  })

  test('V2 + --use staging → staging', async () => {
    setGlobalConnectionName('staging')
    const name = await getSchemaIsolationConnectionName(configPath)
    expect(name).toBe('staging')
  })
})
