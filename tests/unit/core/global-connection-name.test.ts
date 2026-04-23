/**
 * 測試全域 --use 選項串接至 configModule.read()
 *
 * 驗證 setGlobalConnectionName / getGlobalConnectionName 的行為，
 * 以及 configModule.read() 正確使用 effectiveConnectionName。
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { setGlobalConnectionName, getGlobalConnectionName, configModule } from '@/core/config'
import { join } from 'path'

const TMP_DIR = '/tmp/dbcli-global-conn-test'

// V2 config fixture，含兩個 named connection
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

describe('全域連線名稱（--use 串接）', () => {
  beforeEach(async () => {
    // 重設全域狀態
    setGlobalConnectionName(undefined)
    await Bun.$`mkdir -p ${TMP_DIR}/.dbcli`
  })

  afterEach(async () => {
    setGlobalConnectionName(undefined)
    await Bun.$`rm -rf ${TMP_DIR}`
  })

  describe('setGlobalConnectionName / getGlobalConnectionName', () => {
    test('預設值應為 undefined', () => {
      expect(getGlobalConnectionName()).toBeUndefined()
    })

    test('設定後應可取得相同值', () => {
      setGlobalConnectionName('staging')
      expect(getGlobalConnectionName()).toBe('staging')
    })

    test('設定為 undefined 應可清除', () => {
      setGlobalConnectionName('staging')
      setGlobalConnectionName(undefined)
      expect(getGlobalConnectionName()).toBeUndefined()
    })
  })

  describe('configModule.read() 使用全域連線名稱', () => {
    const configPath = join(TMP_DIR, '.dbcli')

    beforeEach(async () => {
      await Bun.file(join(configPath, 'config.json')).write(JSON.stringify(V2_CONFIG, null, 2))
    })

    test('未設定 --use 時應使用 default connection（primary）', async () => {
      setGlobalConnectionName(undefined)
      const config = await configModule.read(configPath)
      expect(config.connection.host).toBe('primary.db.local')
      expect(config.connection.port).toBe(5432)
    })

    test('設定全域 --use staging 後應使用 staging connection', async () => {
      setGlobalConnectionName('staging')
      const config = await configModule.read(configPath)
      expect(config.connection.host).toBe('staging.db.local')
      expect(config.connection.port).toBe(5433)
      expect(config.connection.database).toBe('staging_db')
    })

    test('明確傳入 connectionName 應優先於全域設定', async () => {
      setGlobalConnectionName('staging')
      // 明確傳入 primary，應覆蓋全域的 staging
      const config = await configModule.read(configPath, 'primary')
      expect(config.connection.host).toBe('primary.db.local')
    })

    test('全域 --use 切換後再次呼叫應使用新值', async () => {
      setGlobalConnectionName('primary')
      const config1 = await configModule.read(configPath)
      expect(config1.connection.host).toBe('primary.db.local')

      setGlobalConnectionName('staging')
      const config2 = await configModule.read(configPath)
      expect(config2.connection.host).toBe('staging.db.local')
    })
  })
})
