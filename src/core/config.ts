/**
 * 不可變配置讀取/寫入/合併模組
 *
 * 提供使用複製語義（copy-on-write）的原子操作
 * 所有操作返回新對象，永不修改輸入
 */

import { DbcliConfig, DbcliConfigSchema } from '@/utils/validation'
import { ConfigError } from '@/utils/errors'

/**
 * 預設配置值
 */
const DEFAULT_CONFIG: DbcliConfig = {
  connection: {
    system: 'postgresql',
    host: 'localhost',
    port: 5432,
    user: '',
    password: '',
    database: ''
  },
  permission: 'query-only',
  schema: {},
  metadata: {
    version: '1.0'
  }
}

/**
 * 配置模組：讀取、驗證、合併、寫入
 */
export const configModule = {
  /**
   * 讀取 .dbcli 配置文件
   * 如果文件不存在，返回預設配置
   *
   * @param path - .dbcli 文件路徑
   * @returns DbcliConfig
   * @throws ConfigError 如果 JSON 無效或驗證失敗
   */
  async read(path: string): Promise<DbcliConfig> {
    try {
      const file = Bun.file(path)
      const exists = await file.exists()

      if (!exists) {
        return { ...DEFAULT_CONFIG }
      }

      const content = await file.text()
      const raw = JSON.parse(content)

      return DbcliConfigSchema.parse(raw)
    } catch (error) {
      if (error instanceof Error && error.message.includes('JSON')) {
        throw new ConfigError(`無法解析 .dbcli 文件：${error.message}`)
      }
      throw new ConfigError(
        `無法讀取 .dbcli 配置: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  },

  /**
   * 驗證原始資料符合 DbcliConfig 模式
   *
   * @param raw - 要驗證的原始資料
   * @returns DbcliConfig 已驗證的配置
   * @throws ConfigError 如果驗證失敗
   */
  validate(raw: unknown): DbcliConfig {
    try {
      return DbcliConfigSchema.parse(raw)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      throw new ConfigError(`無效的 .dbcli 配置結構: ${errorMessage}`)
    }
  },

  /**
   * 使用不可變語義合併兩個配置對象
   *
   * 特性：
   * - 返回新對象（從不修改輸入）
   * - 深度合併嵌套對象（connection、metadata、schema）
   * - 保留現有的 metadata.createdAt
   * - 如果沒有 createdAt，設置當前時間戳
   *
   * @param existing - 現有配置
   * @param updates - 要應用的更新（部分配置）
   * @returns DbcliConfig 新的合併配置
   */
  merge(existing: DbcliConfig, updates: Partial<DbcliConfig>): DbcliConfig {
    const mergedConfig: DbcliConfig = {
      ...existing,
      ...updates,
      connection: {
        ...existing.connection,
        ...(updates.connection || {})
      },
      schema: {
        ...existing.schema,
        ...(updates.schema || {})
      },
      metadata: {
        ...existing.metadata,
        ...(updates.metadata || {}),
        // 保留原始的 createdAt，如果不存在則設置新值
        createdAt: existing.metadata?.createdAt || new Date().toISOString(),
        version: (existing.metadata?.version || '1.0')
      }
    }

    return mergedConfig
  },

  /**
   * 寫入配置到 .dbcli 文件
   *
   * 特性：
   * - 先驗證後寫入（失敗快速）
   * - 使用 2 空格縮進格式化 JSON
   * - 使用 Bun.file 進行寫入
   *
   * @param path - .dbcli 文件路徑
   * @param config - 要寫入的配置
   * @throws ConfigError 如果驗證或寫入失敗
   */
  async write(path: string, config: DbcliConfig): Promise<void> {
    try {
      // 先驗證，確保不寫入無效配置
      this.validate(config)

      const json = JSON.stringify(config, null, 2)
      await Bun.file(path).write(json)
    } catch (error) {
      if (error instanceof ConfigError) {
        throw error
      }
      throw new ConfigError(
        `無法寫入 .dbcli 配置: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }
}
