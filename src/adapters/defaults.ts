/**
 * 資料庫系統特定的預設值
 * 用於 env-parser、config 和 init 命令
 */

import { ConnectionConfig } from '@/types'

/**
 * 為指定的資料庫系統取得預設配置值
 *
 * @example
 * getDefaultsForSystem('postgresql')
 * // 返回 { port: 5432, host: 'localhost' }
 */
export function getDefaultsForSystem(
  system: 'postgresql' | 'mysql' | 'mariadb'
): Partial<ConnectionConfig> {
  switch (system) {
    case 'postgresql':
      return {
        port: 5432,
        host: 'localhost'
      }
    case 'mysql':
    case 'mariadb':
      return {
        port: 3306,
        host: 'localhost'
      }
    default:
      // 應該永遠不會到達這裡（TypeScript 會捕捉）
      // 但以防萬一提供一個合理的預設值
      return {
        port: 3306,
        host: 'localhost'
      }
  }
}
