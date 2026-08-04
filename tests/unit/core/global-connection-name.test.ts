/**
 * 測試全域 --use 選項串接至 configModule.read()
 *
 * 驗證 setGlobalConnectionName / getGlobalConnectionName 的行為，
 * 以及 configModule.read() 正確使用 effectiveConnectionName。
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { setGlobalConnectionName, getGlobalConnectionName, configModule } from '@/core/config'
import { parseConnectionNames, resolveConnectionSelector } from '@/agent-core/public'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let tempDirectory: string
let configPath: string

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
    tempDirectory = await mkdtemp(join(tmpdir(), 'dbcli-global-conn-test-'))
    configPath = join(tempDirectory, '.dbcli')
    await mkdir(configPath, { recursive: true })
  })

  afterEach(async () => {
    setGlobalConnectionName(undefined)
    await rm(tempDirectory, { recursive: true, force: true })
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
    beforeEach(async () => {
      await Bun.file(join(configPath, 'config.json')).write(JSON.stringify(V2_CONFIG, null, 2))
    })

    test('未設定 --use 時應使用 default connection（primary）', async () => {
      setGlobalConnectionName(undefined)
      const config = await configModule.read(configPath)
      expect(config.connection.host).toBe('primary.db.local')
      expect(config.connection.port).toBe(5432)
      expect((config as { effectiveConnectionName?: string }).effectiveConnectionName).toBe(
        'primary'
      )
    })

    test('設定全域 --use staging 後應使用 staging connection', async () => {
      setGlobalConnectionName('staging')
      const config = await configModule.read(configPath)
      expect(config.connection.host).toBe('staging.db.local')
      expect(config.connection.port).toBe(5433)
      expect(config.connection.database).toBe('staging_db')
      expect((config as { effectiveConnectionName?: string }).effectiveConnectionName).toBe(
        'staging'
      )
    })

    test('明確傳入 connectionName 應優先於全域設定', async () => {
      setGlobalConnectionName('staging')
      // 明確傳入 primary，應覆蓋全域的 staging
      const config = await configModule.read(configPath, 'primary')
      expect(config.connection.host).toBe('primary.db.local')
      expect((config as { effectiveConnectionName?: string }).effectiveConnectionName).toBe(
        'primary'
      )
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

describe('invocation connection selector precedence', () => {
  test('command and root selectors accept the same explicit value', () => {
    expect(resolveConnectionSelector({ root: 'staging', command: 'staging' })).toBe('staging')
  })

  test('different root and command selectors fail clearly', () => {
    expect(() => resolveConnectionSelector({ root: 'primary', command: 'staging' })).toThrow(
      /Conflicting connection selectors.*primary.*staging/
    )
  })

  test('an explicit selector wins over DBCLI_CONNECTION', () => {
    expect(resolveConnectionSelector({ command: 'staging', environment: 'dev' })).toBe('staging')
    expect(resolveConnectionSelector({ root: 'staging', environment: 'dev' })).toBe('staging')
  })

  test('DBCLI_CONNECTION is trimmed and an empty value is unset', () => {
    expect(resolveConnectionSelector({ environment: '  staging  ' })).toBe('staging')
    expect(resolveConnectionSelector({ environment: '   ' })).toBeUndefined()
  })

  test('rejects an empty explicit selector rather than falling back to the default', () => {
    expect(() => resolveConnectionSelector({ root: '   ' })).toThrow(/cannot be empty/)
    expect(() => resolveConnectionSelector({ command: '' })).toThrow(/cannot be empty/)
  })

  test('no selector preserves configured-default fallback', () => {
    expect(resolveConnectionSelector({})).toBeUndefined()
  })

  test('explicit fan-out names are trimmed and preserve input order', () => {
    expect(parseConnectionNames(' primary, staging ,analytics ')).toEqual([
      'primary',
      'staging',
      'analytics',
    ])
  })

  test('explicit fan-out rejects empty and duplicate names', () => {
    for (const selector of ['primary,,staging', ',primary', 'primary,', 'primary, primary']) {
      expect(() => parseConnectionNames(selector)).toThrow(/empty|duplicate/i)
    }
  })
})
