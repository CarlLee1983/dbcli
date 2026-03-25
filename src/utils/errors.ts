/**
 * 自訂錯誤類用於環境解析和配置操作
 */

/**
 * .env 解析失敗時拋出
 * 用於：DATABASE_URL 解析失敗、無效的百分比編碼、缺少必要的 DB_* 變數
 */
export class EnvParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EnvParseError'
    // 維護堆疊追蹤以便除錯
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, EnvParseError)
    }
  }
}

/**
 * .dbcli 配置讀取/寫入或驗證失敗時拋出
 * 用於：.dbcli 讀取/寫入失敗、驗證失敗、配置不匹配
 */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigError'
    // 維護堆疊追蹤以便除錯
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ConfigError)
    }
  }
}
