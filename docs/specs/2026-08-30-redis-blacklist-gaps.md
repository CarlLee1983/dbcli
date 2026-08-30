# Redis 的黑名單與遮罩缺口（第九輪對抗式複查）

**狀態**：已確認，未修復。刻意不在
`fix/es-shell-permission-enforcement` 上修——那條分支已跑九輪且只談
Elasticsearch，把第二個子系統推進去會讓兩邊都難審。這份文件是給後續分支的
輸入。

**來源**：ES shell permission 分支第九輪的對抗式複查。該輪的問題是「一個比對
函式，有沒有把它要比的兩樣東西都正規化？」——第七、八輪用同一個問題在
Elasticsearch 上找到四個 CRITICAL，這一輪把它問到其他引擎上。

以下四則已由我獨立驗證其中兩則（`redis.mask` 與 `insert/update/delete`），
另兩則來自複查 agent 的純函式層實測。**沒有任何一則連過真實的 Redis**，所以
「Redis 端的實際行為」那一半仍是推論，見每則的註記。

---

## 1. 指令表與權限白名單是兩張表，落差裡的指令不經黑名單

`checkKeyArgs`（`src/adapters/redis/blacklist-enforcer.ts:44-45`）拿不到
command spec 時 `return { ok: true }`——**fail-open**。而
`REDIS_COMMAND_TABLE`（`src/adapters/redis/command-metadata.ts`）與權限白名單
（`src/core/permission/redis.ts`）是各自維護的兩張表，白名單放行的指令不一定
在指令表裡。

落在落差裡的（agent 於純函式層實測 PASS）：

- `query-only`：`XRANGE`、`XREVRANGE`、`XREAD`、`PTTL`
- `read-write`：`LPOP`、`RPOP`、`LSET`、`APPEND`、`SETNX`、`PSETEX`、
  `MSETNX`、`INCR(BY)`、`DECR(BY)`、`HSETNX`、`HINCRBY`、`XADD`、
  `EXPIREAT`、`PEXPIRE`
- `data-admin`：`XDEL`

`LPOP secrets:list` 特別值得注意：它是讀取兼銷毀，`read-write` 就能把黑名單
key 的值取出來。

**修法方向**：`getCommandSpec` 回 undefined 時 fail-closed；更好的是讓兩張表
由同一份來源產生，落差就不可能存在。ADR-0014 對 Elasticsearch 的讀取集寫過
同一個判斷：白名單漏一項使用者會出聲，拒絕集漏一項沒有人會發現。

## 2. `SCAN ... MATCH` 的 pattern 不被檢查

`SCAN` 的 `keyArity` 是 `{ kind: 'no-key' }`
（`src/adapters/redis/command-metadata.ts:129-134`），只有 `KEYS` 是
`pattern`。於是 `SCAN 0 MATCH secrets:* COUNT 1000` 列舉得出全部黑名單 key 名。

方向錯得特別徹底：`KEYS secrets:*` 被擋且需要 `admin`，`SCAN MATCH secrets:*`
不被擋且只要 `query-only`——**低權限那條路才是通的**。

**修法方向**：`MATCH` 的位置不固定，要掃 args 找它，不能寫死 argIndex。

## 3. `insert` / `update` / `delete` 對 Redis 不套 glob 黑名單

**已由我獨立驗證（讀 code path）。**

這三條路只經過 `BlacklistValidator.checkTableBlacklist`
（`src/commands/delete.ts:156`、`insert.ts:173`、`update.ts:165`），底層是
`this.state.tables.has(tableName.toLowerCase())`
（`src/core/blacklist-manager.ts:112-114`）——純字面相等，不懂 glob。之後
`RedisAdapter.delete/insert/update`（`src/adapters/redis-adapter.ts:277`、
`319`、`357`）直接呼叫 client，一次 `checkKeyArgs` 都沒有。

於是 `dbcli blacklist table add 'secrets:*'` 之後，`dbcli delete
secrets:api_key` 照刪。而 `'secrets:*'` **正是使用者文件教的寫法**
（`docs/user/en/index.md:1253-1256`）。只有寫成完整字面 key 才擋得住，而那對
Redis 幾乎沒有人這樣設。

