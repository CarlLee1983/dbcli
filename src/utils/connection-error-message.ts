/**
 * `ConnectionError` 的名字名不副實：它是 adapter 層所有錯誤的載體，`code` 才是
 * 真正的分類，九個值裡只有四個是連線問題。命令端用 `instanceof` 判斷，於是
 * 「找不到資料表」「SQL 語法錯誤」「語句逾時」都被冠上「無法連接到資料庫」——
 * 連線是通的，錯的是那道語句，而使用者被指向完全錯誤的方向（issue #61）。
 *
 * 這裡只決定措辭，排版仍交給 `formatCliError`：hint 與 code 的呈現要與 `query`
 * 走的集中路徑一致，否則同一個錯誤在不同命令下會長得不一樣。
 */

import { ConnectionError, type ConnectionErrorCode } from '@/adapters/types'
import type { CliErrorPresentation } from './cli-error'
import { isTransportDriverCode } from '@/adapters/error-mapper'
import { t_vars } from '@/i18n/message-loader'

/**
 * 每個 code 是不是「連不上伺服器」。寫成涵蓋整個 union 的 Record 而非集合：
 * 日後新增一個 code 時，這裡不補就編不過——這個分類是使用者看到哪句話的唯一
 * 依據，預設值靜默生效正是要防的事。
 */
export const IS_TRANSPORT_FAILURE: Record<ConnectionErrorCode, boolean> = {
  ECONNREFUSED: true,
  ETIMEDOUT: true,
  AUTH_FAILED: true,
  ENOTFOUND: true,
  EHOSTUNREACH: true,
  CONNECTION_LOST: true,
  TOO_MANY_CONNECTIONS: true,
  TLS_ERROR: true,
  SERVER_NOT_READY: true,
  CONNECTION_REJECTED: true,
  STATEMENT_TIMEOUT: false,
  SQL_SYNTAX_ERROR: false,
  TABLE_NOT_FOUND: false,
  COLUMN_NOT_FOUND: false,
  // 有 code 的 UNKNOWN 幾乎都是伺服器回報的語句錯誤；無 code 的那條後備路徑
  // 訊息本身已是 `Connection failed: …`，措辭不會失真。
  UNKNOWN: false,
}

/**
 * 一個 ConnectionError 該呈現給使用者的內容。輸出、排版與 exit code 由呼叫端
 * 負責——這裡不碰 stack，verbose 與否是呈現層的決定。
 */
/**
 * 這個錯誤代表「連線本身壞了」嗎。repl 的自動重連據此決定要不要重連——語句層級的
 * 失敗重連沒有意義，而先前它用的是自己那份非窮舉的 code 清單加訊息子字串比對。
 */
export function isTransportFailure(error: unknown): boolean {
  if (error instanceof ConnectionError) return IS_TRANSPORT_FAILURE[error.code]
  // 還沒經過 mapError 的原始 driver 錯誤：查 adapter 那份 code 表，不另立清單
  const raw = (error as { code?: unknown } | null)?.code
  return typeof raw === 'string' && isTransportDriverCode(raw)
}

export function presentConnectionError(error: ConnectionError): CliErrorPresentation {
  const key = IS_TRANSPORT_FAILURE[error.code] ? 'errors.connection_failed' : 'errors.message'
  return {
    message: t_vars(key, { message: error.message }),
    code: error.code,
    hints: error.hints,
  }
}
