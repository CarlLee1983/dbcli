/**
 * 不可變配置讀取/寫入/合併模組
 *
 * 提供使用複製語義（copy-on-write）的原子操作
 * 所有操作返回新對象，永不修改輸入
 *
 * 支持兩種配置方式：
 * 1. 目錄方式（推薦）: .dbcli/ (config.json + .env.local)
 * 2. 檔案方式（舊版）: .dbcli (單個 JSON 檔案)
 */

import { DbcliConfig, DbcliConfigSchema } from '@/utils/validation'
import { ConfigError } from '@/utils/errors'
import { readFileSync } from 'fs'
import { join } from 'path'

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
 * 環境變量引用介面
 * 支持 { "$env": "ENV_VAR_NAME" } 的引用語法
 */
interface EnvReference {
  $env: string
}

/**
 * 檢查值是否為環境變量引用
 */
function isEnvReference(value: unknown): value is EnvReference {
  return (
    typeof value === 'object' &&
    value !== null &&
    '$env' in value &&
    typeof (value as EnvReference).$env === 'string'
  )
}

/**
 * 遞迴解析和替換配置中的環境變量引用
 * 支持嵌套物件和陣列
 * 自動轉換類型（port 應轉為數字）
 *
 * @param config - 要解析的配置物件
 * @param env - 環境變量對象（通常是 process.env）
 * @param parentKey - 父物件的鍵名（用於類型推斷）
 * @returns 解析後的配置
 * @throws ConfigError 如果環境變量未找到
 */
function resolveEnvReferences(config: any, env: Record<string, string>, parentKey?: string): any {
  if (isEnvReference(config)) {
    const envKey = config.$env
    const value = env[envKey]
    if (!value) {
      throw new ConfigError(
        `環境變量未定義: ${envKey}\n` +
        `請在 .env 或環境變量中設置 ${envKey}。\n` +
        `提示: 檢查 .env 文件或執行 'export ${envKey}=<值>'`
      )
    }

    // 根據鍵名進行類型轉換
    if (parentKey === 'port') {
      const portNum = parseInt(value, 10)
      if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
        throw new ConfigError(`${envKey} 必須是有效的端口號 (1-65535)，得到: ${value}`)
      }
      return portNum
    }

    return value
  }

  if (Array.isArray(config)) {
    return config.map(item => resolveEnvReferences(item, env, parentKey))
  }

  if (typeof config === 'object' && config !== null) {
    const resolved: any = {}
    for (const [key, value] of Object.entries(config)) {
      resolved[key] = resolveEnvReferences(value, env, key)
    }
    return resolved
  }

  return config
}

/**
 * 從 .env 格式檔案中提取密碼
 */
function parseEnvPassword(content: string): string | null {
  const match = content.match(/^DBCLI_PASSWORD=(.+)$/m)
  return match ? match[1].trim() : null
}

/**
 * 配置模組：讀取、驗證、合併、寫入
 */
export const configModule = {
  /**
   * 讀取配置（支持目錄和檔案兩種方式）
   * 1. 如果 path 是目錄：讀取 .dbcli/config.json 和 .dbcli/.env.local
   * 2. 如果 path 是檔案：讀取舊式單檔案 .dbcli (向後相容)
   * 如果都不存在，返回預設配置
   *
   * @param path - .dbcli 目錄或檔案路徑
   * @returns DbcliConfig
   * @throws ConfigError 如果 JSON 無效或驗證失敗
   */
  async read(path: string): Promise<DbcliConfig> {
    try {
      // 檢查是否為目錄
      let isDirectory = false
      try {
        const stat = await Bun.file(path).stat()
        isDirectory = stat?.isDirectory() ?? false
      } catch {
        isDirectory = false
      }

      // 嘗試讀取目錄方式（新）
      if (isDirectory) {
        const configPath = join(path, 'config.json')
        const configFile = Bun.file(configPath)
        const configExists = await configFile.exists()

        if (configExists) {
          const content = await configFile.text()
          const config = JSON.parse(content)

          // 解析環境變量引用 { "$env": "KEY" }
          const resolvedConfig = resolveEnvReferences(config, process.env)

          // 嘗試讀取 .env.local 中的敏感信息（舊方式，保持向後相容）
          const envPath = join(path, '.env.local')
          const envFile = Bun.file(envPath)
          if (await envFile.exists()) {
            const envContent = await envFile.text()
            const password = parseEnvPassword(envContent)
            if (password && !resolvedConfig.connection.password) {
              resolvedConfig.connection.password = password
            }
          }

          return DbcliConfigSchema.parse(resolvedConfig)
        }
      }

      // 嘗試舊式檔案方式（向後相容）
      const file = Bun.file(path)
      const exists = await file.exists()

      if (exists) {
        const content = await file.text()
        const raw = JSON.parse(content)
        // 解析環境變量引用
        const resolved = resolveEnvReferences(raw, process.env)
        return DbcliConfigSchema.parse(resolved)
      }

      // 都不存在，返回預設配置
      return { ...DEFAULT_CONFIG }
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
   * 寫入配置到 .dbcli（支持目錄和檔案）
   *
   * 目錄方式 (.dbcli/):
   * - config.json: 主配置（不含密碼）
   * - .env.local: 敏感信息（密碼）
   *
   * 檔案方式 (.dbcli):
   * - 單個 JSON 檔案（舊版，向後相容）
   *
   * 特性：
   * - 先驗證後寫入（失敗快速）
   * - 使用 2 空格縮進格式化 JSON
   * - 使用 Bun.file 進行寫入
   *
   * @param path - .dbcli 目錄或檔案路徑
   * @param config - 要寫入的配置
   * @throws ConfigError 如果驗證或寫入失敗
   */
  async write(path: string, config: DbcliConfig): Promise<void> {
    try {
      // 先驗證，確保不寫入無效配置
      this.validate(config)

      const pathObj = Bun.file(path)
      const isDirectory = (await pathObj.exists()) && pathObj.type === 'directory'

      // 目錄方式：分離 config 和 .env.local
      if (isDirectory || path.endsWith('.dbcli')) {
        // 檢查是否使用環境變量引用（password 是 { "$env": "..." } 對象）
        const hasEnvReferences = isEnvReference((config.connection as any).password)

        if (hasEnvReferences) {
          // 新方式：使用環境變量引用，直接寫入 config.json
          const configPath = join(path, 'config.json')
          const configJson = JSON.stringify(config, null, 2)
          await Bun.file(configPath).write(configJson)
        } else {
          // 舊方式：密碼分離到 .env.local
          const password = config.connection.password
          const configWithoutPassword = {
            ...config,
            connection: {
              ...config.connection,
              password: undefined
            }
          }
          delete (configWithoutPassword.connection as any).password

          // 寫入 config.json（不含密碼）
          const configPath = join(path, 'config.json')
          const configJson = JSON.stringify(configWithoutPassword, null, 2)
          await Bun.file(configPath).write(configJson)

          // 寫入 .env.local（密碼）
          if (password) {
            const envPath = join(path, '.env.local')
            const envContent = `# 資料庫敏感信息 - 請勿提交到 git\n# Database Credentials - DO NOT commit to git\n\nDBCLI_PASSWORD=${password}\n`
            await Bun.file(envPath).write(envContent)
          }
        }
      } else {
        // 舊式檔案方式（向後相容）
        const json = JSON.stringify(config, null, 2)
        await Bun.file(path).write(json)
      }
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
