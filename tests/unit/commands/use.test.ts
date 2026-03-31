import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { switchDefault, listConnectionsForDisplay } from '@/commands/use'
import { join } from 'path'

const TMP_DIR = '/tmp/dbcli-use-test'
const CONFIG_DIR = join(TMP_DIR, '.dbcli')

const baseV2Config = {
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
    },
    staging: {
      system: 'postgresql',
      host: 'staging.example.com',
      port: 5432,
      user: 'admin',
      password: 'stagingpass',
      database: 'staging_db',
      permission: 'query-only'
    }
  },
  schema: {},
  metadata: { version: '1.0' },
  blacklist: { tables: [], columns: {} }
}

describe('use command', () => {
  beforeEach(async () => {
    await Bun.$`mkdir -p ${CONFIG_DIR}`
    await Bun.write(join(CONFIG_DIR, 'config.json'), JSON.stringify(baseV2Config, null, 2))
  })

  afterEach(async () => {
    await Bun.$`rm -rf ${TMP_DIR}`
  })

  describe('switchDefault', () => {
    test('should switch default connection', async () => {
      await switchDefault(CONFIG_DIR, 'staging')
      const updated = JSON.parse(await Bun.file(join(CONFIG_DIR, 'config.json')).text())
      expect(updated.default).toBe('staging')
    })

    test('should throw for non-existent connection', async () => {
      expect(switchDefault(CONFIG_DIR, 'nonexistent')).rejects.toThrow(/不存在/)
    })
  })

  describe('listConnectionsForDisplay', () => {
    test('should list all connections with default marker', () => {
      const lines = listConnectionsForDisplay(baseV2Config as any)
      expect(lines).toHaveLength(2)
      expect(lines[0]).toContain('*')
      expect(lines[0]).toContain('local')
      expect(lines[1]).not.toContain('*')
      expect(lines[1]).toContain('staging')
    })
  })
})
