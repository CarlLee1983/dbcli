/**
 * schema --refresh first-time bootstrap behaviour.
 * When config.schema is empty, --force should not be required.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { handleSchemaRefresh } from '@/commands/schema'
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

describe('handleSchemaRefresh first-time bootstrap', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'dbcli-schema-bootstrap-'))
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
