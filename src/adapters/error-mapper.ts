/**
 * Error mapper for database connection errors
 * Categorizes driver errors into user-friendly messages with actionable hints
 */

import { ConnectionError, type ConnectionOptions } from './types'

/**
 * Map database and OS errors to user-friendly ConnectionError with categorized hints
 *
 * @param error The original error from driver or OS
 * @param system Database system type for system-specific hints
 * @param options Connection options for context in error messages
 * @returns ConnectionError with categorized code, message, and troubleshooting hints
 */
export function mapError(
  error: unknown,
  system: 'postgresql' | 'mysql' | 'mariadb',
  options: ConnectionOptions
): ConnectionError {
  const err = error as Record<string, unknown>
  const errMsg = String(err?.message || String(error))
  const errCode = String(err?.code || '')

  // ECONNREFUSED: Server not running or port not listening
  if (errCode === 'ECONNREFUSED' || errMsg.includes('refused')) {
    return new ConnectionError(
      'ECONNREFUSED',
      `無法連接至 ${options.host}:${options.port} — 伺服器未運行或未監聽該埠號`,
      [
        `確認 ${system} 服務已啟動: ${
          system === 'postgresql' ? 'systemctl status postgresql' : 'systemctl status mysql'
        }`,
        `確認埠號正確: ${system === 'postgresql' ? '預設 5432' : '預設 3306'}`,
        `檢查 ${options.host} 是否可達: ping ${options.host} 或 telnet ${options.host} ${options.port}`,
      ]
    )
  }

  // ETIMEDOUT: Firewall or slow network
  if (errCode === 'ETIMEDOUT' || errMsg.includes('timeout') || errMsg.includes('timed out')) {
    return new ConnectionError(
      'ETIMEDOUT',
      `連接超時 (${options.timeout || 5000}ms) — 可能是防火牆阻擋或網路延遲`,
      [
        `檢查防火牆: ${system === 'postgresql' ? '允許 TCP 5432' : '允許 TCP 3306'}`,
        `增加超時時間: 編輯 .dbcli 並新增 "timeout": 15000`,
        `確認網路連接: ping ${options.host} -c 3`,
      ]
    )
  }

  // AUTH_FAILED: Authentication (credentials) error
  if (
    errMsg.includes('authentication') ||
    errMsg.includes('auth') ||
    errMsg.includes('password') ||
    errMsg.includes('access denied') ||
    errMsg.includes('FATAL')
  ) {
    return new ConnectionError(
      'AUTH_FAILED',
      `認證失敗 — 檢查使用者名稱或密碼`,
      [
        `驗證認證: ${
          system === 'postgresql'
            ? `psql -U ${options.user} -h ${options.host}`
            : `mysql -u ${options.user} -h ${options.host}`
        }`,
        `檢查 pg_hba.conf (PostgreSQL) 或 user privileges (MySQL)`,
        `重新執行 dbcli init 以更新認證`,
      ]
    )
  }

  // ENOTFOUND: Host not found (DNS resolution failed)
  if (errCode === 'ENOTFOUND' || errMsg.includes('not found') || errMsg.includes('getaddrinfo')) {
    return new ConnectionError(
      'ENOTFOUND',
      `找不到主機: ${options.host}`,
      [
        `檢查主機名拼寫: ${options.host}`,
        `確認 DNS 可解析: nslookup ${options.host}`,
        `若使用 localhost，試試 127.0.0.1 (IPv4 vs IPv6 問題)`,
      ]
    )
  }

  // UNKNOWN: Fallback for unrecognized errors
  return new ConnectionError(
    'UNKNOWN',
    `連接失敗: ${errMsg}`,
    [
      `檢查連接參數: host=${options.host}, port=${options.port}, user=${options.user}`,
      `查看伺服器日誌: ${system === 'postgresql' ? 'postgresql.log' : 'mysql.log'}`,
      `嘗試直接用 ${system === 'postgresql' ? 'psql' : 'mysql'} 命令行工具測試`,
    ]
  )
}

// Re-export ConnectionError for convenience
export { ConnectionError }
