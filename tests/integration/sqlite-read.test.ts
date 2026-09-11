/**
 * SQLite 讀取路徑（DBCLI-034）
 *
 * 這組測試不需要任何服務：SQLite 是唯一能在沒有 docker 的機器上跑完整合
 * 測試的引擎，所以刻意不掛 SKIP_INTEGRATION_TESTS 閘門。臨時檔建在測試自己
 * 的目錄裡並在結束時刪除——ADR-0038 排除了 `:memory:`，測試不得偷用。
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Database } from 'bun:sqlite'
import { SQLiteAdapter } from '@/adapters/sqlite-adapter'
import { ConnectionError, type ConnectionOptions } from '@/adapters/types'
import { QueryExecutor } from '@/core/query-executor'
import { BlacklistManager } from '@/core/blacklist-manager'
import { BlacklistValidator } from '@/core/blacklist-validator'
import type { DbcliConfig } from '@/types'

let workDir: string
let dbPath: string

function options(overrides: Partial<ConnectionOptions> = {}): ConnectionOptions {
  return {
    system: 'sqlite',
    file: dbPath,
    host: '',
    port: 0,
    user: '',
    password: '',
    database: '',
    ...overrides,
  } as ConnectionOptions
}

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'dbcli-sqlite-read-'))
  dbPath = join(workDir, 'app.sqlite')

  const seed = new Database(dbPath, { create: true })
  seed.run(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL,
      nickname TEXT,
      score REAL DEFAULT 0
    )
  `)
  seed.run(`CREATE TABLE orders (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id)
  )`)
  seed.run(`CREATE VIEW active_users AS SELECT id, email FROM users`)
  const insert = seed.prepare('INSERT INTO users (email, nickname) VALUES (?, ?)')
  for (let i = 0; i < 1500; i++) insert.run(`user${i}@example.com`, i % 2 === 0 ? `n${i}` : null)
  seed.close()
})

afterAll(async () => {
  await rm(workDir, { recursive: true, force: true })
})

describe('SQLiteAdapter 讀取', () => {
  test('列出 table 與 view，排除 sqlite_ 內部表', async () => {
    const adapter = new SQLiteAdapter(options())
    await adapter.connect()
    try {
      const tables = await adapter.listTables()
      const names = tables.map((t) => t.name).sort()

      expect(names).toEqual(['active_users', 'orders', 'users'])
      expect(names.some((n) => n.startsWith('sqlite_'))).toBe(false)

      const users = tables.find((t) => t.name === 'users')
      expect(users?.tableType).toBe('table')
      expect(users?.columnCount).toBe(4)
      expect(tables.find((t) => t.name === 'active_users')?.tableType).toBe('view')
    } finally {
      await adapter.disconnect()
    }
  })

  test('讀出單一 table 的欄位、型別、nullable 與主鍵', async () => {
    const adapter = new SQLiteAdapter(options())
    await adapter.connect()
    try {
      const schema = await adapter.getTableSchema('users')
      const byName = new Map(schema.columns.map((c) => [c.name, c]))

      expect(schema.columns.map((c) => c.name)).toEqual(['id', 'email', 'nickname', 'score'])
      expect(byName.get('id')?.primaryKey).toBe(true)
      expect(byName.get('id')?.autoIncrement).toBe(true)
      expect(byName.get('email')?.nullable).toBe(false)
      expect(byName.get('nickname')?.nullable).toBe(true)
      expect(byName.get('score')?.type.toUpperCase()).toBe('REAL')
      expect(byName.get('score')?.default).toBe('0')
    } finally {
      await adapter.disconnect()
    }
  })

  test('回報外鍵', async () => {
    const adapter = new SQLiteAdapter(options())
    await adapter.connect()
    try {
      const schema = await adapter.getTableSchema('orders')
      const userId = schema.columns.find((c) => c.name === 'user_id')
      expect(userId?.foreignKey).toEqual({ table: 'users', column: 'id' })
    } finally {
      await adapter.disconnect()
    }
  })

  test('執行參數化查詢', async () => {
    const adapter = new SQLiteAdapter(options())
    await adapter.connect()
    try {
      const result = await adapter.execute<{ email: string }>(
        'SELECT email FROM users WHERE email = ?',
        ['user7@example.com']
      )
      expect(result.rows).toHaveLength(1)
      expect(result.rows[0]?.email).toBe('user7@example.com')
      expect(result.columnNames).toEqual(['email'])
    } finally {
      await adapter.disconnect()
    }
  })

  test('回報 server version', async () => {
    const adapter = new SQLiteAdapter(options())
    await adapter.connect()
    try {
      expect(await adapter.getServerVersion()).toMatch(/^3\./)
    } finally {
      await adapter.disconnect()
    }
  })

  test('testConnection 只用唯讀通道', async () => {
    const adapter = new SQLiteAdapter(options())
    await adapter.connect()
    try {
      expect(await adapter.testConnection()).toBe(true)
    } finally {
      await adapter.disconnect()
    }
  })
})

describe('SQLiteAdapter 連線失敗', () => {
  test('檔案不存在時失敗，且不建立檔案', async () => {
    const missing = join(workDir, 'nope', 'absent.sqlite')
    const adapter = new SQLiteAdapter(options({ file: missing }))

    let thrown: unknown
    try {
      await adapter.connect()
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(ConnectionError)
    expect((thrown as ConnectionError).message).toContain(missing)
    expect(await Bun.file(missing).exists()).toBe(false)
  })

  test('目標不是 SQLite 資料庫時說出來', async () => {
    const notADb = join(workDir, 'passwd-like.txt')
    await writeFile(notADb, 'root:x:0:0:root:/root:/bin/sh\n')
    const adapter = new SQLiteAdapter(options({ file: notADb }))

    let thrown: unknown
    try {
      await adapter.connect()
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(ConnectionError)
    expect((thrown as ConnectionError).message).toMatch(/SQLite/i)
  })
})

describe('經由 QueryExecutor 的讀取路徑', () => {
  function makeConfig(blacklist: unknown): DbcliConfig {
    return {
      connection: {
        system: 'sqlite',
        file: dbPath,
        host: '',
        port: 0,
        user: '',
        password: '',
        database: '',
      },
      permission: 'query-only',
      blacklist,
    } as unknown as DbcliConfig
  }

  type ExecutorConfig = ConstructorParameters<typeof QueryExecutor>[3]

  /** QueryExecutor 要的是完整設定物件，測試只填它讀得到的欄位。 */
  function executorConfig(blacklist: unknown): ExecutorConfig {
    return makeConfig(blacklist) as unknown as ExecutorConfig
  }

  test('query-only 自動套上 LIMIT 1000，與其他 SQL 引擎相同', async () => {
    const adapter = new SQLiteAdapter(options())
    await adapter.connect()
    try {
      const executor = new QueryExecutor(
        adapter,
        'query-only',
        undefined,
        executorConfig(undefined),
        {
          dialect: 'sqlite',
        }
      )
      const result = await executor.execute('SELECT id FROM users')
      expect(result.rows).toHaveLength(1000)
    } finally {
      await adapter.disconnect()
    }
  })

  test('使用者自己寫的 LIMIT 不被覆蓋', async () => {
    const adapter = new SQLiteAdapter(options())
    await adapter.connect()
    try {
      const executor = new QueryExecutor(
        adapter,
        'query-only',
        undefined,
        executorConfig(undefined),
        {
          dialect: 'sqlite',
        }
      )
      const result = await executor.execute('SELECT id FROM users LIMIT 3')
      expect(result.rows).toHaveLength(3)
    } finally {
      await adapter.disconnect()
    }
  })

  test('黑名單欄位在 SQLite 結果中被遮蔽', async () => {
    const adapter = new SQLiteAdapter(options())
    await adapter.connect()
    try {
      const config = makeConfig({ tables: [], columns: { users: ['email'] } })
      const validator = new BlacklistValidator(new BlacklistManager(config))
      const executor = new QueryExecutor(adapter, 'query-only', validator, executorConfig(config), {
        dialect: 'sqlite',
      })
      const result = await executor.execute('SELECT id, email FROM users LIMIT 1')

      expect(result.rows[0]).toHaveProperty('id')
      expect(result.rows[0]).not.toHaveProperty('email')
    } finally {
      await adapter.disconnect()
    }
  })

  test('黑名單 table 被拒絕', async () => {
    const adapter = new SQLiteAdapter(options())
    await adapter.connect()
    try {
      const config = makeConfig({ tables: ['users'], columns: {} })
      const validator = new BlacklistValidator(new BlacklistManager(config))
      const executor = new QueryExecutor(adapter, 'query-only', validator, executorConfig(config), {
        dialect: 'sqlite',
      })
      await expect(executor.execute('SELECT id FROM users LIMIT 1')).rejects.toThrow()
    } finally {
      await adapter.disconnect()
    }
  })
})
