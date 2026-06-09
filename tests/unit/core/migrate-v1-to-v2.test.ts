import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { join } from 'path'
import { migrateV1ToV2 } from '@/core/config-v2-mutations'
import { writeV2Config, readV2Config, resolveConnection, loadConnectionEnv } from '@/core/config-v2'
import { writeProjectBinding, getProjectStoragePath } from '@/core/config-binding'
import type { DbcliConfig } from '@/utils/validation'

const TMP_DIR = '/tmp/dbcli-migrate-test'
const PROJECT = join(TMP_DIR, '.dbcli')

function v1(): DbcliConfig {
  return {
    connection: { system: 'mariadb', host: 'localhost', port: 3306, user: 'root', password: '', database: 'app' },
    permission: 'query-only',
    schema: {},
    metadata: { version: '1.0' },
    blacklist: { tables: ['secrets'], columns: { users: ['ssn'] } },
    audit: { enabled: true, rotation: { max_bytes: 10485760, max_entries: 1000 } },
  } as DbcliConfig
}

describe('migrateV1ToV2', () => {
  test('produces a valid v2 with a single "default" connection', () => {
    const out = migrateV1ToV2(v1())
    expect(out.version).toBe(2)
    expect(out.default).toBe('default')
    expect(Object.keys(out.connections)).toEqual(['default'])
    expect(out.connections.default.system).toBe('mariadb')
    expect(out.connections.default.host).toBe('localhost')
    expect(out.connections.default.password).toEqual({ $env: 'DB_PASSWORD' })
    expect(out.connections.default.envFile).toBe('.env.local')
    expect(out.connections.default.permission).toBe('query-only')
  })

  test('carries over blacklist / audit / metadata', () => {
    const out = migrateV1ToV2(v1())
    expect(out.blacklist).toEqual({ tables: ['secrets'], columns: { users: ['ssn'] } })
    expect(out.audit.enabled).toBe(true)
  })

  test('migrated config + legacy .env.local round-trips the password', async () => {
    await Bun.$`rm -rf ${TMP_DIR}`
    await Bun.$`mkdir -p ${PROJECT}`
    const storagePath = getProjectStoragePath(PROJECT)
    await writeProjectBinding(PROJECT, storagePath)
    await Bun.write(join(storagePath, '.env.local'), 'DB_PASSWORD=legacy-pw\n')

    await writeV2Config(PROJECT, migrateV1ToV2(v1()))

    const cfg = await readV2Config(PROJECT)
    const resolved = resolveConnection(cfg, 'default')
    await loadConnectionEnv(resolved, storagePath)
    expect(process.env.DB_PASSWORD).toBe('legacy-pw')
  })

  test('throws on a non-SQL v1 connection (out of scope)', () => {
    const mongoV1 = { ...v1(), connection: { system: 'mongodb', host: 'h', port: 27017, user: 'u', database: 'd', password: '' } } as DbcliConfig
    expect(() => migrateV1ToV2(mongoV1)).toThrow('僅支援 SQL')
  })

  afterEach(async () => {
    await Bun.$`rm -rf ${TMP_DIR}`
    delete process.env.DB_PASSWORD
  })
  beforeEach(async () => { delete process.env.DB_PASSWORD })
})
