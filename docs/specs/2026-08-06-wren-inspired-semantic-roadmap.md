# WrenAI 借鑑功能：語意層後續規格

**Date:** 2026-08-06
**Status:** Slices 1–2 implemented; Slice 3 specification refined, with no
implementation authorized yet
**Depends on:**
[`2026-08-06-semantic-context-mvp-design.md`](2026-08-06-semantic-context-mvp-design.md)
and [`docs/adr/0004-database-access-stays-a-cli-surface.md`](../adr/0004-database-access-stays-a-cli-surface.md).

## Purpose

以已完成的 `dbcli.semantic.json` MVP 為基礎，分期借鑑 WrenAI 的
semantic layer，而不將 dbcli 變成新的資料庫執行器、LLM gateway 或 MCP
server。每一期都必須是獨立可用、可驗證且可回滾的垂直切片。

本文件是後續工作的單一規格入口。規格或 ticket 的存在不構成實作授權；只有
取得實作指示的項目才能開始。其餘項目先保留設計決策與啟動條件，避免把
高風險能力偷偷變成核心依賴。

## Non-negotiable constraints

1. Cached schema、blacklist、連線權限和既有 `query` / `explain` / write
   gate 永遠是資料存取的權威；semantic context 只能縮小或解釋可用範圍，
   不能擴權。
2. 預設離線、唯讀、無網路、無資料列讀取；任何需要連線、模型、雲端或
   token 的能力必須獨立 opt-in，且不能由 `skill context` 隱式觸發。
3. 語意檔、CLI context、日誌、錯誤訊息與測試 fixture 都不得輸出
   credentials、SQL body 或 blacklisted table/column。
4. dbcli 維持 Bun/TypeScript 的單一 CLI。不得把 Python、Rust/DataFusion、
   向量資料庫或 WrenAI runtime 加入核心依賴。
5. 不新增 MCP server；這與既有 ADR 的 CLI 授權模型衝突。未來若重新評估，
   必須先取代或修訂 ADR，而非將 server 藏在 semantic 功能之下。
6. 每一期在同一個 semantic deep module 後實作。呼叫端只使用穩定的
   interface，不能各自解析 JSON、查 schema 或重做 blacklist 過濾。

## Baseline

version 1 保持相容，並正規化為 `relationships: []`。version 2 加入可驗證的
relationships；`semantic validate`、`semantic context`、`semantic drift` 與
`semantic migrate` 均不連線或執行 SQL；`skill context` 只在預設檔存在且有效時
附帶 semantic 內容。

v1 是永久相容的資料格式。後續格式必須以 `version` 明確區別，並提供從 v1
升級的 deterministic migration；不能以「猜測舊欄位含義」相容。

## Delivery order

| Priority | Slice | Outcome | Risk | Status |
| --- | --- | --- | --- | --- |
| 1 | Semantic v2: relationships and drift | 把可驗證的模型關聯納入版本控制，及早發現 schema/config 漂移。 | Low; offline/read-only | Implemented |
| 2 | Semantic catalog search | 讓人與 agent 以名稱、alias、description 找到已治理的模型、欄位與指標。 | Low; offline/read-only | Implemented |
| 3a | Guarded query-draft contract and agent-driven validation | 讓 Codex、Claude 或其他外部 agent 產生待確認草稿，再由 dbcli 離線驗證；絕不直接執行。 | Medium; SQL safety | Implemented (SQD-01–03, 2026-08-06) |
| 3b | Provider-driven query draft | 由 dbcli 明確 opt-in 呼叫已核准的 provider 產生相同草稿。 | High; egress/privacy/cost/provider reliability | Deferred by ADR-0005 |

下列 WrenAI 能力不在目前 backlog：embedding/history memory、Wren connector
runtime、瀏覽器 dashboard、Vercel/Cloudflare deploy、HTTP MCP。它們各自引入
資料保留、網路暴露、部署或新 execution path，必須在有明確產品需求時另寫
spec。

---

## Slice 1 — Semantic v2: relationships and drift

### Outcome

讓業務模型間的關聯可被 review、驗證與提供給 agent，同時在快取 schema 或
blacklist 變更後找出已失效的語意設定。這一期不產生 join SQL、不修改 schema，
也不改變任何 query 指令。

### Configuration contract

v2 保留 v1 的 `models` 與 `metrics`，新增可選 `relationships`：

