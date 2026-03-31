import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { join } from 'path'

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
      permission: 'read-write'
    }
  },
  schema: {},
  metadata: { version: '1.0' },
  blacklist: { tables: [], columns: {} }
}

describe('multi-connection integration', () => {
  beforeEach(async () => {
    await Bun.$`mkdir -p ${CONFIG_DIR}`
  })

  afterEach(async () => {
    await Bun.$`rm -rf ${TMP_DIR}`
  })

  test('init --conn-name 建立 v2 設定', async () => {
    await Bun.$`bun run ${CLI} --config ${CONFIG_DIR} init --conn-name local --system postgresql --host localhost --port 5432 --user test --password test --name testdb --skip-test --no-interactive --force`

    const config = JSON.parse(await Bun.file(join(CONFIG_DIR, 'config.json')).text())
    expect(config.version).toBe(2)
    expect(config.default).toBe('local')
    expect(config.connections.local).toBeDefined()
    expect(config.connections.local.system).toBe('postgresql')
  })

  test('use 指令切換預設連線', async () => {
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
          permission: 'query-only'
        }
      }
    }
    await Bun.write(join(CONFIG_DIR, 'config.json'), JSON.stringify(v2Config, null, 2))

    await Bun.$`bun run ${CLI} --config ${CONFIG_DIR} use staging`

    const updated = JSON.parse(await Bun.file(join(CONFIG_DIR, 'config.json')).text())
    expect(updated.default).toBe('staging')
  })

  test('use --list 顯示所有連線', async () => {
    await Bun.write(join(CONFIG_DIR, 'config.json'), JSON.stringify(v2ConfigBase, null, 2))

    const output = await Bun.$`bun run ${CLI} --config ${CONFIG_DIR} use --list`.text()
    expect(output).toContain('local')
    expect(output).toContain('postgresql')
  })

  test('init --remove 移除連線', async () => {
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
          permission: 'query-only'
        }
      }
    }
    await Bun.write(join(CONFIG_DIR, 'config.json'), JSON.stringify(v2Config, null, 2))

    await Bun.$`bun run ${CLI} --config ${CONFIG_DIR} init --remove staging`

    const updated = JSON.parse(await Bun.file(join(CONFIG_DIR, 'config.json')).text())
    expect(updated.connections.staging).toBeUndefined()
    expect(updated.connections.local).toBeDefined()
  })

  test('init --rename 重新命名連線', async () => {
    await Bun.write(join(CONFIG_DIR, 'config.json'), JSON.stringify(v2ConfigBase, null, 2))

    await Bun.$`bun run ${CLI} --config ${CONFIG_DIR} init --rename local:production`

    const updated = JSON.parse(await Bun.file(join(CONFIG_DIR, 'config.json')).text())
    expect(updated.connections.local).toBeUndefined()
    expect(updated.connections.production).toBeDefined()
    expect(updated.default).toBe('production')
  })
})
