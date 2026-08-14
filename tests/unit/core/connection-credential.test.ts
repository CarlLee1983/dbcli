import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeV2Config, readV2Config, resolveConnection, loadConnectionEnv } from '@/core/config-v2'
import { writeProjectBinding, getProjectStoragePath } from '@/core/config-binding'
import { setConnectionPassword } from '@/core/connection-credential'
import { configModule } from '@/core/config'
import type { DbcliConfigV2 } from '@/utils/validation'

let tempDirectory: string
let projectPath: string

function baseConfig(connectionOverrides: Record<string, unknown> = {}): DbcliConfigV2 {
  return {
    version: 2,
    default: 'primary',
    connections: {
      primary: {
        system: 'mysql',
        host: 'localhost',
        port: 3306,
        user: 'root',
        password: { $env: 'LEGACY_PROD_PW' },
        database: 'app',
        permission: 'query-only',
        envFile: '.env.primary',
        ...connectionOverrides,
      },
    },
    schema: {},
    schemas: {},
    metadata: { version: '2.0' },
    blacklist: { tables: [], columns: {} },
    audit: { enabled: true, rotation: { max_bytes: 10485760, max_entries: 1000 } },
  } as DbcliConfigV2
}

async function setupProject(config: DbcliConfigV2): Promise<void> {
  tempDirectory = await mkdtemp(join(tmpdir(), 'dbcli-conn-credential-test-'))
  projectPath = join(tempDirectory, '.dbcli')
  await mkdir(projectPath, { recursive: true })
  await writeProjectBinding(projectPath, getProjectStoragePath(projectPath))
  await writeV2Config(projectPath, config)
}

afterEach(async () => {
  await rm(getProjectStoragePath(projectPath), { recursive: true, force: true })
  await rm(tempDirectory, { recursive: true, force: true })
  delete process.env.LEGACY_PROD_PW
  delete process.env.DBCLI_PASSWORD
  delete process.env.DBCLI_PRIMARY_PASSWORD
  delete process.env.DBCLI_SECONDARY_PASSWORD
})

describe('setConnectionPassword — v2 connection already using an $env reference', () => {
  beforeEach(async () => {
    await setupProject(baseConfig())
  })

  test('writes the new value under the env var the config actually references', async () => {
    const target = await setConnectionPassword(projectPath, 'primary', 'rotated-pw')

    expect(target).toEqual({
      connection: 'primary',
      envFile: '.env.primary',
      varName: 'LEGACY_PROD_PW',
      convertedToEnvRef: false,
    })

    const config = await readV2Config(projectPath)
    await loadConnectionEnv(
      resolveConnection(config, 'primary'),
      getProjectStoragePath(projectPath)
    )
    expect(process.env.LEGACY_PROD_PW).toBe('rotated-pw')
  })

  test('leaves the rest of the connection untouched', async () => {
    await setConnectionPassword(projectPath, 'primary', 'rotated-pw')

    const config = await readV2Config(projectPath)
    expect(config.connections.primary).toEqual(baseConfig().connections.primary)
    expect(config.default).toBe('primary')
  })

  test('rejects an unknown connection name', async () => {
    await expect(setConnectionPassword(projectPath, 'nope', 'x')).rejects.toThrow(/nope/)
  })

  test('rejects a value containing a newline', async () => {
    await expect(setConnectionPassword(projectPath, 'primary', 'a\nb')).rejects.toThrow('換行')
  })
})

describe('setConnectionPassword — v2 connection still holding a literal password', () => {
  beforeEach(async () => {
    await setupProject(baseConfig({ password: 'old-plaintext', envFile: undefined }))
  })

  test('converts config to an $env reference and stores the value in .env.local', async () => {
    const target = await setConnectionPassword(projectPath, 'primary', 'rotated-pw')

    expect(target).toEqual({
      connection: 'primary',
      envFile: '.env.local',
      varName: 'DBCLI_PRIMARY_PASSWORD',
      convertedToEnvRef: true,
    })

    const config = await readV2Config(projectPath)
    expect(config.connections.primary.password).toEqual({ $env: 'DBCLI_PRIMARY_PASSWORD' })

    const envText = await Bun.file(join(getProjectStoragePath(projectPath), '.env.local')).text()
    expect(envText).toContain('DBCLI_PRIMARY_PASSWORD="rotated-pw"')
    expect(envText).not.toContain('old-plaintext')
  })

  test('the rewritten config still passes the integrity check on read', async () => {
    await setConnectionPassword(projectPath, 'primary', 'rotated-pw')
    await expect(readV2Config(projectPath)).resolves.toBeDefined()
  })

  test('a second rotation no longer touches config.json', async () => {
    await setConnectionPassword(projectPath, 'primary', 'first')
    const second = await setConnectionPassword(projectPath, 'primary', 'second')

    expect(second.convertedToEnvRef).toBe(false)
    const envText = await Bun.file(join(getProjectStoragePath(projectPath), '.env.local')).text()
    expect(
      envText.split('\n').filter((line) => line.startsWith('DBCLI_PRIMARY_PASSWORD='))
    ).toEqual(['DBCLI_PRIMARY_PASSWORD="second"'])
  })
})

describe('setConnectionPassword — no connection name given', () => {
  beforeEach(async () => {
    await setupProject(baseConfig())
  })

  test('falls back to the default connection', async () => {
    const target = await setConnectionPassword(projectPath, undefined, 'rotated-pw')
    expect(target.connection).toBe('primary')
  })
})

