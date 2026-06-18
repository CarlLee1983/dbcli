import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { join } from 'path'
import { writeV2Config, readV2Config } from '@/core/config-v2'
import { writeProjectBinding, getProjectStoragePath } from '@/core/config-binding'
import type { DbcliConfigV2 } from '@/utils/validation'

const TMP = '/tmp/dbcli-atomic-test'
const PROJECT = join(TMP, '.dbcli')

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
    await Bun.$`rm -rf ${TMP}`
    await Bun.$`mkdir -p ${PROJECT}`
    await writeProjectBinding(PROJECT, getProjectStoragePath(PROJECT))
  })
  afterEach(async () => {
    await Bun.$`rm -rf ${TMP}`
  })

  test('writes config readable back; leaves no .tmp behind', async () => {
    await writeV2Config(PROJECT, cfg('primary'))
    expect((await readV2Config(PROJECT)).default).toBe('primary')
    const storage = getProjectStoragePath(PROJECT)
    expect(await Bun.file(join(storage, 'config.json.tmp')).exists()).toBe(false)
  })

  test('overwriting keeps the file valid (no partial state)', async () => {
    await writeV2Config(PROJECT, cfg('primary'))
    await writeV2Config(PROJECT, cfg('secondary'))
    expect((await readV2Config(PROJECT)).default).toBe('secondary')
  })
})
