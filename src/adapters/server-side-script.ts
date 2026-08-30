/**
 * Server-side script 防護——檢查點放在 adapter。
 *
 * MongoDB 的 `$where` / `$function` 與 Elasticsearch 的 `script` /
 * `script_fields` 會讓查詢在資料庫伺服器上執行任意程式碼。先前的檢查散在
 * saved-queries 與 DML plan 兩條支線，主查詢路徑（`dbcli query`）完全沒有
 * 攔截——每新增一條呼叫路徑就等於新增一個繞道。放在 adapter 的執行入口，
 * 所有路徑都會經過同一個檢查，不需要記得誰該檢查誰。
 *
 * 「執行入口」在 ES 上是複數：`execute()` 與 `request()`。原本只掛在前者，
 * `dbcli shell` 走後者，於是這個模組宣稱關掉的繞道又開了一次。ES 的檢查點
 * 現在在 `ElasticsearchAdapter.request()`——`execute()` 也經由它送出。
 * 新增第三個入口時，檢查要跟著走，不是跟著呼叫端走。
 */

export class ServerSideScriptRejection extends Error {
  constructor(
    message: string,
    /** 觸發攔截的運算子或欄位名 */
    public readonly operator: string
  ) {
    super(message)
    this.name = 'ServerSideScriptRejection'
    Object.setPrototypeOf(this, ServerSideScriptRejection.prototype)
  }
}

/** MongoDB 上會執行伺服器端 JavaScript 的運算子 */
const MONGO_SCRIPT_OPERATORS = ['$where', '$function', '$accumulator'] as const

/** Elasticsearch 上會執行伺服器端 script 的欄位 */
const ES_SCRIPT_KEYS = ['script', 'script_fields'] as const

function findKey(value: unknown, keys: readonly string[]): string | undefined {
  if (value === null || typeof value !== 'object') return undefined
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findKey(item, keys)
      if (found) return found
    }
    return undefined
  }
  const record = value as Record<string, unknown>
  for (const key of keys) {
    if (key in record) return key
  }
  for (const nested of Object.values(record)) {
    const found = findKey(nested, keys)
    if (found) return found
  }
  return undefined
}

/**
 * @throws {ServerSideScriptRejection} 查詢（filter 或 pipeline）含伺服器端 script
 */
export function assertNoMongoServerSideScript(query: unknown): void {
  const operator = findKey(query, MONGO_SCRIPT_OPERATORS)
  if (!operator) return
  throw new ServerSideScriptRejection(
    `MongoDB server-side script rejected: '${operator}' executes JavaScript on the database server. ` +
      `Rewrite the query with standard operators, or run it through a tool that is meant to allow it.`,
    operator
  )
}

/**
 * @throws {ServerSideScriptRejection} DSL 含 script / script_fields
 */
export function assertNoElasticsearchScript(body: unknown): void {
  const key = findKey(body, ES_SCRIPT_KEYS)
  if (!key) return
  throw new ServerSideScriptRejection(
    `Elasticsearch server-side script rejected: '${key}' executes script code on the cluster. ` +
      `Rewrite the query without it.`,
    key
  )
}
