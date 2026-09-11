/**
 * 受控故障注入（DBCLI-040 / AC-004）
 *
 * 透過 `bun run --preload` 只在被 spawn 的 CLI 程序裡，把共用的 SQL 閘門換回
 * DBCLI-036 之前的三引擎字面量。產品程式碼沒有任何開關；這個檔案只被
 * `sqlite-cli-gate-mutation.test.ts` 引用，測試程序本身不載入它。
 *
 * 它證明的是：入口拒絕 SQLite 時，即使 adapter 本身仍能讀資料，對應的 CLI
 * 情境也會失敗——也就是情境真的在問入口那個問題。
 */

import { plugin } from 'bun'

plugin({
  name: 'dbcli-040-mutant-sql-gate',
  setup(build) {
    build.onLoad({ filter: /[\\/]require-sql-connection\.ts$/ }, () => ({
      loader: 'ts',
      contents: `
        const PRE_DBCLI_036_ROSTER = ['postgresql', 'mysql', 'mariadb']
        export function requireSqlConnection(connection) {
          if (!PRE_DBCLI_036_ROSTER.includes(connection.system)) {
            throw new Error('This command requires a SQL connection, got: ' + connection.system)
          }
          return connection
        }
      `,
    }))
  },
})
