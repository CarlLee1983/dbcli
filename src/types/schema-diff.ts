/**
 * 模式差異檢測型別定義
 * 用於比較前一個架構快照和即時資料庫架構
 */

import type { ColumnSchema } from '@/adapters/types'

/**
 * 欄位變更紀錄
 * 記錄單一欄位的前後狀態
 */
export interface ColumnDiff {
  /** 欄位名稱 */
  name: string
  /** 變更前的欄位架構 */
  previous: ColumnSchema
  /** 變更後的欄位架構 */
  current: ColumnSchema
}

/**
 * 表格層級的差異詳情
 * 記錄特定表格內的欄位變更（新增、移除、修改）
 */
export interface TableDiffDetail {
  /** 新增的欄位名稱陣列 */
  columnsAdded: string[]
  /** 移除的欄位名稱陣列 */
  columnsRemoved: string[]
  /** 修改過的欄位 - 包含前後狀態對比 */
  columnsModified: ColumnDiff[]
}

/**
 * 完整的模式差異報告
 * 包含所有表格層級和欄位層級的變更，以及人類可讀的摘要
 */
export interface SchemaDiffReport {
  /** 新增的表格名稱陣列 */
  tablesAdded: string[]
  /** 移除的表格名稱陣列 */
  tablesRemoved: string[]
  /** 修改的表格及其欄位變更詳情 - 按表格名稱鍵值對應 */
  tablesModified: Record<string, TableDiffDetail>
  /** 人類可讀的摘要字串，例如 "3 added, 2 removed, 5 modified" */
  summary: string
}
