/**
 * Schema path isolation: resolved connection name for V2 .dbcli/config.json
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { setGlobalConnectionName, getSchemaIsolationConnectionName } from '@/core/config'
import { join } from 'path'

const TMP_DIR = '/tmp/dbcli-schema-isolation-name-test'

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
  const configPath = join(TMP_DIR, '.dbcli')

  beforeEach(async () => {
    setGlobalConnectionName(undefined)
    await Bun.$`mkdir -p ${configPath}`
    await Bun.file(join(configPath, 'config.json')).write(JSON.stringify(V2_CONFIG, null, 2))
  })

  afterEach(async () => {
    setGlobalConnectionName(undefined)
    await Bun.$`rm -rf ${TMP_DIR}`
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
