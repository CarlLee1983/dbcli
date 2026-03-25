/**
 * .env 檔案解析器
 * 支援 DATABASE_URL 格式和 DB_* 元件格式
 */

import { DatabaseEnv } from '@/types'
import { EnvParseError } from '@/utils/errors'
import { getDefaultsForSystem } from '@/adapters/defaults'

/**
 * 從 DATABASE_URL 解析連接資訊
 * 支援 RFC 3986 百分比編碼（密碼中的特殊字符）
 *
 * @example
 * parseConnectionUrl('postgresql://user:p%40ssword@localhost:5432/mydb')
 * // 返回 { system: 'postgresql', host: 'localhost', port: 5432, user: 'user', password: 'p@ssword', database: 'mydb' }
 */
export function parseConnectionUrl(url: string): DatabaseEnv {
  try {
    const parsed = new URL(url)

    // 從協議檢測資料庫系統
    const protocol = parsed.protocol.replace(':', '')
    let system: 'postgresql' | 'mysql' | 'mariadb'

    if (protocol === 'postgresql' || protocol === 'postgres') {
      system = 'postgresql'
    } else if (protocol === 'mysql') {
      system = 'mysql'
    } else if (protocol === 'mariadb') {
      system = 'mariadb'
    } else {
      throw new Error(`不支援的協議: ${protocol}`)
    }

    // 提取元件，使用百分比解碼處理特殊字符
    const host = parsed.hostname || 'localhost'
    const port =
      parsed.port !== ''
        ? parseInt(parsed.port, 10)
        : getDefaultsForSystem(system).port || 5432

    // CRITICAL: 解碼使用者名稱和密碼以處理特殊字符
    const user = decodeURIComponent(parsed.username || '')
    const password = decodeURIComponent(parsed.password || '')
    const database = parsed.pathname.slice(1) // 移除前導 /

    return { system, host, port, user, password, database }
  } catch (error) {
    throw new EnvParseError(
      `無法解析 DATABASE_URL: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}

/**
 * 從環境變數解析資料庫配置
 *
 * 優先順序：
 * 1. DATABASE_URL（完整連接字符串）
 * 2. DB_* 元件（DB_HOST、DB_PORT、DB_USER、DB_PASSWORD、DB_NAME）
 * 3. 如果都不存在則返回 null
 *
 * @returns DatabaseEnv 或 null 如果未找到資料庫配置
 * @throws EnvParseError 如果元件不完整或無效
 */
export function parseEnvDatabase(env: Record<string, string>): DatabaseEnv | null {
  // 路徑 1：DATABASE_URL（完整連接字符串）
  if (env.DATABASE_URL) {
    return parseConnectionUrl(env.DATABASE_URL)
  }

  // 路徑 2：DB_* 元件
  if (env.DB_HOST || env.DB_USER) {
    const system = (env.DB_SYSTEM || 'postgresql') as 'postgresql' | 'mysql' | 'mariadb'
    const user = env.DB_USER
    const database = env.DB_NAME

    // 驗證必需欄位
    if (!user) {
      throw new EnvParseError('使用元件格式時 DB_USER 為必需')
    }
    if (!database) {
      throw new EnvParseError('使用元件格式時 DB_NAME 為必需')
    }

    const defaults = getDefaultsForSystem(system)
    const port = env.DB_PORT ? parseInt(env.DB_PORT, 10) : (defaults.port || 5432)

    // 驗證埠號有效性
    if (isNaN(port) || port < 1 || port > 65535) {
      throw new EnvParseError(`DB_PORT 必須在 1 到 65535 之間，得到: ${env.DB_PORT}`)
    }

    return {
      system,
      host: env.DB_HOST || defaults.host || 'localhost',
      port,
      user,
      password: env.DB_PASSWORD || '',
      database
    }
  }

  // 未找到任何資料庫配置
  return null
}
