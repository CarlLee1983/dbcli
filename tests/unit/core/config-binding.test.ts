import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { configModule } from '@/core/config'
import { readV2Config, writeV2Config } from '@/core/config-v2'
import {
  getProjectStoragePath,
  migrateLegacyProjectEnvLocal,
  resolveConfigStoragePath,
  writeProjectBinding,
} from '@/core/config-binding'
import { mkdir, mkdtemp, rm, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let tempDirectory: string

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
  schemas: {},
  metadata: { version: '2.0' },
  blacklist: { tables: [], columns: {} },
}

describe('config binding layout', () => {
  const originalAgentMode = process.env.DBCLI_AGENT_MODE
  let projectPath: string

  beforeEach(async () => {
    tempDirectory = await mkdtemp(join(tmpdir(), 'dbcli-config-binding-test-'))
    projectPath = join(tempDirectory, '.dbcli')
    await mkdir(projectPath, { recursive: true })
  })

  afterEach(async () => {
    if (originalAgentMode === undefined) delete process.env.DBCLI_AGENT_MODE
    else process.env.DBCLI_AGENT_MODE = originalAgentMode
    await rm(getProjectStoragePath(projectPath), { recursive: true, force: true })
    await rm(tempDirectory, { recursive: true, force: true })
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

  test('agent mode detects a tampered project binding', async () => {
    const storagePath = getProjectStoragePath(projectPath)
    delete process.env.DBCLI_AGENT_MODE
    await writeProjectBinding(projectPath, storagePath)
    const bindingPath = join(projectPath, 'config.json')
    const binding = await Bun.file(bindingPath).json()
    binding.binding.storagePath = join(tempDirectory, 'attacker-target')
    await Bun.write(bindingPath, JSON.stringify(binding, null, 2))

    process.env.DBCLI_AGENT_MODE = '1'
    await expect(resolveConfigStoragePath(projectPath)).rejects.toThrow(/project binding tampering/)
  })

  test('agent mode refuses a deleted project binding integrity record', async () => {
    const storagePath = getProjectStoragePath(projectPath)
    delete process.env.DBCLI_AGENT_MODE
    await writeProjectBinding(projectPath, storagePath)
    await unlink(join(projectPath, '.binding-integrity.json'))

    process.env.DBCLI_AGENT_MODE = '1'
    await expect(resolveConfigStoragePath(projectPath)).rejects.toThrow(
      /missing config integrity record/
    )
  })
})
