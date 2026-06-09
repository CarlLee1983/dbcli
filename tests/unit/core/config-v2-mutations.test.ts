import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { join } from 'path'
import { writeV2Config, readV2Config, resolveConnection, loadConnectionEnv } from '@/core/config-v2'
import { writeProjectBinding, getProjectStoragePath } from '@/core/config-binding'
import { envVarNameFor, writeConnectionSecret, upsertConnection } from '@/core/config-v2-mutations'
import type { DbcliConfigV2 } from '@/utils/validation'

const TMP_DIR = '/tmp/dbcli-mutations-test'
const PROJECT = join(TMP_DIR, '.dbcli')

function baseConfig(): DbcliConfigV2 {
  return {
    version: 2,
    default: 'primary',
    connections: {
      primary: {
        system: 'mysql', host: 'localhost', port: 3306,
        user: 'root', password: { $env: 'DBCLI_PRIMARY_PASSWORD' },
        database: 'app', permission: 'query-only', envFile: '.env.primary',
      },
    },
    schema: {}, schemas: {},
    metadata: { version: '2.0' },
    blacklist: { tables: [], columns: {} },
    audit: { enabled: true, rotation: { max_bytes: 10485760, max_entries: 1000 } },
  } as DbcliConfigV2
}

describe('envVarNameFor', () => {
  test('namespaces by connection name, upper snake', () => {
    expect(envVarNameFor('primary', 'password')).toBe('DBCLI_PRIMARY_PASSWORD')
    expect(envVarNameFor('my-staging.db', 'password')).toBe('DBCLI_MY_STAGING_DB_PASSWORD')
  })
})

describe('writeConnectionSecret round-trip', () => {
  beforeEach(async () => {
    await Bun.$`rm -rf ${TMP_DIR}`
    await Bun.$`mkdir -p ${PROJECT}`
    await writeProjectBinding(PROJECT, getProjectStoragePath(PROJECT))
    await writeV2Config(PROJECT, baseConfig())
  })
  afterEach(async () => {
    await Bun.$`rm -rf ${TMP_DIR}`
    delete process.env.DBCLI_PRIMARY_PASSWORD
  })

  test('secret written under connection envFile resolves back through reader', async () => {
    await writeConnectionSecret(PROJECT, 'primary', 'password', 's3cret!')
    const cfg = await readV2Config(PROJECT)
    const resolved = resolveConnection(cfg, 'primary')
    const storagePath = getProjectStoragePath(PROJECT)
    await loadConnectionEnv(resolved, storagePath)
    expect(process.env.DBCLI_PRIMARY_PASSWORD).toBe('s3cret!')
  })

  test('rewrites existing var in place (no duplicate lines)', async () => {
    await writeConnectionSecret(PROJECT, 'primary', 'password', 'first')
    await writeConnectionSecret(PROJECT, 'primary', 'password', 'second')
    const envPath = join(getProjectStoragePath(PROJECT), '.env.primary')
    const text = await Bun.file(envPath).text()
    const lines = text.split('\n').filter((l) => l.startsWith('DBCLI_PRIMARY_PASSWORD='))
    expect(lines).toEqual(['DBCLI_PRIMARY_PASSWORD=second'])
  })

  test('throws on unknown connection', async () => {
    await expect(writeConnectionSecret(PROJECT, 'nope', 'password', 'x')).rejects.toThrow("連線 'nope' 不存在")
  })
})

describe('upsertConnection', () => {
  test('adds a new connection with literal non-secrets + {$env} password + envFile', () => {
    const next = upsertConnection(baseConfig(), {
      name: 'staging', system: 'postgresql', host: 'db.stg', port: 5432, user: 'app', database: 'app',
    })
    expect(next.connections.staging).toEqual({
      system: 'postgresql', host: 'db.stg', port: 5432, user: 'app', database: 'app',
      password: { $env: 'DBCLI_STAGING_PASSWORD' },
      permission: 'query-only',
      envFile: '.env.staging',
    })
    expect(next.connections.primary).toEqual(baseConfig().connections.primary)
    expect(next.default).toBe('primary')
  })

  test('does not mutate the input config (immutability)', () => {
    const input = baseConfig()
    upsertConnection(input, { name: 'staging', system: 'mysql', host: 'h', port: 3306, user: 'u', database: 'd' })
    expect(input.connections.staging).toBeUndefined()
  })

  test('edit preserves existing permission and overwrites fields', () => {
    const withRW = baseConfig()
    ;(withRW.connections.primary as { permission: string }).permission = 'read-write'
    const next = upsertConnection(withRW, {
      name: 'primary', system: 'mysql', host: 'newhost', port: 3307, user: 'root', database: 'app2',
    })
    expect(next.connections.primary.permission).toBe('read-write')
    expect(next.connections.primary.host).toBe('newhost')
    expect(next.connections.primary.port).toBe(3307)
  })
})
