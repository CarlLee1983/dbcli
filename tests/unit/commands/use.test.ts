import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { switchDefault, listConnectionsForDisplay } from '@/commands/use'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let tempDirectory: string
let configDirectory: string

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
      permission: 'read-write',
    },
    staging: {
      system: 'postgresql',
      host: 'staging.example.com',
      port: 5432,
      user: 'admin',
      password: 'stagingpass',
      database: 'staging_db',
      permission: 'query-only',
    },
  },
  schema: {},
  metadata: { version: '1.0' },
  blacklist: { tables: [], columns: {} },
}

describe('use command', () => {
  beforeEach(async () => {
    tempDirectory = await mkdtemp(join(tmpdir(), 'dbcli-use-test-'))
    configDirectory = join(tempDirectory, '.dbcli')
    await mkdir(configDirectory, { recursive: true })
    await Bun.write(join(configDirectory, 'config.json'), JSON.stringify(baseV2Config, null, 2))
  })

  afterEach(async () => {
    await rm(tempDirectory, { recursive: true, force: true })
  })

  describe('switchDefault', () => {
    test('should switch default connection', async () => {
      await switchDefault(configDirectory, 'staging', baseV2Config as any)
      const updated = JSON.parse(await Bun.file(join(configDirectory, 'config.json')).text())
      expect(updated.default).toBe('staging')
    })

    test('should throw for non-existent connection', async () => {
      expect(switchDefault(configDirectory, 'nonexistent', baseV2Config as any)).rejects.toThrow(
        /nonexistent/
      )
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
