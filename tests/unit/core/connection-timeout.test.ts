/**
 * 連線逾時可設定性
 *
 * 動機：所有 adapter 都吃 ConnectionOptions.timeout，但先前沒有任何
 * 設定欄位或 CLI flag 餵得進去，MongoDB 固定 5000ms 的 server selection
 * 逾時在跨 VPN / Atlas 場景太緊。
 *
 * 邊界：`--timeout` 是單次執行的覆寫，必須在 adapter 生成時才套用。
 * 若在 configModule.read() 就注入，read → 改欄位 → write 的指令
 * （blacklist / init / schema）會把它永久寫進 config.json。
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  NamedConnectionSchema,
  ConnectionConfigSchema,
  parseTimeoutOption,
  MIN_CONNECTION_TIMEOUT_MS,
} from '@/utils/validation'
import {
  resolveConnectionTimeout,
  setGlobalConnectionTimeout,
  getGlobalConnectionTimeout,
} from '@/utils/connection-timeout'
import { configModule } from '@/core/config'
import { AdapterFactory } from '@/adapters/factory'

describe('connection timeout', () => {
  afterEach(() => {
    setGlobalConnectionTimeout(undefined)
  })

  describe('設定檔欄位', () => {
    test('MongoDB 連線接受 timeout（毫秒）', () => {
      const parsed = NamedConnectionSchema.parse({
        system: 'mongodb',
        host: 'localhost',
        port: 27017,
        database: 'db',
        timeout: 20000,
      })
      expect(parsed.timeout).toBe(20000)
    })

    test('SQL 連線同樣接受 timeout', () => {
      const parsed = ConnectionConfigSchema.parse({
        system: 'postgresql',
        host: 'localhost',
        port: 5432,
        user: 'u',
        password: 'p',
        database: 'db',
        timeout: 30000,
      })
      expect(parsed.timeout).toBe(30000)
    })

    test('拒絕低於下限的 timeout', () => {
      expect(() =>
        ConnectionConfigSchema.parse({
          system: 'postgresql',
          host: 'localhost',
          port: 5432,
          user: 'u',
          password: 'p',
          database: 'db',
          timeout: MIN_CONNECTION_TIMEOUT_MS - 1,
        })
      ).toThrow()
    })

    test('沒設定時不帶 timeout 欄位（由 adapter 決定預設）', () => {
      const parsed = ConnectionConfigSchema.parse({
        system: 'postgresql',
        host: 'localhost',
        port: 5432,
        user: 'u',
        password: 'p',
        database: 'db',
      })
      expect(parsed.timeout).toBeUndefined()
    })
  })

  describe('parseTimeoutOption', () => {
    test('接受正整數字串', () => {
      expect(parseTimeoutOption('20000')).toBe(20000)
    })

    test('拒絕 0、負數、非數字，並說明合法範圍', () => {
      expect(() => parseTimeoutOption('0')).toThrow(/timeout/i)
      expect(() => parseTimeoutOption('-1')).toThrow(/timeout/i)
      expect(() => parseTimeoutOption('abc')).toThrow(/timeout/i)
    })

    test('拒絕低於下限的值，避免每句查詢立刻逾時', () => {
      expect(() => parseTimeoutOption('1')).toThrow(/timeout/i)
    })

    test('拒絕超過上限的值', () => {
      expect(() => parseTimeoutOption('600001')).toThrow(/timeout/i)
    })
  })

  describe('resolveConnectionTimeout', () => {
    beforeEach(() => {
      setGlobalConnectionTimeout(undefined)
    })

    test('沒有全域覆寫時沿用設定檔的值', () => {
      expect(resolveConnectionTimeout(20000)).toBe(20000)
    })

    test('--timeout 覆寫設定檔的值', () => {
      setGlobalConnectionTimeout(45000)
      expect(resolveConnectionTimeout(20000)).toBe(45000)
    })

    test('兩者皆無時回傳 undefined，交由 adapter 預設', () => {
      expect(resolveConnectionTimeout(undefined)).toBeUndefined()
    })

    test('設回 undefined 就不再殘留上一次的覆寫', () => {
      setGlobalConnectionTimeout(45000)
      setGlobalConnectionTimeout(undefined)
      expect(getGlobalConnectionTimeout()).toBeUndefined()
      expect(resolveConnectionTimeout(undefined)).toBeUndefined()
    })
  })

  describe('adapter 生成時才套用', () => {
    const base = {
      host: 'localhost',
      user: 'u',
      password: 'p',
      database: 'db',
    }

    test('全域覆寫會傳進 SQL adapter', () => {
      setGlobalConnectionTimeout(45000)
      const options = { ...base, system: 'postgresql' as const, port: 5432 }
      const adapter = AdapterFactory.createAdapter({
        connection: options,
        blacklist: { tables: [], columns: {} },
      })
      expect((adapter as unknown as { options: { timeout?: number } }).options.timeout).toBe(45000)
    })

    test('全域覆寫會傳進 MongoDB adapter', () => {
      setGlobalConnectionTimeout(45000)
      const options = { ...base, system: 'mongodb' as const, port: 27017 }
      const adapter = AdapterFactory.createMongoDBAdapter({ connection: options })
      expect((adapter as unknown as { options: { timeout?: number } }).options.timeout).toBe(45000)
    })

    test('全域覆寫會傳進 Redis adapter', () => {
      setGlobalConnectionTimeout(45000)
      const options = { ...base, system: 'redis' as const, port: 6379 }
      const adapter = AdapterFactory.createRedisAdapter({ connection: options })
      expect((adapter as unknown as { options: { timeout?: number } }).options.timeout).toBe(45000)
    })

    test('沒有覆寫時沿用設定檔帶進來的值', () => {
      const options = { ...base, system: 'postgresql' as const, port: 5432, timeout: 12000 }
      const adapter = AdapterFactory.createAdapter({
        connection: options,
        blacklist: { tables: [], columns: {} },
      })
      expect((adapter as unknown as { options: { timeout?: number } }).options.timeout).toBe(12000)
    })

    test('不修改傳入的 options 物件', () => {
      setGlobalConnectionTimeout(45000)
      const options = { ...base, system: 'postgresql' as const, port: 5432 }
      AdapterFactory.createAdapter({
        connection: options,
        blacklist: { tables: [], columns: {} },
      })
      expect((options as { timeout?: number }).timeout).toBeUndefined()
    })
  })

  describe('不得汙染設定檔', () => {
    let projectDirectory: string

    beforeEach(async () => {
      projectDirectory = await mkdtemp(join(tmpdir(), 'dbcli-timeout-persist-'))
      await mkdir(join(projectDirectory, '.dbcli'), { recursive: true })
      await Bun.write(
        join(projectDirectory, '.dbcli', 'config.json'),
        JSON.stringify({
          connection: {
            system: 'postgresql',
            host: 'h',
            port: 5432,
            user: 'u',
            password: 'p',
            database: 'd',
          },
          permission: 'query-only',
        })
      )
    })

    afterEach(async () => {
      await rm(projectDirectory, { recursive: true, force: true })
    })

    test('configModule.read() 不把 --timeout 塞進連線設定', async () => {
      setGlobalConnectionTimeout(45000)
      const config = await configModule.read(join(projectDirectory, '.dbcli'))
      expect(config.connection.timeout).toBeUndefined()
    })

    test('read → write 之後 config.json 內不會出現 timeout', async () => {
      setGlobalConnectionTimeout(45000)
      const configPath = join(projectDirectory, '.dbcli')
      const config = await configModule.read(configPath)

      process.env.DBCLI_ALLOW_CONFIG_MUTATION = '1'
      try {
        await configModule.write(configPath, config)
      } finally {
        delete process.env.DBCLI_ALLOW_CONFIG_MUTATION
      }

      const onDisk = JSON.parse(await Bun.file(join(configPath, 'config.json')).text()) as {
        connection?: { timeout?: number }
      }
      expect(onDisk.connection?.timeout).toBeUndefined()
    })
  })
})
