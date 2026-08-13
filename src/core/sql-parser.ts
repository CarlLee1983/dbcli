/**
 * node-sql-parser 的延後載入入口。
 *
 * 這個套件要約 70ms 才載入完，而它先前被六個模組頂層 import——其中幾個位在
 * 每個命令都會經過的相依鏈上（semantic → context → verify / skill / contracts）。
 * 結果是 `dbcli --help` 也要等一個 SQL parser 初始化完才印得出說明。
 *
 * 用同步的 require 而非 `await import()`：呼叫點都是同步函式，改成非同步會
 * 一路傳染到 lint、explain、orm-drift 的整條呼叫鏈，換來的只是同一件事。
 * 實例共用一份——每個呼叫都自帶 dialect 選項，Parser 本身不帶跨呼叫狀態。
 */

import type { Parser as SqlParser } from 'node-sql-parser'

let cached: SqlParser | null = null

export function sqlParser(): SqlParser {
  if (!cached) {
    const { Parser } = require('node-sql-parser') as typeof import('node-sql-parser')
    cached = new Parser()
  }
  return cached
}
