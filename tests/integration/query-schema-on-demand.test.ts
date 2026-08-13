/**
 * 查詢路徑不載入 layered schema 全載（#43）
 *
 * `dbcli query` 每次執行都會把 schema 索引裡的每一張表都讀進記憶體，只為了
 * size guard 可能會用到其中一張。表一多，這筆固定成本就是每次 CLI 呼叫都付的
 * 延遲——對高頻呼叫的 agent 尤其明顯。這裡守的是「只讀查詢真正提到的表」。
 */

import { describe, test, expect, beforeEach, afterEach, spyOn } from 'bun:test'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AdapterFactory } from '../../src/adapters'
import { SchemaCacheManager } from '../../src/core/schema-cache'
import { queryCommand } from '../../src/commands/query'

const TABLES = ['users', 'orders', 'products'] as const

function tableSchema(name: string, estimatedRowCount: number) {
  return {
    name,
    columns: [{ name: 'id', type: 'bigint', nullable: false, primaryKey: true }],
    primaryKey: ['id'],
    estimatedRowCount,
  }
}

describe('query does not load every table schema', () => {
  let storagePath: string

  beforeEach(async () => {
    storagePath = await mkdtemp(join(tmpdir(), 'dbcli-query-schema-'))
    await mkdir(join(storagePath, 'schemas', 'cold'), { recursive: true })

    await Bun.file(join(storagePath, 'config.json')).write(
      JSON.stringify({
        version: 2,
        default: 'main',
        connections: {
          main: {
            system: 'postgresql',
            host: 'localhost',
            port: 5432,
            user: 'test',
            password: 'test',
            database: 'testdb',
            permission: 'query-only',
          },
        },
        metadata: { version: '1.0' },
      })
    )

    // 三張表都放 cold，讓「讀了幾張」等於「讀了幾個檔」
    const index = {
      tables: Object.fromEntries(
        TABLES.map((name) => [
          name,
          {
            location: 'cold',
            file: `cold/${name}.json`,
            estimatedSize: 500,
            lastModified: new Date().toISOString(),
          },
        ])
      ),
      hotTables: [],
      metadata: {
        version: '1.0',
        lastRefreshed: new Date().toISOString(),
        totalTables: TABLES.length,
      },
    }
    await Bun.file(join(storagePath, 'schemas', 'main', 'index.json')).write(
      JSON.stringify(index, null, 2)
    )
    for (const name of TABLES) {
      await Bun.file(join(storagePath, 'schemas', 'main', 'cold', `${name}.json`)).write(
        JSON.stringify({ [name]: tableSchema(name, name === 'orders' ? 50_000_000 : 100) })
      )
    }
  })

  afterEach(async () => {
    await rm(storagePath, { recursive: true, force: true })
  })

  async function runQuery(sql: string): Promise<{ tablesLoaded: string[]; error?: unknown }> {
    const adapter = {
      system: 'postgresql' as const,
      connect: async () => {},
      disconnect: async () => {},
      execute: async () => ({ rows: [{ id: 1 }], affectedRows: 1 }),
      listTables: async () => [],
      getTableSchema: async () => ({ name: '', columns: [] }),
      testConnection: async () => true,
      getServerVersion: async () => 'test',
    }
    const tablesLoaded: string[] = []
    const adapterSpy = spyOn(AdapterFactory, 'createSqlAdapter').mockReturnValue(adapter as any)
    const original = SchemaCacheManager.prototype.getTableSchema
    const loadSpy = spyOn(SchemaCacheManager.prototype, 'getTableSchema')
    loadSpy.mockImplementation(async function (this: SchemaCacheManager, table: string) {
      tablesLoaded.push(table)
      return original.call(this, table)
    })
    const logSpy = spyOn(console, 'log').mockImplementation(() => {})
    const errorSpy = spyOn(console, 'error').mockImplementation(() => {})

    let error: unknown
    try {
      await queryCommand(sql, { format: 'json', config: storagePath })
    } catch (e) {
      error = e
    } finally {
      adapterSpy.mockRestore()
      loadSpy.mockRestore()
      logSpy.mockRestore()
      errorSpy.mockRestore()
    }
    return { tablesLoaded, error }
  }

  test('只載入查詢實際提到的表', async () => {
    const { tablesLoaded, error } = await runQuery('SELECT * FROM users WHERE id = 1')
    expect(error).toBeUndefined()
    expect(tablesLoaded).not.toContain('products')
    expect(tablesLoaded).not.toContain('orders')
  })

  test('size guard 仍然擋得住無條件掃巨表', async () => {
    const { error } = await runQuery('SELECT * FROM orders')
    expect(String((error as Error)?.message)).toContain('50,000,000')
  })

  test('小表不受 size guard 影響', async () => {
    const { error } = await runQuery('SELECT * FROM users')
    expect(error).toBeUndefined()
  })
})
