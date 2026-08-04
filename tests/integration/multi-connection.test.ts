import { describe, test, expect, beforeEach, afterEach, setDefaultTimeout } from 'bun:test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  getGlobalConfigPath,
  getProjectStoragePath,
  writeProjectBinding,
} from '@/core/config-binding'
import { writeV2Config } from '@/core/config-v2'

let tempDirectory: string
let configDirectory: string
let originalConfigHome: string | undefined

const CLI = join(import.meta.dir, '../../src/cli.ts')

// CLI integration cases shell out through Bun; full-suite load can exceed Bun's 5s default.
setDefaultTimeout(15_000)

const v2ConfigBase = {
  version: 2 as const,
  default: 'local',
  connections: {
    local: {
      system: 'postgresql' as const,
      host: 'localhost',
      port: 5432,
      user: 'dev',
      password: 'secret',
      database: 'myapp',
      permission: 'read-write' as const,
    },
  },
  schema: {},
  schemas: {},
  metadata: { version: '1.0' },
  blacklist: { tables: [], columns: {} },
}

describe('multi-connection integration', () => {
  beforeEach(async () => {
    tempDirectory = await mkdtemp(join(tmpdir(), 'dbcli-multi-conn-integration-'))
    configDirectory = join(tempDirectory, '.dbcli')
    await mkdir(configDirectory, { recursive: true })
    originalConfigHome = process.env.DBCLI_CONFIG_HOME
    process.env.DBCLI_CONFIG_HOME = join(tempDirectory, 'global-config')
  })

  afterEach(async () => {
    await rm(getProjectStoragePath(configDirectory), { recursive: true, force: true })
    await rm(getGlobalConfigPath(), { recursive: true, force: true })
    await rm(tempDirectory, { recursive: true, force: true })
    if (originalConfigHome === undefined) delete process.env.DBCLI_CONFIG_HOME
    else process.env.DBCLI_CONFIG_HOME = originalConfigHome
  })

  test('--global init stores a reusable v2 registry outside any project', async () => {
    await Bun.$`bun run ${CLI} --global init --conn-name shared --system postgresql --host global.example.com --port 5432 --user shared --password secret --name shared_db --permission admin --skip-test --no-interactive --force`

    const globalConfig = JSON.parse(
      await Bun.file(join(getGlobalConfigPath(), 'config.json')).text()
    )
    expect(globalConfig.version).toBe(2)
    expect(globalConfig.default).toBe('shared')
    expect(globalConfig.connections.shared.host).toBe('global.example.com')
    expect(await Bun.file(join(configDirectory, 'config.json')).exists()).toBe(false)

    const inventory = await Bun.$`bun run ${CLI} --global use --list --format json`.json()
    expect(inventory.connections[0].name).toBe('shared')

    const status = await Bun.$`bun run ${CLI} --global status --format json`.json()
    expect(status.system).toBe('postgresql')

    const migration =
      await Bun.$`bun run ${CLI} --global migrate create users --column id:serial`.json()
    expect(migration.status).toBe('success')
    expect(migration.dryRun).toBe(true)
    expect(migration.sql).toContain('CREATE TABLE')
  })

  test('init --conn-name 建立 binding 並將 v2 設定寫入 home storage', async () => {
    await Bun.$`bun run ${CLI} --config ${configDirectory} init --conn-name local --system postgresql --host localhost --port 5432 --user test --password test --name testdb --skip-test --no-interactive --force`

    const projectConfig = JSON.parse(await Bun.file(join(configDirectory, 'config.json')).text())
    const storagePath = getProjectStoragePath(configDirectory)
    const storedConfig = JSON.parse(await Bun.file(join(storagePath, 'config.json')).text())

    expect(projectConfig.version).toBe(3)
    expect(projectConfig.binding.storagePath).toBe(storagePath)
    expect(storedConfig.version).toBe(2)
    expect(storedConfig.default).toBe('local')
    expect(storedConfig.connections.local).toBeDefined()
    expect(storedConfig.connections.local.system).toBe('postgresql')
  })

  test('use 指令切換預設連線', async () => {
    const storagePath = getProjectStoragePath(configDirectory)
    const v2Config = {
      ...v2ConfigBase,
      connections: {
        ...v2ConfigBase.connections,
        staging: {
          system: 'postgresql' as const,
          host: 'staging.example.com',
          port: 5432,
          user: 'admin',
          password: 'pass',
          database: 'staging_db',
          permission: 'query-only' as const,
        },
      },
    }
    await writeV2Config(storagePath, v2Config)
    await writeProjectBinding(configDirectory, storagePath)

    await Bun.$`bun run ${CLI} --config ${configDirectory} use staging`

    const updated = JSON.parse(await Bun.file(join(storagePath, 'config.json')).text())
    expect(updated.default).toBe('staging')
  })

  test('use --list 顯示所有連線', async () => {
    const storagePath = getProjectStoragePath(configDirectory)
    await writeV2Config(storagePath, v2ConfigBase)
    await writeProjectBinding(configDirectory, storagePath)

    const output = await Bun.$`bun run ${CLI} --config ${configDirectory} use --list`.text()
    expect(output).toContain('local')
    expect(output).toContain('postgresql')
  })

  test('init --remove 移除連線', async () => {
    const storagePath = getProjectStoragePath(configDirectory)
    const v2Config = {
      ...v2ConfigBase,
      connections: {
        ...v2ConfigBase.connections,
        staging: {
          system: 'postgresql' as const,
          host: 'staging.example.com',
          port: 5432,
          user: 'admin',
          password: 'pass',
          database: 'staging_db',
          permission: 'query-only' as const,
        },
      },
    }
    await writeV2Config(storagePath, v2Config)
    await writeProjectBinding(configDirectory, storagePath)

    await Bun.$`bun run ${CLI} --config ${configDirectory} init --remove staging`

    const updated = JSON.parse(await Bun.file(join(storagePath, 'config.json')).text())
    expect(updated.connections.staging).toBeUndefined()
    expect(updated.connections.local).toBeDefined()
  })

  test('init --rename 重新命名連線', async () => {
    const storagePath = getProjectStoragePath(configDirectory)
    await writeV2Config(storagePath, v2ConfigBase)
    await writeProjectBinding(configDirectory, storagePath)

    await Bun.$`bun run ${CLI} --config ${configDirectory} init --rename local:production`

    const updated = JSON.parse(await Bun.file(join(storagePath, 'config.json')).text())
    expect(updated.connections.local).toBeUndefined()
    expect(updated.connections.production).toBeDefined()
    expect(updated.default).toBe('production')
  })
})
