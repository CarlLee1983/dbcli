/**
 * 資料修改操作的型別定義
 * 定義資料修改（INSERT、UPDATE、DELETE）操作的結果和選項
 */

/**
 * 資料執行操作的結果
 * 用於包裝資料修改操作的執行結果和元數據
 */
export interface DataExecutionResult {
  /** 執行狀態：成功或錯誤 */
  status: 'success' | 'error'

  /** 執行的操作類型 */
  operation: 'insert' | 'update' | 'delete'

  /** 受影響的資料列數 */
  rows_affected: number

  /** ISO 8601 格式的執行時間戳 */
  timestamp?: string

  /** 生成的 SQL 語句（用於確認和錯誤訊息） */
  sql?: string

  /** 錯誤訊息（僅在 status 為 'error' 時） */
  error?: string
}

/**
 * 資料執行選項
 * 控制資料修改操作的執行方式
 */
export interface DataExecutionOptions {
  /** 乾執行模式：顯示 SQL 但不執行 */
  dryRun?: boolean

  /** 跳過確認提示 */
  force?: boolean

  /** 詳細輸出 */
  verbose?: boolean
}
