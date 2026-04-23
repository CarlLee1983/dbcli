import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { join } from 'path'
import { getProjectStoragePath, writeProjectBinding } from '@/core/config-binding'
import { writeV2Config } from '@/core/config-v2'

const TMP_DIR = '/tmp/dbcli-multi-conn-integration'
const CONFIG_DIR = join(TMP_DIR, '.dbcli')

const CLI = join(import.meta.dir, '../../src/cli.ts')

const v2ConfigBase = {
  version: 2,
  default: 'local',
  connections: {
    local: {
      system: 'postgresql',
      host: 'localhost',
      port: 5432,
      user: 'dev',
      password: 'secret',
      database: 'myapp',
      permission: 'read-write',
    },
  },
  schema: {},
  metadata: { version: '1.0' },
  blacklist: { tables: [], columns: {} },
}

describe('multi-connection integration', () => {
  beforeEach(async () => {
    await Bun.$`rm -rf ${getProjectStoragePath(CONFIG_DIR)}`
    await Bun.$`rm -rf ${CONFIG_DIR}`
    await Bun.$`mkdir -p ${CONFIG_DIR}`
  })

  afterEach(async () => {
    await Bun.$`rm -rf ${getProjectStoragePath(CONFIG_DIR)}`
    await Bun.$`rm -rf ${TMP_DIR}`
  })

  test('init --conn-name 建立 binding 並將 v2 設定寫入 home storage', async () => {
    await Bun.$`bun run ${CLI} --config ${CONFIG_DIR} init --conn-name local --system postgresql --host localhost --port 5432 --user test --password test --name testdb --skip-test --no-interactive --force`

    const projectConfig = JSON.parse(await Bun.file(join(CONFIG_DIR, 'config.json')).text())
    const storagePath = getProjectStoragePath(CONFIG_DIR)
    const storedConfig = JSON.parse(await Bun.file(join(storagePath, 'config.json')).text())

    expect(projectConfig.version).toBe(3)
    expect(projectConfig.binding.storagePath).toBe(storagePath)
    expect(storedConfig.version).toBe(2)
    expect(storedConfig.default).toBe('local')
    expect(storedConfig.connections.local).toBeDefined()
    expect(storedConfig.connections.local.system).toBe('postgresql')
  })

  test('use 指令切換預設連線', async () => {
    const storagePath = getProjectStoragePath(CONFIG_DIR)
    const v2Config = {
      ...v2ConfigBase,
      connections: {
        ...v2ConfigBase.connections,
        staging: {
          system: 'postgresql',
          host: 'staging.example.com',
          port: 5432,
          user: 'admin',
          password: 'pass',
          database: 'staging_db',
          permission: 'query-only',
        },
      },
    }
    await writeV2Config(storagePath, v2Config)
    await writeProjectBinding(CONFIG_DIR, storagePath)

    await Bun.$`bun run ${CLI} --config ${CONFIG_DIR} use staging`

    const updated = JSON.parse(await Bun.file(join(storagePath, 'config.json')).text())
    expect(updated.default).toBe('staging')
  })

  test('use --list 顯示所有連線', async () => {
    const storagePath = getProjectStoragePath(CONFIG_DIR)
    await writeV2Config(storagePath, v2ConfigBase)
    await writeProjectBinding(CONFIG_DIR, storagePath)

    const output = await Bun.$`bun run ${CLI} --config ${CONFIG_DIR} use --list`.text()
    expect(output).toContain('local')
    expect(output).toContain('postgresql')
  })

  test('init --remove 移除連線', async () => {
    const storagePath = getProjectStoragePath(CONFIG_DIR)
    const v2Config = {
      ...v2ConfigBase,
      connections: {
        ...v2ConfigBase.connections,
        staging: {
          system: 'postgresql',
          host: 'staging.example.com',
          port: 5432,
          user: 'admin',
          password: 'pass',
          database: 'staging_db',
          permission: 'query-only',
        },
      },
    }
    await writeV2Config(storagePath, v2Config)
    await writeProjectBinding(CONFIG_DIR, storagePath)

    await Bun.$`bun run ${CLI} --config ${CONFIG_DIR} init --remove staging`

    const updated = JSON.parse(await Bun.file(join(storagePath, 'config.json')).text())
    expect(updated.connections.staging).toBeUndefined()
    expect(updated.connections.local).toBeDefined()
  })

  test('init --rename 重新命名連線', async () => {
    const storagePath = getProjectStoragePath(CONFIG_DIR)
    await writeV2Config(storagePath, v2ConfigBase)
    await writeProjectBinding(CONFIG_DIR, storagePath)

    await Bun.$`bun run ${CLI} --config ${CONFIG_DIR} init --rename local:production`

    const updated = JSON.parse(await Bun.file(join(storagePath, 'config.json')).text())
    expect(updated.connections.local).toBeUndefined()
    expect(updated.connections.production).toBeDefined()
    expect(updated.default).toBe('production')
  })
})
