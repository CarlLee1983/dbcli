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

/**
 * Elasticsearch 上會執行伺服器端 script 的欄位。
 *
 * 以形狀比對，不是清單成員。`scripted_metric` 把它的四個槽拼成 `init_script`、
 * `map_script`、`combine_script`、`reduce_script`，一個都不等於 `script`——
 * 一份兩個名字的清單擋不住一個會自己組名字的 API。任何以 `_script` 結尾的鍵
 * 都算，這連 ES 之後新增的槽也一起涵蓋，而那正是清單做不到的事。
 */
function isElasticsearchScriptKey(key: string): boolean {
  return key === 'script' || key === 'script_fields' || key.endsWith('_script')
}

/**
 * 已知的盲點：字串編碼的 body。
 *
 * 掃描只走物件與陣列的**鍵**，不進字串內部。search template 的
 * `{"source": "{\"script_fields\": ...}"}` 把整個 search body 放在一個字串裡，
 * stored template 的 `{"id": "tpl"}` 連內容都不在請求裡——兩者這道檢查都看不見。
 *
 * 目前不可觸發，但**理由不在這裡**：`/<index>/_search/template` 是三段路徑，
 * 分類器規則 2 接不到，於是落到需要 admin 的預設。也就是說擋住它的是 tier
 * gate，這道檢查對它貢獻為零。誰要在分類器的讀取集裡加 `_search/template`
 * 規則，必須同時處理這裡——否則那條規則會直接開一扇門。
 */

function findKey(value: unknown, matches: (key: string) => boolean, depth = 0): string | undefined {
  // 深度上限：`'['.repeat(100000)` 是合法 JSON，遞迴掃描會爆 stack。丟
  // RangeError 而不是拒絕請求，會讓一個防護變成一個當掉的理由。
  if (depth > MAX_SCAN_DEPTH) {
    throw new ServerSideScriptRejection(
      `Request body nests deeper than ${MAX_SCAN_DEPTH} levels, so it cannot be checked for ` +
        `server-side scripts. Flatten the body.`,
      '<depth-limit>'
    )
  }
  if (value === null || typeof value !== 'object') return undefined
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findKey(item, matches, depth + 1)
      if (found) return found
    }
    return undefined
  }
  const record = value as Record<string, unknown>
  for (const key of Object.keys(record)) {
    if (matches(key)) return key
  }
  for (const nested of Object.values(record)) {
    const found = findKey(nested, matches, depth + 1)
    if (found) return found
  }
  return undefined
}

/** 超過這個深度的 body 一律拒絕，而不是讓掃描爆 stack。 */
const MAX_SCAN_DEPTH = 200

/**
 * @throws {ServerSideScriptRejection} 查詢（filter 或 pipeline）含伺服器端 script
 */
export function assertNoMongoServerSideScript(query: unknown): void {
  const operator = findKey(query, (key) =>
    (MONGO_SCRIPT_OPERATORS as readonly string[]).includes(key)
  )
  if (!operator) return
  throw new ServerSideScriptRejection(
    `MongoDB server-side script rejected: '${operator}' executes JavaScript on the database server. ` +
      `Rewrite the query with standard operators, or run it through a tool that is meant to allow it.`,
    operator
  )
}

/**
 * @throws {ServerSideScriptRejection} DSL 含 script 槽，或巢狀過深無法檢查
 *
 * 已知的取捨：掃描不分「請求的控制結構」與「文件內容」，所以一份**欄位名叫
 * `script`** 的文件走 `_doc` / `_create` / `_update` 寫入時會被誤擋。目前不可
 * 觸發——`insert.ts` 與 `update.ts` 對 Elasticsearch 明確拒絕，adapter 的
 * `insert()` / `update()` 從 CLI 走不到——但 ES 寫入功能實作出來的那天，這會
 * 變成一個沒人解釋得了的錯誤。正確的修法不是在 `insert()` 繞過檢查，而是讓
 * 掃描知道 `doc` 之下是資料不是指令。
 */
export function assertNoElasticsearchScript(body: unknown): void {
  const key = findKey(body, isElasticsearchScriptKey)
  if (!key) return
  throw new ServerSideScriptRejection(
    `Elasticsearch server-side script rejected: '${key}' executes script code on the cluster. ` +
      `Rewrite the query without it.`,
    key
  )
}
