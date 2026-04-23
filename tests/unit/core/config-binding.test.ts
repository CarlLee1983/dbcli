import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { configModule } from '@/core/config'
import { readV2Config, writeV2Config } from '@/core/config-v2'
import {
  getProjectStoragePath,
  migrateLegacyProjectEnvLocal,
  resolveConfigStoragePath,
  writeProjectBinding,
} from '@/core/config-binding'
import { join } from 'path'

const TMP_DIR = '/tmp/dbcli-config-binding-test'

const SAMPLE_V2_CONFIG = {
  version: 2 as const,
  default: 'primary',
  connections: {
    primary: {
      system: 'postgresql' as const,
      host: 'primary.db.local',
      port: 5432,
      user: 'admin',
      password: 'primary-secret',
      database: 'app_db',
      permission: 'query-only' as const,
    },
  },
  schema: {},
  metadata: { version: '2.0' },
  blacklist: { tables: [], columns: {} },
}

describe('config binding layout', () => {
  const projectPath = join(TMP_DIR, '.dbcli')

  beforeEach(async () => {
    await Bun.$`rm -rf ${TMP_DIR}`
    await Bun.$`mkdir -p ${projectPath}`
  })

  afterEach(async () => {
    await Bun.$`rm -rf ${TMP_DIR}`
  })

  test('resolves an unbound project path to itself', async () => {
    await expect(resolveConfigStoragePath(projectPath)).resolves.toBe(projectPath)
  })

  test('resolves a bound project path to home storage', async () => {
    const storagePath = getProjectStoragePath(projectPath)
    await writeProjectBinding(projectPath, storagePath)

    await expect(resolveConfigStoragePath(projectPath)).resolves.toBe(storagePath)
  })

  test('reads and writes config through the bound storage path', async () => {
    const storagePath = getProjectStoragePath(projectPath)
    await writeProjectBinding(projectPath, storagePath)

    await writeV2Config(projectPath, SAMPLE_V2_CONFIG)

    const projectStub = await Bun.file(join(projectPath, 'config.json')).json()
    const storedConfig = await Bun.file(join(storagePath, 'config.json')).json()

    expect(projectStub.binding.storagePath).toBe(storagePath)
    expect(storedConfig.default).toBe('primary')

    const readFromProject = await configModule.read(projectPath)
    expect(readFromProject.connection.host).toBe('primary.db.local')

    const readV2FromProject = await readV2Config(projectPath)
    expect(readV2FromProject.default).toBe('primary')
  })

  test('moves legacy .env.local out of the project directory', async () => {
    const storagePath = getProjectStoragePath(projectPath)
    const legacyEnv = 'DBCLI_PASSWORD=super-secret\n'
    await Bun.file(join(projectPath, '.env.local')).write(legacyEnv)

    await migrateLegacyProjectEnvLocal(projectPath, storagePath)

    expect(await Bun.file(join(projectPath, '.env.local')).exists()).toBe(false)
    expect(await Bun.file(join(storagePath, '.env.local')).exists()).toBe(true)
    expect(await Bun.file(join(storagePath, '.env.local')).text()).toBe(legacyEnv)
  })
})