```json
{
  "version": 2,
  "models": [
    { "name": "orders", "table": "orders", "fields": [{ "column": "customer_id" }] },
    { "name": "customers", "table": "customers", "fields": [{ "column": "id" }] }
  ],
  "relationships": [
    {
      "name": "order-customer",
      "from": { "model": "orders", "field": "customer_id" },
      "to": { "model": "customers", "field": "id" },
      "cardinality": "many-to-one",
      "description": "Each order belongs to one customer."
    }
  ],
  "metrics": []
}
```

Rules:

1. Relationship endpoint 必須引用同一檔中唯一的 model 及其已宣告 field；該
   field 仍須存在於 filtered schema。不能直接以 table/column 繞過 model。
2. `cardinality` 僅能是 `one-to-one`、`one-to-many`、`many-to-one`、
   `many-to-many`。它是經 review 的業務宣告，不推論、不自動改寫 SQL。
3. `name` 在 relationship 集合中唯一；同向重複 endpoint 視為錯誤。反向關係
   要使用不同名稱且必須有不同的業務意義，否則也視為錯誤。
4. `description`、name 和數量沿用 v1 的大小與字串上限。不得加入 SQL
   expression、join condition、connection 或資料樣本。
5. v1 載入結果一律以 `relationships: []` 正規化；`semantic migrate --to 2`
   輸出檔案內容到 stdout，僅在既有明確的檔案寫入 gate 下才允許寫入。

### Commands and interface

`src/core/semantic` 保持為 deep module。對外 interface 擴充為：

```text
loadSemanticContext(input) -> ValidSemanticContext | SemanticValidationError[]
inspectSemanticDrift(input) -> SemanticDriftReport
```

command layer 不接觸原始 schema 或 JSON parsing。drift report 是 deterministic
資料，不連 DB：

```text
dbcli semantic validate [--file <path>] [--format text|json]
dbcli semantic drift [--file <path>] [--format text|json]
dbcli semantic migrate --to 2 [--file <path>] [--format json]
```

`drift` 需區分：

- `valid`：所有引用仍可見；
- `stale`：檔案格式正確，但 table/column/saved-query 已不再可用；
- `invalid`：格式、重複名稱或 relationship contract 不合法；
- `unavailable`：快取 schema 不存在，無法判斷引用；不得假裝 valid。

### Acceptance criteria

1. v1 原檔與現有 context output 維持相容；v2 可輸出 relationships。
2. unknown、blacklisted、未在 model 宣告的 endpoint 都被拒絕，且不出現在
   output/error 的敏感明細中。
3. `drift` 可在不連 DB 下偵測 schema/saved-query 變化，並為四種狀態提供
   穩定 JSON shape 與 non-zero exit semantics。
4. `semantic context` 及 `skill context` 只附帶 valid context；stale/invalid
   預設 fail closed。
5. 測試覆蓋 v1 正規化、v2 成功、關聯重複、blacklist、schema/saved-query
   漂移、無 schema cache 與 JSON/text output；同步更新英中 Markdown/HTML
   使用者文件及所有 generated skill 文件。

### Rollback

v2 parser 與 command 可刪除而不影響 v1。若 migration 寫入能力有問題，保留
only-stdout mode；已產生的 v2 config 可由 Git revert，無資料庫 state。

### Implemented scope

`semantic drift` 回傳穩定的 `valid`、`stale`、`invalid` 或 `unavailable`
report；只有 `valid` 以 zero exit 結束。`semantic migrate --to 2` 會輸出
deterministic v2 JSON，但不寫入任何檔案。v2 relationship 只能引用同一檔案中
已宣告、且仍可見於 filtered schema 的 model field；不產生 join SQL。

---

## Slice 2 — Deterministic semantic catalog search

### Outcome

讓 agent 或使用者不必完整下載 `skill context`，即可從被治理的語意資料中找到
候選模型、欄位、relationships 和 metrics。這是可解釋的字串搜尋，不是向量
檢索或 LLM 推論。

### Interface and command

將搜尋隱藏在同一 deep module：

```text
searchSemanticContext(context, terms, options) -> SemanticSearchResult[]
```

輸入採空白分詞、case-insensitive 比對 canonical name、alias、description。
結果的排序必須固定：exact canonical name、exact alias、prefix、description
token，最後以 entity kind/name 排序。呼叫端不得自行排序或搜尋。

