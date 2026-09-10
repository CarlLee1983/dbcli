import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { migrateV1ToV2 } from '@/core/config-v2-mutations'
import { writeV2Config, readV2Config, resolveConnection, loadConnectionEnv } from '@/core/config-v2'
import { writeProjectBinding, getProjectStoragePath } from '@/core/config-binding'
import type { DbcliConfig } from '@/utils/validation'

let tempDirectory: string
let projectPath: string

function v1(): DbcliConfig {
  return {
    connection: {
      system: 'mariadb',
      host: 'localhost',
      port: 3306,
      user: 'root',
      password: '',
      database: 'app',
    },
    permission: 'query-only',
    schema: {},
    metadata: { version: '1.0' },
    blacklist: { tables: ['secrets'], columns: { users: ['ssn'] } },
    audit: { strict: false, enabled: true, rotation: { max_bytes: 10485760, max_entries: 1000 } },
  } as DbcliConfig
}

describe('migrateV1ToV2', () => {
  test('produces a valid v2 with a single "default" connection', () => {
    const out = migrateV1ToV2(v1())
    expect(out.version).toBe(2)
    expect(out.default).toBe('default')
    expect(Object.keys(out.connections)).toEqual(['default'])
    expect(out.connections.default!.system).toBe('mariadb')
    expect(out.connections.default!.host).toBe('localhost')
    expect(out.connections.default!.password).toEqual({ $env: 'DB_PASSWORD' })
    expect(out.connections.default!.envFile).toBe('.env.local')
    expect(out.connections.default!.permission).toBe('query-only')
  })

  test('carries over blacklist / audit / metadata', () => {
    const out = migrateV1ToV2(v1())
    expect(out.blacklist).toEqual({ tables: ['secrets'], columns: { users: ['ssn'] } })
    expect(out.audit.enabled).toBe(true)
  })

  test('migrated config + legacy .env.local round-trips the password', async () => {
    const storagePath = getProjectStoragePath(projectPath)
    await writeProjectBinding(projectPath, storagePath)
    await Bun.write(join(storagePath, '.env.local'), 'DB_PASSWORD=legacy-pw\n')

    await writeV2Config(projectPath, migrateV1ToV2(v1()))

    const cfg = await readV2Config(projectPath)
    const resolved = resolveConnection(cfg, 'default')
    await loadConnectionEnv(resolved, storagePath)
    expect(process.env.DB_PASSWORD).toBe('legacy-pw')
  })

  /**
   * 訊息改寫了，行為沒有（DBCLI-036 / AC-013）。原本斷言的字串是「僅支援 SQL」，
   * 而 DBCLI-034 把 SQLite 歸類成 SQL 之後，那句話對 SQLite 就是假的。閘門本身
   * 讀的是 `SQL_SYSTEMS` 這個三成員陣列，不是 `SqlDatabaseSystem`，所以拒絕的
   * 對象一格都沒變。
   */
  test.each([
    ['mongodb', 27017],
    ['redis', 6379],
    ['elasticsearch', 9200],
  ])('throws on a non-SQL v1 %s connection (out of scope)', (system, port) => {
    const nonSqlV1 = {
      ...v1(),
      connection: { system, host: 'h', port, user: 'u', database: 'd', password: '' },
    } as DbcliConfig
    expect(() => migrateV1ToV2(nonSqlV1)).toThrow(`不支援 '${system}'`)
    expect(() => migrateV1ToV2(nonSqlV1)).toThrow('mysql/postgresql/mariadb')
  })

  /**
   * AC-010：SQLite 仍然被拒，但理由換了。
   *
   * 這一格是這張 Story 唯一「不改行為卻必須改」的地方。閘門沒有停止拒絕
   * SQLite，只是它給的理由——「僅支援 SQL 連線」——在 DBCLI-034 之後變成一句
   * 假話：SQLite 在 dbcli 自己的詞彙裡就是 SQL 連線。真正的理由是 v1 這個格式
   * 早於這個引擎，所以任何 v1 設定都不可能誠實地寫著 sqlite。
   */
  describe('a v1 configuration naming sqlite', () => {
    const sqliteV1 = () =>
      ({
        ...v1(),
        connection: { system: 'sqlite', file: '/tmp/app.sqlite' },
      }) as unknown as DbcliConfig

    test('is refused', () => {
      expect(() => migrateV1ToV2(sqliteV1())).toThrow()
    })

    test('is refused for predating the engine, and names v1', () => {
      expect(() => migrateV1ToV2(sqliteV1())).toThrow(/v1/)
      expect(() => migrateV1ToV2(sqliteV1())).toThrow(/早於/)
    })

    test('does not claim SQLite is not a SQL connection', () => {
      let message = ''
      try {
        migrateV1ToV2(sqliteV1())
      } catch (error) {
        message = (error as Error).message
      }
      expect(message).not.toMatch(/僅支援 SQL/)
      expect(message).toMatch(/dbcli init --system sqlite/)
    })
  })

  afterEach(async () => {
    await rm(getProjectStoragePath(projectPath), { recursive: true, force: true })
    await rm(tempDirectory, { recursive: true, force: true })
    delete process.env.DB_PASSWORD
  })
  beforeEach(async () => {
    tempDirectory = await mkdtemp(join(tmpdir(), 'dbcli-migrate-test-'))
    projectPath = join(tempDirectory, '.dbcli')
    await mkdir(projectPath, { recursive: true })
    delete process.env.DB_PASSWORD
  })
})