這與 ES 分支第八輪的 CRITICAL 是同一個根因的另一面：同一個
`blacklist.tables` 陣列在不同引擎、不同指令上有不同語意。第八輪讓 ES 的條目
也走 glob；這裡是 Redis 的**寫入指令**根本不走 glob。

**修法方向**：Redis 分支改用 `checkKeyArgs`，不要走 SQL 的 table validator。

## 4. `redis.mask` 對 `query` / `q` 完全無效

**已由我獨立驗證（讀 code path）。**

`AdapterFactory.createRedisAdapter` 的第三個參數是 mask rules
（`src/adapters/factory.ts:86-97`）。`export.ts:202` 與 `shell.ts:108` 有傳，
**`query.ts:886` 沒有**，所以 `maskRedisRows` 拿到空陣列而原樣回傳。同樣沒傳
的還有 `list.ts:154`、`schema.ts:216`，以及 insert/update/delete。

使用者文件明寫 `dbcli query "GET secret:api_key"` 回
`{ "value": "[REDACTED]" }`（`docs/user/en/index.md:1284-1286`）——實際回明文。
**一個文件承諾存在、實作不存在的保護**，而使用者可能正在依賴它。

**修法方向**：把 mask rules 的讀取收進 `AdapterFactory.createRedisAdapter`，
不要讓每個 call site 各自記得傳。這是 ES 分支第五輪那個教訓的翻版——控制掛在
呼叫端，等於下一個呼叫端不會有。

## 5. glob 對含換行的 key 與 Redis 不一致（MEDIUM）

`globToRegex`（`src/utils/glob.ts:18-19`）把 `*` 譯成 `.*`，而 JS 的 `.` 不
匹配 `\n`；Redis 的 `stringmatchlen` 逐位元組比對，`*` 吃任何位元組。所以
`globToRegex('secrets:*').test('secrets:\nx')` 為 false，該 key 不受保護。
`parseRedisCommand`（`src/adapters/redis-adapter.ts:461-474`）在引號內保留
換行，所以這條路可達。同一組 regex 也用在 `sampleKeyNames`，因此 `dbcli list`
也會顯示這種 key。

**修法方向**：`new RegExp(out, 's')`，並確認 `$` 不會在尾端 `\n` 前提早收尾。

---

## 已查證為陰性（不要重做）

`RENAME` 兩個 key 都檢查；`MGET`／`DEL`／`UNLINK`／`MSET` 的 multi-variable
展開正確；`SORT`／`EVAL`／`FUNCTION`／`COPY`／`DUMP`／`RESTORE`／`MIGRATE`／
`RANDOMKEY`／`OBJECT`／`GETDEL`／`RENAMENX`／`MEMORY`／`SUBSCRIBE` 不在權限
白名單，且 `enforceRedisPermission` 對未知指令 fail-closed；請求端的 glob
寫法（`secrets:*`、`*`、`secrets:?`、`s*`、`secrets:[a-z]*`）對上字面條目
`secrets:1` 全部正確擋下——第八輪那個 ES 的反向不對稱在 Redis 這側不存在；
遮罩欄位名區分大小寫且不 trim，但 Redis hash 欄位本來就區分大小寫，正確。

附帶觀察：`GETRANGE` 列在 `MASKABLE`（`src/adapters/redis/value-masker.ts:7`）
卻不在權限白名單，所以那段遮罩程式碼永遠跑不到。無害，但同樣說明這兩張表
對不起來——與第 1 則同一個根因。

## 給下一條分支的建議

1. 先修第 4 則（文件承諾與實作不符，且修法最小）。
2. 第 1 與第 5 則是同一件事的兩面：**兩張表對不起來**。修的時候讓它們由同一份
   來源產生，而不是各補各的。
3. 修完跑對抗式複查——這五則全部是七輪 Elasticsearch 複查之後才被問到的問題，
   而問題本身很短：**這個比對函式，有沒有把它要比的兩樣東西都正規化？**