```text
dbcli semantic search <terms...> [--kind model|field|relationship|metric] [--format text|json]
```

每筆結果只含 canonical reference、matched terms、description、alias 和必要的
model path；不得含 SQL body、連線資訊或黑名單名稱。沒有結果不是錯誤，輸出空
array / 明確空訊息且 exit 0。

### Acceptance criteria

1. 相同 context 與 terms 永遠得到相同排序和 JSON。
2. 不會因 description 提到 blacklisted 名稱而使該資料重現；載入時即遵守
   Slice 1 的 filtered-schema validation。
3. `--kind`、空白輸入、結果上限與 output format 都有明確 validation/error
   semantics；預設結果上限為 20，最大為 100。
4. 全程離線且不讀取 saved-query SQL body；只使用已驗證的 semantic context。
5. 有 unit/command tests 與使用者文件雙語雙格式更新。

### Explicit non-goals

- 不建 embedding index、語意相似度、查詢歷史或本地個資快取。
- 不讓搜尋結果自動組裝或執行 SQL。

### Implemented scope

`semantic search <terms...>` 使用 case-insensitive、空白分詞的 AND matching；
結果依 exact canonical name、exact alias、prefix、description token、entity
kind/name 固定排序。`--kind` 可限制 entity type，`--limit` 的預設為 20、最大為
100。結果只含經驗證的 canonical reference、matched terms、safe description /
alias 與必要 model path，不含 SQL body、connection data 或 blacklist name；無結果
是 exit 0 的空 array / 明確文字訊息。

---

## Slice 3 — Guarded query-draft contract

### Outcome and delivery modes

本 slice 的產品能力是「產生後可離線驗證、可 review、但尚未執行的查詢草稿」，
不是讓 dbcli 變成某個 LLM 的必經 gateway。所有模式共用一個 `QueryDraft`
contract 與 validator；差別只在誰產生草稿。

1. **Agent-driven（先交付）**：Codex、Claude 或其他外部 agent 讀取 skill
   context、依既有 `schema` / `explain` / `query` workflow 產生 draft，並以
   `dbcli semantic draft validate` 離線驗證。agent 自己持有模型選擇、帳號與
   API key；dbcli 不持有 provider 設定，也不發出網路請求。
2. **Provider-driven（後續 opt-in）**：dbcli 使用明確指定且已核准的 provider
   產生同一種 draft。這會新增資料出境、retention、key 管理、成本與可靠性責任，
   因此不得和 agent-driven 一起隱式啟用。

兩種模式都不能直接執行 SQL。通過 validator 也不是存取授權；已檢閱的候選仍須
另行送至既有 `dbcli explain` 或 `dbcli query`，並完整經過 permission tier、
schema/blacklist、row limit、dry-run 與 audit gate。

### Shared terminology and contract

- **QueryDraft**：一份明確要求輸出的、尚未執行的候選查詢 artifact。它可以引用
  named saved query，或攜帶一段候選 read-only SQL；dbcli 不會自動保存、記錄或在
  validation output 重送 SQL body。
- **Draft validator**：在本機、離線執行的 deterministic validator。它檢查 draft
  shape、canonical semantic references、候選查詢的 statement/read-only 規則與
  filtered schema / blacklist 相容性；它不呼叫模型、不讀資料列、不執行 SQL。
- **Agent-driven** 與 **provider-driven** 是 provenance 與 transport 的區別，
  不是不同的安全權限。任何 draft 都是未受信任輸入，必須經同一 validator。

v1 `QueryDraft` 的 canonical payload 至少包含：`version`、`questionHash`、一個
`candidate`（`saved-query` name 或 SQL text）、`semanticReferences`（canonical
references）與選用的 parameter requests / rationale / risks。這些可選文字欄位不
是授權證據，validator 不可因其內容略過任何檢查。

validator 的 JSON report 至少包含穩定的 `status`、`draftHash`、`questionHash`、
已驗證的 canonical references 與不含敏感名稱或 SQL body 的 violations。成功
report 不回顯 candidate；呼叫端保有它原先提交並供人 review 的 draft。這使草稿
本身可作為使用者明確要求的 stdout/file artifact，同時避免它進入 CLI context、
log、error 或 fixture。

### Agent-driven interface (delivered)

唯一預定的第一個 command 是：

```text
dbcli semantic draft validate --input <file|-> [--format text|json]
```

