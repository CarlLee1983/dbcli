/**
 * schema --refresh first-time bootstrap behaviour.
 * When config.schema is empty, --force should not be required.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { handleSchemaRefresh } from '@/commands/schema'
import { writeConfigWithIntegrity } from '@/core/config-integrity'
import type { DatabaseAdapter } from '@/adapters/types'
import type { DbcliConfig } from '@/utils/validation'

function mockAdapter(): DatabaseAdapter {
  return {
    connect: async () => {},
    disconnect: async () => {},
    execute: async <T = Record<string, unknown>>() => ({ rows: [] as T[], affectedRows: 0 }),
    listTables: async () => [
      { name: 'users', columns: [], rowCount: 0, primaryKey: undefined, foreignKeys: [] },
      { name: 'orders', columns: [], rowCount: 0, primaryKey: undefined, foreignKeys: [] },
    ],
    getTableSchema: async (name: string) => ({
      name,
      columns: [{ name: 'id', type: 'int', nullable: false, isPrimaryKey: true }],
      rowCount: 0,
      primaryKey: ['id'],
      foreignKeys: [],
    }),
    testConnection: async () => true,
    getServerVersion: async () => 'test',
  }
}

const BASE_CONFIG = {
  connection: {
    system: 'mariadb',
    host: 'localhost',
    port: 3306,
    user: 'u',
    password: 'p',
    database: 'db',
  },
  permission: 'admin',
  schema: {},
  metadata: { createdAt: '2026-01-01T00:00:00.000Z', version: '1.0' },
}

describe('handleSchemaRefresh first-time bootstrap', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'dbcli-schema-bootstrap-'))
    // A configuration has to exist for the cache to be stored into. It used to
    // be created as a side effect of the cache write, because that write was
    // `configModule.write` publishing a whole document; since DBCLI-PLAT-012
    // the cache seam patches the config on disk and refuses when there is none,
    // rather than publishing connection details out of a cache write. The
    // subject of these tests is unchanged: whether --force is required.
    await writeConfigWithIntegrity(tmpDir, JSON.stringify(BASE_CONFIG, null, 2))
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('persists schema without --force when cache is empty', async () => {
    const config: DbcliConfig = {
      connection: {
        system: 'mariadb',
        host: 'localhost',
        port: 3306,
        user: 'u',
        password: 'p',
        database: 'db',
      },
      permission: 'admin',
      schema: {},
    } as unknown as DbcliConfig

    await handleSchemaRefresh(
      mockAdapter(),
      config,
      { config: 'dummy', refresh: true, force: false },
      undefined,
      tmpDir
    )

    expect(existsSync(path.join(tmpDir, 'schemas'))).toBe(true)
  })

  it('still requires --force when cache is non-empty', async () => {
    const config: DbcliConfig = {
      connection: {
        system: 'mariadb',
        host: 'localhost',
        port: 3306,
        user: 'u',
        password: 'p',
        database: 'db',
      },
      permission: 'admin',
      schema: {
        users: {
          name: 'users',
          columns: [{ name: 'id', type: 'int', nullable: false, isPrimaryKey: true }],
          rowCount: 0,
          primaryKey: ['id'],
          foreignKeys: [],
        },
      },
    } as unknown as DbcliConfig

    await handleSchemaRefresh(
      mockAdapter(),
      config,
      { config: 'dummy', refresh: true, force: false },
      undefined,
      tmpDir
    )

    expect(existsSync(path.join(tmpDir, 'schemas'))).toBe(false)
  })
})
