/**
 * 模式差異檢測引擎單元測試
 * 測試 SchemaDiffEngine 的差異檢測演算法和型別正規化
 */

import { describe, test, expect, beforeEach } from 'vitest'
import { SchemaDiffEngine } from '@/core/schema-diff'
import type { DatabaseAdapter, TableSchema, ColumnSchema } from '@/adapters/types'
import type { DbcliConfig } from '@/utils/validation'

describe('SchemaDiffEngine', () => {
  let config: DbcliConfig

  beforeEach(() => {
    // 建立基本配置
    config = {
      connection: {
        system: 'postgresql',
        host: 'localhost',
        port: 5432,
        user: 'test',
        password: 'test',
        database: 'test'
      },
      permission: 'admin',
      schema: {},
      metadata: {}
    }
  })

  /**
   * 建立模擬適配器函數
   * 允許依據測試需求自訂 listTables 和 getTableSchema 的行為
   */
  function createMockAdapter(
    listTablesImpl: () => Promise<TableSchema[]>,
    getTableSchemaImpl?: (name: string) => Promise<TableSchema>
  ): DatabaseAdapter {
    return {
      connect: async () => {},
      disconnect: async () => {},
      execute: async () => [],
      listTables: listTablesImpl,
      getTableSchema: getTableSchemaImpl || (async () => createMockTableSchema('')),
      testConnection: async () => true
    }
  }

  describe('diff - table-level detection', () => {
    test('should detect newly added tables', async () => {
      // 設定配置包含 2 個表格
      config.schema = {
        users: createMockTableSchema('users'),
        posts: createMockTableSchema('posts')
      }

      // 設定現時資料庫包含 4 個表格（新增 2 個）
      const currentTables = [
        createMockTableSchema('users'),
        createMockTableSchema('posts'),
        createMockTableSchema('comments'),
        createMockTableSchema('tags')
      ]

      const adapter = createMockAdapter(async () => currentTables)
      const engine = new SchemaDiffEngine(adapter, config)
      const report = await engine.diff()

      expect(report.tablesAdded).toContain('comments')
      expect(report.tablesAdded).toContain('tags')
      expect(report.tablesAdded).toHaveLength(2)
    })

    test('should detect removed tables', async () => {
      // 設定配置包含 3 個表格
      config.schema = {
        users: createMockTableSchema('users'),
        posts: createMockTableSchema('posts'),
        legacy_temp: createMockTableSchema('legacy_temp')
      }

      // 設定現時資料庫只有 2 個表格（移除 1 個）
      const currentTables = [
        createMockTableSchema('users'),
        createMockTableSchema('posts')
      ]

      const adapter = createMockAdapter(async () => currentTables)
      const engine = new SchemaDiffEngine(adapter, config)
      const report = await engine.diff()

      expect(report.tablesRemoved).toContain('legacy_temp')
      expect(report.tablesRemoved).toHaveLength(1)
    })

    test('should detect unchanged tables', async () => {
      // 設定配置包含 3 個表格
      config.schema = {
        users: createMockTableSchema('users'),
        posts: createMockTableSchema('posts'),
        comments: createMockTableSchema('comments')
      }

      // 設定現時資料庫也是相同的 3 個表格
      const currentTables = [
        createMockTableSchema('users'),
        createMockTableSchema('posts'),
        createMockTableSchema('comments')
      ]

      const adapter = createMockAdapter(
        async () => currentTables,
        async (name: string) => currentTables.find(t => t.name === name)!
      )

      const engine = new SchemaDiffEngine(adapter, config)
      const report = await engine.diff()

      expect(report.tablesAdded).toHaveLength(0)
      expect(report.tablesRemoved).toHaveLength(0)
      expect(Object.keys(report.tablesModified)).toHaveLength(0)
    })
  })

  describe('diff - column-level changes', () => {
    test('should detect columns added to existing table', async () => {
      // 舊配置：users 表格有 2 個欄位
      const oldUsersSchema = createMockTableSchema('users', [
        createMockColumnSchema('id', 'integer', false, true),
        createMockColumnSchema('name', 'varchar(100)', false)
      ])

      config.schema = {
        users: oldUsersSchema
      }

      // 新資料庫：users 表格有 4 個欄位（新增 2 個）
      const newUsersSchema = createMockTableSchema('users', [
        createMockColumnSchema('id', 'integer', false, true),
        createMockColumnSchema('name', 'varchar(100)', false),
        createMockColumnSchema('created_at', 'timestamp', true),
        createMockColumnSchema('email', 'varchar(255)', false)
      ])

      const adapter = createMockAdapter(
        async () => [newUsersSchema],
        async (name: string) => (name === 'users' ? newUsersSchema : createMockTableSchema(''))
      )

      const engine = new SchemaDiffEngine(adapter, config)
      const report = await engine.diff()

      expect(report.tablesModified['users'].columnsAdded).toContain('created_at')
      expect(report.tablesModified['users'].columnsAdded).toContain('email')
      expect(report.tablesModified['users'].columnsAdded).toHaveLength(2)
    })

    test('should detect columns removed from existing table', async () => {
      // 舊配置：users 表格有 3 個欄位
      const oldUsersSchema = createMockTableSchema('users', [
        createMockColumnSchema('id', 'integer', false, true),
        createMockColumnSchema('name', 'varchar(100)', false),
        createMockColumnSchema('deprecated_field', 'varchar(50)', true)
      ])

      config.schema = {
        users: oldUsersSchema
      }

      // 新資料庫：users 表格只有 2 個欄位（移除 1 個）
      const newUsersSchema = createMockTableSchema('users', [
        createMockColumnSchema('id', 'integer', false, true),
        createMockColumnSchema('name', 'varchar(100)', false)
      ])

      const adapter = createMockAdapter(
        async () => [newUsersSchema],
        async (name: string) => (name === 'users' ? newUsersSchema : createMockTableSchema(''))
      )

      const engine = new SchemaDiffEngine(adapter, config)
      const report = await engine.diff()

      expect(report.tablesModified['users'].columnsRemoved).toContain('deprecated_field')
      expect(report.tablesModified['users'].columnsRemoved).toHaveLength(1)
    })

    test('should detect column modifications (type, nullable, default)', async () => {
      // 舊配置：users 表格的 email 欄位是 nullable，預設值不同
      const oldUsersSchema = createMockTableSchema('users', [
        createMockColumnSchema('id', 'integer', false, true),
        createMockColumnSchema('email', 'varchar(100)', true, false, 'NULL')
      ])

      config.schema = {
        users: oldUsersSchema
      }

      // 新資料庫：users 表格的 email 欄位類型和 nullable 已變更
      const newUsersSchema = createMockTableSchema('users', [
        createMockColumnSchema('id', 'integer', false, true),
        createMockColumnSchema('email', 'varchar(255)', false, false, '')
      ])

      const adapter = createMockAdapter(
        async () => [newUsersSchema],
        async (name: string) => (name === 'users' ? newUsersSchema : createMockTableSchema(''))
      )

      const engine = new SchemaDiffEngine(adapter, config)
      const report = await engine.diff()

      expect(report.tablesModified['users'].columnsModified).toHaveLength(1)
      expect(report.tablesModified['users'].columnsModified[0].name).toBe('email')
      expect(report.tablesModified['users'].columnsModified[0].previous.type).toBe('varchar(100)')
      expect(report.tablesModified['users'].columnsModified[0].current.type).toBe('varchar(255)')
    })
  })

  describe('columnChanged - type normalization', () => {
    test('VARCHAR vs varchar treated as no change', async () => {
      const oldUsersSchema = createMockTableSchema('users', [
        createMockColumnSchema('id', 'integer', false, true),
        createMockColumnSchema('name', 'VARCHAR(255)', false)
      ])

      config.schema = {
        users: oldUsersSchema
      }

      // 類型改為小寫但內容相同
      const newUsersSchema = createMockTableSchema('users', [
        createMockColumnSchema('id', 'integer', false, true),
        createMockColumnSchema('name', 'varchar(255)', false)
      ])

      const adapter = createMockAdapter(
        async () => [newUsersSchema],
        async (name: string) => (name === 'users' ? newUsersSchema : createMockTableSchema(''))
      )

      const engine = new SchemaDiffEngine(adapter, config)
      const report = await engine.diff()

      // 不應該報告欄位為修改狀態 - 如果沒有修改，表格根本不會出現在 tablesModified
      expect(report.tablesModified['users']).toBeUndefined()
    })

    test('varchar(100) vs varchar(255) treated as modification', async () => {
      const oldUsersSchema = createMockTableSchema('users', [
        createMockColumnSchema('id', 'integer', false, true),
        createMockColumnSchema('name', 'varchar(100)', false)
      ])

      config.schema = {
        users: oldUsersSchema
      }

      // 類型長度改變
      const newUsersSchema = createMockTableSchema('users', [
        createMockColumnSchema('id', 'integer', false, true),
        createMockColumnSchema('name', 'varchar(255)', false)
      ])

      const adapter = createMockAdapter(
        async () => [newUsersSchema],
        async (name: string) => (name === 'users' ? newUsersSchema : createMockTableSchema(''))
      )

      const engine = new SchemaDiffEngine(adapter, config)
      const report = await engine.diff()

      // 應該報告欄位為修改狀態
      expect(report.tablesModified['users'].columnsModified).toHaveLength(1)
      expect(report.tablesModified['users'].columnsModified[0].name).toBe('name')
    })

    test('NUMERIC(10,2) case-insensitive comparison', async () => {
      const oldUsersSchema = createMockTableSchema('users', [
        createMockColumnSchema('id', 'integer', false, true),
        createMockColumnSchema('price', 'NUMERIC(10,2)', false)
      ])

      config.schema = {
        users: oldUsersSchema
      }

      // 類型改為小寫但內容相同
      const newUsersSchema = createMockTableSchema('users', [
        createMockColumnSchema('id', 'integer', false, true),
        createMockColumnSchema('price', 'numeric(10,2)', false)
      ])

      const adapter = createMockAdapter(
        async () => [newUsersSchema],
        async (name: string) => (name === 'users' ? newUsersSchema : createMockTableSchema(''))
      )

      const engine = new SchemaDiffEngine(adapter, config)
      const report = await engine.diff()

      // 不應該報告欄位為修改狀態 - 如果沒有修改，表格根本不會出現在 tablesModified
      expect(report.tablesModified['users']).toBeUndefined()
    })
  })

  describe('diff - FK metadata preservation', () => {
    test('should preserve foreignKeys array in diff report', async () => {
      // 舊配置：users 表格有外鍵
      const oldUsersSchema = createMockTableSchema('users', [
        createMockColumnSchema('id', 'integer', false, true),
        createMockColumnSchema('role_id', 'integer', false)
      ])
      oldUsersSchema.foreignKeys = [
        {
          name: 'fk_role',
          columns: ['role_id'],
          refTable: 'roles',
          refColumns: ['id']
        }
      ]

      config.schema = {
        users: oldUsersSchema
      }

      // 新資料庫：users 表格有新增欄位但外鍵保留
      const newUsersSchema = createMockTableSchema('users', [
        createMockColumnSchema('id', 'integer', false, true),
        createMockColumnSchema('role_id', 'integer', false),
        createMockColumnSchema('created_at', 'timestamp', true)
      ])
      newUsersSchema.foreignKeys = [
        {
          name: 'fk_role',
          columns: ['role_id'],
          refTable: 'roles',
          refColumns: ['id']
        }
      ]

      const adapter = createMockAdapter(
        async () => [newUsersSchema],
        async (name: string) => (name === 'users' ? newUsersSchema : createMockTableSchema(''))
      )

      const engine = new SchemaDiffEngine(adapter, config)
      const report = await engine.diff()

      // 驗證差異報告包含欄位新增
      expect(report.tablesModified['users'].columnsAdded).toContain('created_at')
      // 驗證外鍵元數據未遺失（透過檢查適配器返回的架構）
      expect(newUsersSchema.foreignKeys).toHaveLength(1)
    })

    test('should detect FK changes when column type changes', async () => {
      // 舊配置：users 表格的 role_id 是 integer
      const oldUsersSchema = createMockTableSchema('users', [
        createMockColumnSchema('id', 'integer', false, true),
        createMockColumnSchema('role_id', 'integer', false)
      ])
      oldUsersSchema.foreignKeys = [
        {
          name: 'fk_role',
          columns: ['role_id'],
          refTable: 'roles',
          refColumns: ['id']
        }
      ]

      config.schema = {
        users: oldUsersSchema
      }

      // 新資料庫：role_id 類型改為 bigint（可能影響外鍵）
      const newUsersSchema = createMockTableSchema('users', [
        createMockColumnSchema('id', 'integer', false, true),
        createMockColumnSchema('role_id', 'bigint', false)
      ])
      newUsersSchema.foreignKeys = [
        {
          name: 'fk_role',
          columns: ['role_id'],
          refTable: 'roles',
          refColumns: ['id']
        }
      ]

      const adapter = createMockAdapter(
        async () => [newUsersSchema],
        async (name: string) => (name === 'users' ? newUsersSchema : createMockTableSchema(''))
      )

      const engine = new SchemaDiffEngine(adapter, config)
      const report = await engine.diff()

      // 驗證欄位類型變更被偵測
      expect(report.tablesModified['users'].columnsModified).toHaveLength(1)
      expect(report.tablesModified['users'].columnsModified[0].name).toBe('role_id')
    })
  })

  describe('diff - summary generation', () => {
    test('should format summary string correctly: "X added, Y removed, Z modified"', async () => {
      // 設定配置
      config.schema = {
        users: createMockTableSchema('users', [
          createMockColumnSchema('id', 'integer', false, true),
          createMockColumnSchema('name', 'varchar(100)', false)
        ]),
        posts: createMockTableSchema('posts')
      }

      // 新資料庫：新增 3 個表格，移除 1 個，修改 1 個（users 表格新增 4 個欄位）
      const currentTables = [
        createMockTableSchema('users', [
          createMockColumnSchema('id', 'integer', false, true),
          createMockColumnSchema('name', 'varchar(100)', false),
          createMockColumnSchema('email', 'varchar(255)', false),
          createMockColumnSchema('phone', 'varchar(20)', true),
          createMockColumnSchema('created_at', 'timestamp', true),
          createMockColumnSchema('updated_at', 'timestamp', true)
        ]),
        createMockTableSchema('comments'),
        createMockTableSchema('tags'),
        createMockTableSchema('categories')
      ]

      const adapter = createMockAdapter(
        async () => currentTables,
        async (name: string) => currentTables.find(t => t.name === name)!
      )

      const engine = new SchemaDiffEngine(adapter, config)
      const report = await engine.diff()

      // 驗證摘要格式：3 新增 (comments, tags, categories), 1 移除 (posts), 1 修改 (users)
      expect(report.summary).toBe('3 added, 1 removed, 1 modified')
    })

    test('should handle zero-change summary', async () => {
      config.schema = {
        users: createMockTableSchema('users', [
          createMockColumnSchema('id', 'integer', false, true),
          createMockColumnSchema('name', 'varchar(100)', false)
        ])
      }

      const currentTables = [
        createMockTableSchema('users', [
          createMockColumnSchema('id', 'integer', false, true),
          createMockColumnSchema('name', 'varchar(100)', false)
        ])
      ]

      const adapter = createMockAdapter(
        async () => currentTables,
        async (name: string) => currentTables.find(t => t.name === name)!
      )

      const engine = new SchemaDiffEngine(adapter, config)
      const report = await engine.diff()

      expect(report.summary).toBe('0 added, 0 removed, 0 modified')
    })
  })

  describe('diff - edge cases', () => {
    test('should handle first-time diff with empty previous schema', async () => {
      // 空的前一個架構
      config.schema = {}

      const currentTables = [
        createMockTableSchema('users'),
        createMockTableSchema('posts'),
        createMockTableSchema('comments')
      ]

      const adapter = createMockAdapter(async () => currentTables)

      const engine = new SchemaDiffEngine(adapter, config)
      const report = await engine.diff()

      // 所有表格應該被標記為新增
      expect(report.tablesAdded).toHaveLength(3)
      expect(report.tablesAdded).toContain('users')
      expect(report.tablesAdded).toContain('posts')
      expect(report.tablesAdded).toContain('comments')
      expect(report.tablesRemoved).toHaveLength(0)
      expect(Object.keys(report.tablesModified)).toHaveLength(0)
    })

    test('should handle all-dropped scenario with empty current schema', async () => {
      // 前一個架構有表格
      config.schema = {
        users: createMockTableSchema('users'),
        posts: createMockTableSchema('posts'),
        comments: createMockTableSchema('comments')
      }

      // 空的目前架構
      const adapter = createMockAdapter(async () => [])

      const engine = new SchemaDiffEngine(adapter, config)
      const report = await engine.diff()

      // 所有表格應該被標記為移除
      expect(report.tablesAdded).toHaveLength(0)
      expect(report.tablesRemoved).toHaveLength(3)
      expect(report.tablesRemoved).toContain('users')
      expect(report.tablesRemoved).toContain('posts')
      expect(report.tablesRemoved).toContain('comments')
      expect(Object.keys(report.tablesModified)).toHaveLength(0)
    })

    test('should handle no changes at all', async () => {
      config.schema = {
        users: createMockTableSchema('users', [
          createMockColumnSchema('id', 'integer', false, true),
          createMockColumnSchema('name', 'varchar(100)', false),
          createMockColumnSchema('email', 'varchar(255)', false)
        ]),
        posts: createMockTableSchema('posts', [
          createMockColumnSchema('id', 'integer', false, true),
          createMockColumnSchema('title', 'varchar(255)', false),
          createMockColumnSchema('user_id', 'integer', false)
        ])
      }

      const currentTables = [
        createMockTableSchema('users', [
          createMockColumnSchema('id', 'integer', false, true),
          createMockColumnSchema('name', 'varchar(100)', false),
          createMockColumnSchema('email', 'varchar(255)', false)
        ]),
        createMockTableSchema('posts', [
          createMockColumnSchema('id', 'integer', false, true),
          createMockColumnSchema('title', 'varchar(255)', false),
          createMockColumnSchema('user_id', 'integer', false)
        ])
      ]

      const adapter = createMockAdapter(
        async () => currentTables,
        async (name: string) => currentTables.find(t => t.name === name)!
      )

      const engine = new SchemaDiffEngine(adapter, config)
      const report = await engine.diff()

      expect(report.tablesAdded).toHaveLength(0)
      expect(report.tablesRemoved).toHaveLength(0)
      expect(Object.keys(report.tablesModified)).toHaveLength(0)
      expect(report.summary).toBe('0 added, 0 removed, 0 modified')
    })
  })
})

/**
 * 輔助函數：建立模擬表格架構
 */
function createMockTableSchema(
  name: string,
  columns: ColumnSchema[] = []
): TableSchema {
  return {
    name,
    columns: columns.length > 0 ? columns : [createMockColumnSchema('id', 'integer', false, true)],
    rowCount: 0,
    engine: 'InnoDB',
    primaryKey: ['id'],
    foreignKeys: []
  }
}

/**
 * 輔助函數：建立模擬欄位架構
 */
function createMockColumnSchema(
  name: string,
  type: string,
  nullable: boolean = false,
  primaryKey: boolean = false,
  defaultValue?: string
): ColumnSchema {
  return {
    name,
    type,
    nullable,
    primaryKey,
    default: defaultValue
  }
}
