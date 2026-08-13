/**
 * 連線逾時與語句逾時——兩個概念，兩個值。
 *
 * 先前只有一個 `timeout`，而 PostgreSQL adapter 把它同時餵給
 * `connectionTimeoutMillis` 與 `statement_timeout`。後果是預設值 5000ms 變成
 * 全域的查詢上限：一句跑六秒的分析查詢會被伺服器砍掉，而使用者只是沒有調整
 * 一個名字裡寫著「連線」的旗標。MySQL 則相反——兩者都沒消費，`--timeout`
 * 對它形同無效。
 *
 * 拆開之後：連線逾時永遠有預設（連不上要快速失敗），語句逾時預設不存在
 * （伺服器不該替使用者決定一句查詢能跑多久）。明確給了 `--timeout` 才同時
 * 收緊兩者——那是使用者說「這次執行我最多等這麼久」的意思；要單獨放寬慢查詢
 * 而不放寬連線偵測，用 `--statement-timeout`。
 */

/** 連不上時要多快失敗。與一句查詢能跑多久無關。 */
export const DEFAULT_CONNECT_TIMEOUT_MS = 5000

export interface TimeoutPolicy {
  /** 建立連線的上限，毫秒 */
  connectMs: number
  /** 單句語句的上限，毫秒；undefined 表示不設上限（伺服器預設） */
  statementMs: number | undefined
}

export function resolveTimeoutPolicy(options: {
  timeout?: number
  statementTimeout?: number
}): TimeoutPolicy {
  return {
    connectMs: options.timeout ?? DEFAULT_CONNECT_TIMEOUT_MS,
    statementMs: options.statementTimeout ?? options.timeout,
  }
}

/**
 * session 級語句逾時的 SQL。
 *
 * MySQL 的 `max_execution_time` 是毫秒；MariaDB 的 `max_statement_time` 是秒
 * 且接受小數——直接把毫秒數丟給 MariaDB 會把 3 秒變成 3000 秒，整數化則會把
 * 500ms 變成 0（＝取消上限）。兩者的 0 都表示不限制。
 */
export function statementTimeoutSql(system: 'mysql' | 'mariadb', ms: number): string {
  if (system === 'mariadb') {
    return `SET SESSION max_statement_time = ${ms / 1000}`
  }
  return `SET SESSION max_execution_time = ${Math.round(ms)}`
}
