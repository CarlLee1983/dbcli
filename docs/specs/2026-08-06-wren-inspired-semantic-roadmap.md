# WrenAI 借鑑功能：語意層後續規格

**Date:** 2026-08-06
**Status:** Slices 1–2 implemented; Slice 3 remains deferred
**Depends on:**
[`2026-08-06-semantic-context-mvp-design.md`](2026-08-06-semantic-context-mvp-design.md)
and [`docs/adr/0004-database-access-stays-a-cli-surface.md`](../adr/0004-database-access-stays-a-cli-surface.md).

## Purpose

以已完成的 `dbcli.semantic.json` MVP 為基礎，分期借鑑 WrenAI 的
semantic layer，而不將 dbcli 變成新的資料庫執行器、LLM gateway 或 MCP
server。每一期都必須是獨立可用、可驗證且可回滾的垂直切片。

本文件是後續工作的單一規格入口；只有標為「下一期」的項目可在取得實作
指示後開始。其餘項目先保留設計決策與啟動條件，避免把高風險能力偷偷變成
核心依賴。

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
| 3 | Guarded NL query draft | 將自然語言轉為「待確認的查詢草稿」，絕不直接執行。 | High; LLM/privacy/SQL safety | Deferred pending separate approval |

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

## Slice 3 — Guarded natural-language query draft (deferred)

### Why deferred

這是最接近 WrenAI GenBI 的能力，但它新增 prompt injection、資料外傳、成本、
provider reliability 與 SQL correctness 的風險。Slice 1 和 2 必須先在至少一個
真實專案中被採用，並有可 review 的 semantic context，才可開啟本 slice。

### Required separate approval and design decisions

開始前必須取得明確實作授權，並確認：LLM provider、資料出境與 retention、
API key storage、可傳送的 context 範圍、成本上限、審計保留期、錯誤處理和
offline fallback。這些不能由環境變數存在與否來推定同意。

若獲批准，唯一允許的初始 interface 為：

```text
dbcli semantic draft "<question>" --provider <explicit-provider> --format json
```

它輸出 `QueryDraft`（候選 saved query 或 SQL text、使用的 canonical semantic
references、理由、風險、需要使用者確認的參數），但不得執行任何 SQL。執行必須
由使用者另行把已檢閱的輸出送到既有 `dbcli query` / `explain`，因此維持原有
permission tier、row limit、dry-run 和 audit 行為。

### Future acceptance criteria

1. provider adapter 是獨立 adapter；core semantic module 不含 provider SDK、
   key 或 network client。
2. 只傳送經 `semantic context` 淨化後的資料；不傳 schema cache、saved-query
   SQL body、rows、credentials、blacklist entries 或本機路徑。
3. 對模型輸出以 parser/validator 檢查，拒絕 multi-statement、write SQL、未知
   或 blacklisted references；驗證失敗時不產生可執行 command。
4. output 清楚標示為草稿，附帶輸入 hash、provider/model metadata、拒絕原因
   與可重現的 deterministic validation evidence。
5. 能在沒有 provider 設定或網路時明確失敗，不降級成秘密外傳或自動執行。

## Cross-cutting verification

每個 slice 實作前都要：確認實際 schema/blacklist contract、界定 CLI exit code
與 JSON contract、在最小 surface 新增 regression tests，最後執行 `bun test`、
`bun run typecheck`、`bun run lint`、`bun run docs:check`、`bun run skill:check`、
`bun run platform:check`、`bun run plugin:check`、`bun run contract:check` 及
`git diff --check`。完成時更新本文件的 status、設計決策與已實作範圍，不把
deferred slice 表示為已交付能力。
