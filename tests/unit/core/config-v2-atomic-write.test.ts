import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeV2Config, readV2Config } from '@/core/config-v2'
import { writeProjectBinding, getProjectStoragePath } from '@/core/config-binding'
import type { DbcliConfigV2 } from '@/utils/validation'

let tempDirectory: string
let projectPath: string

function cfg(defaultName: string): DbcliConfigV2 {
  return {
    version: 2,
    default: defaultName,
    connections: {
      [defaultName]: {
        system: 'mysql',
        host: 'h',
        port: 3306,
        user: 'u',
        password: '',
        database: 'd',
        permission: 'query-only',
      },
    },
    schema: {},
    schemas: {},
    metadata: { version: '2.0' },
    blacklist: { tables: [], columns: {} },
    audit: { enabled: true, rotation: { max_bytes: 10485760, max_entries: 1000 } },
  } as DbcliConfigV2
}

describe('writeV2Config atomic write', () => {
  beforeEach(async () => {
    tempDirectory = await mkdtemp(join(tmpdir(), 'dbcli-atomic-test-'))
    projectPath = join(tempDirectory, '.dbcli')
    await mkdir(projectPath, { recursive: true })
    await writeProjectBinding(projectPath, getProjectStoragePath(projectPath))
  })
  afterEach(async () => {
    await rm(getProjectStoragePath(projectPath), { recursive: true, force: true })
    await rm(tempDirectory, { recursive: true, force: true })
  })

  test('writes config readable back; leaves no .tmp behind', async () => {
    await writeV2Config(projectPath, cfg('primary'))
    expect((await readV2Config(projectPath)).default).toBe('primary')
    const storage = getProjectStoragePath(projectPath)
    expect(await Bun.file(join(storage, 'config.json.tmp')).exists()).toBe(false)
  })

  test('overwriting keeps the file valid (no partial state)', async () => {
    await writeV2Config(projectPath, cfg('primary'))
    await writeV2Config(projectPath, cfg('secondary'))
    expect((await readV2Config(projectPath)).default).toBe('secondary')
  })
})
