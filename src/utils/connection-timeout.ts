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
 * 決定一條連線的實際逾時：--timeout 優先於設定檔，兩者皆無則交給 adapter 預設
 *
 * @param configured - 設定檔中該連線的 timeout
 * @returns 毫秒；undefined 表示沿用 adapter 內建預設
 */
export function resolveConnectionTimeout(configured: number | undefined): number | undefined {
  return _globalConnectionTimeout ?? configured
}

/**
 * 回傳套用逾時解析後的連線參數副本（不修改輸入）
 */
export function withResolvedTimeout<T extends { timeout?: number }>(options: T): T {
  const timeout = resolveConnectionTimeout(options.timeout)
  if (timeout === options.timeout) return options
  return { ...options, timeout }
}
