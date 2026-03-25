/**
 * 模式差異檢測引擎
 * 比較前一個架構快照和即時資料庫架構，偵測並報告變更
 */

import type { DatabaseAdapter, ColumnSchema } from '@/adapters/types'
import type { DbcliConfig } from '@/utils/validation'
import type { SchemaDiffReport, TableDiffDetail, ColumnDiff } from '@/types/schema-diff'

/**
 * 模式差異檢測引擎
 * 執行增量式模式比對，偵測新增、移除和修改的表格及欄位
 */
export class SchemaDiffEngine {
  constructor(
    private adapter: DatabaseAdapter,
    private previousConfig: DbcliConfig
  ) {}

  /**
   * 執行模式差異檢測
   * 比較前一個架構快照（來自 .dbcli 配置）與即時資料庫架構
   * @returns 差異報告，包含表格和欄位層級的變更詳情
   */
  async diff(): Promise<SchemaDiffReport> {
    // 第一階段：表格層級的比對

    // 獲取目前資料庫中的表格列表
    const currentTables = await this.adapter.listTables()
    const currentTableNames = new Set(currentTables.map(t => t.name))

    // 獲取前一個配置中的表格列表
    const previousTableNames = new Set(Object.keys(this.previousConfig.schema || {}))

    // 偵測表格層級的變更
    const tablesAdded = Array.from(currentTableNames).filter(t => !previousTableNames.has(t))
    const tablesRemoved = Array.from(previousTableNames).filter(t => !currentTableNames.has(t))

    // 第二階段：欄位層級的比對（針對存在於雙邊的表格）

    const tablesModified: Record<string, TableDiffDetail> = {}

    // 取得同時存在於舊配置和新資料庫中的表格名稱
    const unmodifiedTableNames = Array.from(currentTableNames).filter(t => previousTableNames.has(t))

    for (const tableName of unmodifiedTableNames) {
      const currentSchema = await this.adapter.getTableSchema(tableName)
      const previousSchema = this.previousConfig.schema![tableName]

      if (!previousSchema) continue

      // 將欄位列表轉換為 Map，便於快速查詢
      const currentColsMap = new Map(currentSchema.columns.map(c => [c.name, c]))
      const previousColsMap = new Map(previousSchema.columns.map(c => [c.name, c]))

      // 偵測欄位層級的變更
      const columnsAdded = Array.from(currentColsMap.keys()).filter(c => !previousColsMap.has(c))
      const columnsRemoved = Array.from(previousColsMap.keys()).filter(c => !currentColsMap.has(c))

      // 偵測修改過的欄位（名稱相同，但其他屬性改變）
      const columnsModified: ColumnDiff[] = []
      for (const colName of Array.from(currentColsMap.keys()).filter(c => previousColsMap.has(c))) {
        const prev = previousColsMap.get(colName)!
        const curr = currentColsMap.get(colName)!
        if (this.columnChanged(prev, curr)) {
          columnsModified.push({
            name: colName,
            previous: prev,
            current: curr
          })
        }
      }

      // 只在有變更時，才將此表格加入修改列表
      if (columnsAdded.length > 0 || columnsRemoved.length > 0 || columnsModified.length > 0) {
        tablesModified[tableName] = {
          columnsAdded,
          columnsRemoved,
          columnsModified
        }
      }
    }

    // 生成人類可讀的摘要字串
    const summary = `${tablesAdded.length} added, ${tablesRemoved.length} removed, ${Object.keys(tablesModified).length} modified`

    return {
      tablesAdded,
      tablesRemoved,
      tablesModified,
      summary
    }
  }

  /**
   * 檢查兩個欄位架構是否有差異
   * 比對類型、可空性、預設值和主鍵屬性
   * 類型比對時進行大小寫正規化，以處理資料庫特定的格式差異
   *
   * @param prev 前一個欄位架構
   * @param curr 目前的欄位架構
   * @returns 若欄位已變更則返回 true，否則返回 false
   */
  private columnChanged(prev: ColumnSchema, curr: ColumnSchema): boolean {
    // 型別比較 - 正規化為小寫以處理大小寫差異（如 VARCHAR vs varchar）
    const typeChanged = prev.type.toLowerCase() !== curr.type.toLowerCase()

    // 可空性比較
    const nullableChanged = prev.nullable !== curr.nullable

    // 預設值比較
    const defaultChanged = prev.default !== curr.default

    // 主鍵屬性比較
    const primaryKeyChanged = (prev.primaryKey ?? false) !== (curr.primaryKey ?? false)

    return typeChanged || nullableChanged || defaultChanged || primaryKeyChanged
  }
}