describe('setConnectionPassword — v1 config', () => {
  beforeEach(async () => {
    tempDirectory = await mkdtemp(join(tmpdir(), 'dbcli-conn-credential-v1-test-'))
    projectPath = join(tempDirectory, '.dbcli')
    await mkdir(projectPath, { recursive: true })
    await writeProjectBinding(projectPath, getProjectStoragePath(projectPath))
    await configModule.write(getProjectStoragePath(projectPath), {
      connection: {
        system: 'mysql',
        host: 'localhost',
        port: 3306,
        user: 'root',
        password: 'old-plaintext',
        database: 'app',
      },
      permission: 'query-only',
    } as never)
  })

  test('rewrites DBCLI_PASSWORD in .env.local, matching the v1 reader', async () => {
    const target = await setConnectionPassword(projectPath, undefined, 'rotated-pw')

    expect(target).toEqual({
      connection: 'default',
      envFile: '.env.local',
      varName: 'DBCLI_PASSWORD',
      convertedToEnvRef: false,
    })

    const config = await configModule.read(getProjectStoragePath(projectPath))
    expect(config.connection.password).toBe('rotated-pw')
  })

  test('rejects a connection name, since v1 has only one connection', async () => {
    await expect(setConnectionPassword(projectPath, 'prod', 'x')).rejects.toThrow(/v1/)
  })
})

/**
 * 寫進去讀不讀得回來,是這個功能唯一真正的驗收標準——
 * 檔案內容長得對但讀取端看不到,使用者就被鎖在資料庫外面。
 */
async function readBackPassword(connectionName?: string): Promise<unknown> {
  const config = await configModule.read(getProjectStoragePath(projectPath), connectionName)
  return config.connection.password
}

describe('setConnectionPassword — the new value round-trips through the reader', () => {
  test('v2 connection with an explicit envFile', async () => {
    await setupProject(baseConfig())
    const target = await setConnectionPassword(projectPath, 'primary', 'rotated-pw')
    delete process.env[target.varName]

    expect(await readBackPassword('primary')).toBe('rotated-pw')
  })

  test('v2 connection that declares no envFile', async () => {
    await setupProject(baseConfig({ envFile: undefined }))
    const target = await setConnectionPassword(projectPath, 'primary', 'rotated-pw')
    delete process.env[target.varName]

    expect(await readBackPassword('primary')).toBe('rotated-pw')
  })

  test('v2 connection converted from a literal password', async () => {
    await setupProject(baseConfig({ password: 'old-plaintext', envFile: undefined }))
    const target = await setConnectionPassword(projectPath, 'primary', 'rotated-pw')
    delete process.env[target.varName]

    expect(await readBackPassword('primary')).toBe('rotated-pw')
  })

  test('values containing $ substitution patterns survive verbatim', async () => {
    await setupProject(baseConfig())
    await setConnectionPassword(projectPath, 'primary', 'first')
    const target = await setConnectionPassword(projectPath, 'primary', 'a$&b$1c')
    delete process.env[target.varName]

    expect(await readBackPassword('primary')).toBe('a$&b$1c')
  })

  test('values with surrounding whitespace or quotes survive verbatim', async () => {
    await setupProject(baseConfig())
    const target = await setConnectionPassword(projectPath, 'primary', '  "quoted"  ')
    delete process.env[target.varName]

    expect(await readBackPassword('primary')).toBe('  "quoted"  ')
  })

  test('rotating one connection leaves a neighbour sharing .env.local intact', async () => {
    const config = baseConfig({ envFile: undefined })
    ;(config.connections as Record<string, unknown>).secondary = {
      ...(config.connections.primary as Record<string, unknown>),
      password: { $env: 'DBCLI_SECONDARY_PASSWORD' },
    }
    await setupProject(config)

    await setConnectionPassword(projectPath, 'primary', 'primary-pw')
    await setConnectionPassword(projectPath, 'secondary', 'secondary-pw')
    delete process.env.DBCLI_PRIMARY_PASSWORD
    delete process.env.DBCLI_SECONDARY_PASSWORD

    expect(await readBackPassword('primary')).toBe('primary-pw')
    delete process.env.DBCLI_PRIMARY_PASSWORD
    delete process.env.DBCLI_SECONDARY_PASSWORD
    expect(await readBackPassword('secondary')).toBe('secondary-pw')
  })
})

describe('setConnectionPassword — agent mode', () => {
  beforeEach(async () => {
    await setupProject(baseConfig())
    process.env.DBCLI_AGENT_MODE = '1'
  })
  afterEach(() => {
    delete process.env.DBCLI_AGENT_MODE
  })

  test('is refused before anything is written', async () => {
    await expect(setConnectionPassword(projectPath, 'primary', 'x')).rejects.toThrow(/Agent mode/)
    const envPath = join(getProjectStoragePath(projectPath), '.env.primary')
    expect(await Bun.file(envPath).exists()).toBe(false)
  })
})

describe('setConnectionPassword — env file permissions', () => {
  beforeEach(async () => {
    await setupProject(baseConfig())
  })

  // POSIX only:Windows 沒有對應的 mode 位元,chmod 在那裡只切換唯讀旗標,
  // 檔案權限由所在目錄的 ACL 決定。斷言 0o600 只在有這個保證的平台成立。
  test.skipIf(process.platform === 'win32')('the env file is owner-only readable', async () => {
    await setConnectionPassword(projectPath, 'primary', 'rotated-pw')
    const { stat } = await import('node:fs/promises')
    const mode = (await stat(join(getProjectStoragePath(projectPath), '.env.primary'))).mode
    expect(mode & 0o777).toBe(0o600)
  })
})