它只讀取呼叫端明確提供的 draft，載入既有受治理的 semantic context，並輸出
validation report；不讀 provider config、credentials 或 network。缺少有效
semantic context、saved-query name 不存在、candidate 是 multi-statement/write SQL，
或引用 unknown / blacklisted table or column 時，必須 fail closed 並以 non-zero
exit 結束。SQL parser/validator 是提早拒絕的保護層，不取代 `explain` / `query`
在執行前的權威 gate。

預期使用流程：

```text
User -> external agent -> QueryDraft file/stdin
                         -> dbcli semantic draft validate
                         -> human/agent review
                         -> dbcli explain or query (separate invocation)
```

此流程讓 agent 可以是 Codex、Claude 或其他相容工具，卻不要求 dbcli 知道或儲存
其 provider、模型或 key。

SQD-01 至 SQD-03 已於 2026-08-06 交付：包含 deterministic local validator、
`semantic draft validate` CLI、英中使用文件與 generated skill guidance，以及不建立
DB adapter 或 audit execution event 的 regression coverage。這不表示 provider-driven
generation 已獲核准。

### Provider-driven interface (deferred by ADR-0005)

Provider-driven generation is explicitly deferred by
[ADR-0005](../adr/0005-provider-driven-query-drafts-remain-deferred.md). No
provider, model, credential source, sanitized payload, or outbound transport is
approved. The following interface is therefore a future-only shape, not a
shipped command:

只有完成下列 policy decision 並取得獨立實作授權後，才可新增：

```text
dbcli semantic draft generate "<question>" --provider <explicit-provider> --format json
```

`generate` 的唯一輸出仍是 `QueryDraft`；隨後必須透過同一個 draft validator，
而非由 provider output 直接構造可執行 command。provider adapter 必須隔離在
semantic core 之外；core 不含 provider SDK、key 或 network client。

開始前必須明確決定並記錄：允許的 provider/model、可傳送的 sanitized context
範圍、資料出境地與 retention、API key storage、成本上限、rate/error behavior、
audit metadata、offline fallback 與撤銷方式。這些不能因為環境變數或某個 agent
已登入而推定同意。可傳送資料只能來自已淨化的 semantic context；不得傳送 schema
cache、saved-query SQL body、資料列、credentials、blacklist entries 或本機路徑。

### Acceptance criteria

1. Agent-driven validator 完全離線；它不需要 provider config、不能發 network
   request，也不能執行或回顯 candidate SQL。
2. 同一份 `QueryDraft` 在相同 semantic context 下得到相同 validation status、
   hashes、references、JSON shape 與 exit semantics，無論它來自哪個 agent/provider。
3. validator 拒絕 malformed draft、multi-statement、write SQL、unknown 或
   blacklisted references；拒絕 report 不洩漏 SQL body 或受保護名稱。
4. 有效 draft 仍不會產生自動 `query` / `explain` invocation；執行一定是人或
   agent 明確發出的下一個既有 CLI command。
5. provider-driven adapter 必須在 policy approval 後才實作，且需證明 sanitized
   transport、explicit provider selection、cost/error boundary、metadata-only audit
   與無 provider/network 時的明確失敗。
6. 每張 implementation ticket 都更新英中 Markdown/HTML 使用者文件及 generated
   skill 文件，並加入對應 unit/command/security regression tests。

### Ticket breakdown

可執行的相依 ticket、各自的 scope 與 acceptance criteria 定義於
[`2026-08-06-semantic-query-draft-ticket-backlog.md`](../plans/2026-08-06-semantic-query-draft-ticket-backlog.md)。
agent-driven 的 SQD-01–SQD-03 已交付；provider 相關 ticket 仍受
[ADR-0005](../adr/0005-provider-driven-query-drafts-remain-deferred.md) 的 policy
gate 阻擋。

## Cross-cutting verification

每個 slice 實作前都要：確認實際 schema/blacklist contract、界定 CLI exit code
與 JSON contract、在最小 surface 新增 regression tests，最後執行 `bun test`、
`bun run typecheck`、`bun run lint`、`bun run docs:check`、`bun run skill:check`、
`bun run platform:check`、`bun run plugin:check`、`bun run contract:check` 及
`git diff --check`。完成時更新本文件的 status、設計決策與已實作範圍，不把
deferred slice 表示為已交付能力。
