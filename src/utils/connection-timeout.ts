/**
 * Per-invocation connection timeout override (root-level --timeout)
 *
 * Kept in its own dependency-free module because both ends need it: cli.ts sets
 * it from the parsed flag, and AdapterFactory reads it when building an adapter.
 *
 * Resolution happens at adapter construction, never at config read. A resolved
 * value merged into the config object would be persisted by any command that
 * follows the read → mutate → write path (blacklist, init, schema), turning a
 * one-shot flag into a permanent setting the user never asked for.
 */

let _globalConnectionTimeout: number | undefined
let _globalStatementTimeout: number | undefined

/**
 * 設定全域連線逾時覆寫（由 cli.ts preAction hook 呼叫）
 *
 * @param timeout - 毫秒；undefined 表示本次執行沒有指定 --timeout
 */
export function setGlobalConnectionTimeout(timeout: number | undefined): void {
  _globalConnectionTimeout = timeout
}

/**
 * 取得目前全域連線逾時覆寫（主要供測試使用）
 */
export function getGlobalConnectionTimeout(): number | undefined {
  return _globalConnectionTimeout
}

/**
 * 設定全域語句逾時覆寫（由 cli.ts preAction hook 呼叫）
 *
 * 與連線逾時分開，因為它們回答的是不同問題：連線逾時問「連不上時要多快放棄」，
 * 語句逾時問「一句查詢最多能跑多久」。放寬後者不該連帶放寬前者。
 *
 * @param timeout - 毫秒；0 表示取消上限；undefined 表示本次執行沒有指定
 */
export function setGlobalStatementTimeout(timeout: number | undefined): void {
  _globalStatementTimeout = timeout
}

/**
 * 取得目前全域語句逾時覆寫（主要供測試使用）
 */
export function getGlobalStatementTimeout(): number | undefined {
  return _globalStatementTimeout
}

/**
 * 決定一條連線的實際逾時：--timeout 優先於設定檔，兩者皆無則交給 adapter 預設
 *
 * @param configured - 設定檔中該連線的 timeout
 * @returns 毫秒；undefined 表示沿用 adapter 內建預設
 */
export function resolveConnectionTimeout(configured: number | undefined): number | undefined {
  return _globalConnectionTimeout ?? configured
}

/**
 * 決定一條連線的實際語句逾時：--statement-timeout 優先於設定檔
 *
 * 這裡不回退到連線逾時——那層回退在 adapter 的 `resolveTimeoutPolicy()`，
 * 讓「設定檔寫了什麼」與「adapter 最後採用什麼」保持是兩個可分辨的問題。
 */
export function resolveStatementTimeout(configured: number | undefined): number | undefined {
  return _globalStatementTimeout ?? configured
}

/**
 * 回傳套用逾時解析後的連線參數副本（不修改輸入）
 */
export function withResolvedTimeout<T extends { timeout?: number; statementTimeout?: number }>(
  options: T
): T {
  const timeout = resolveConnectionTimeout(options.timeout)
  const statementTimeout = resolveStatementTimeout(options.statementTimeout)
  if (timeout === options.timeout && statementTimeout === options.statementTimeout) return options
  return { ...options, timeout, statementTimeout }
}
