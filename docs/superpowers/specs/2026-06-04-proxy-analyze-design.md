# dbcli `proxy analyze` 設計

- **日期**: 2026-06-04
- **狀態**: 設計待實作（brainstorming 完成，待 writing-plans）
- **目標版本**: 未定（產品版號以 package.json 為準）
- **相關方向**: 把 `dbcli proxy` 擷取的 `.dbcli/proxy/events.jsonl` 聚合成可分析報告，補上 capture→analyze 閉環的後半段。
- **前置**: [`2026-06-04-dbcli-proxy-design.md`](2026-06-04-dbcli-proxy-design.md)（proxy 擷取本體，已實作並出貨於 v1.26.0）

---

## 1. 問題與目標

`dbcli proxy`（v1.26.0）只負責**擷取**：把應用程式的資料庫流量轉發到真 DB，並把每個查詢的事件附加到 `.dbcli/proxy/events.jsonl`。但程式碼裡**沒有任何消費端**——沒有 reader、沒有聚合、沒有報告。擷取之後的分析目前完全 DIY（手讀 JSONL、jq、或丟給 agent 自行歸納）。

本功能新增 `dbcli proxy analyze`：純讀 `events.jsonl`、不連 DB，把原始事件聚合成結構化報告。主要消費者是 **AI agent**（JSON 優先），讓 agent 讀完直接決定下一步（例如對最慢的查詢跑 `dbcli guide missing-index-for`）。

### 成功標準

- `dbcli proxy analyze` 讀取 proxy 事件日誌（含 rotation 的 `.1` 段），輸出聚合報告。
- 預設 `--format json`，提供穩定的 agent-facing 契約；`text` 為次要人類版。
- **離線**：只讀檔，不連資料庫、不執行任何 DB 操作。
- 對最吃時間的 SELECT 指紋附上可執行的 `suggestedCommands`（串接既有 `explain` / `guide missing-index-for`），由 agent/人決定是否執行。
- 容錯：缺檔、空檔、壞行都不崩潰，給出明確訊息或合法的空報告。

---

## 2. 範圍

### v1 收錄

- `dbcli proxy analyze` 子指令（掛在既有 `proxy` command group 下，與 `mysql`/`mariadb`/`postgresql` engine 子指令平行）。
- 輸入：預設 `.dbcli/proxy/events.jsonl`，`--events <path>` 覆寫；預設自動合併 rotation 的 `.1` 段。
- 六個輸出區塊：`summary`、`byFingerprint`、`slowest`、`errors`、`hotTables`、`repetition`。
- 兩種 renderer：`json`（主，契約鎖定）、`text`（次，report/inspect 風格）。
- SQL 指紋正規化（重用 `redactLiterals`）。
- `suggestedCommands` 離線提示（不自動執行）。

### v1 非目標（明確排除）

- **不連 DB**：不自動執行 `explain` / `guide`，只產生指令字串。
- 不做跨 events 檔以外的資料來源（不讀 audit log、不讀 DB metadata）。
- 不做真正的時間滑動窗 N+1 偵測（採簡單啟發式，見 §6）。
- 不做趨勢/時序圖、不做多次 analyze 之間的比較（baseline diff）。
- 不持久化報告（輸出到 stdout；使用者自行重導）。

---

## 3. 指令介面

```
dbcli proxy analyze [--events <path>] [--format json|text]
                    [--top <n>] [--slow-ms <ms>] [--n-plus-one <n>]
                    [--no-include-rotated]
```

| Flag | 預設 | 說明 |
|------|------|------|
| `--events <path>` | `.dbcli/proxy/events.jsonl` | 事件日誌路徑（同 proxy 預設） |
| `--format <fmt>` | `json` | `json`（agent 優先）或 `text`（人類版） |
| `--top <n>` | `20` | text 版 `slowest` / `byFingerprint` 顯示筆數；**JSON 不截斷** |
| `--slow-ms <ms>` | `1000` | analyze 自己的慢查閾值，對 `durationMs` 重算 `slowCount`，與擷取時的 `--slow-ms` 解耦 |
| `--n-plus-one <n>` | `10` | repetition 觸發門檻（同一 session 同一指紋的最小次數） |
| `--no-include-rotated` | （預設含 `.1`） | 關閉自動合併 rotation 段，只讀 current |

- 純讀檔、**不連 DB**，因此 analyze 不需要 engine 子指令、不需要 config 連線資訊。`engine` 由事件內的 `engine` 欄位決定（取第一個事件；混引擎事件理論上不會發生，因一個 events 檔對應一個 proxy 實例）。
- 驗證：`--format` 限 `json|text`；`--top` / `--slow-ms` / `--n-plus-one` 須為非負整數，否則拋錯（沿用 `validateFormat` 與既有數值驗證風格）。

---

## 4. 聚合模型 — 指紋

重用 `redactLiterals()`（`src/proxy/sql-metadata.ts`，即擷取時 `--redact literals` 用的同一支）把 SQL 字面值正規化成 `?`，再壓縮連續空白為單一空格、trim，作為**分組 key（fingerprint）**。

- 每個指紋保留一條**代表 SQL（`exampleSql`）**：取該指紋中 `durationMs` 最大那次的**原始** `sql`（方便直接餵 `explain`）。
- `statement`、`tables` 直接取自事件欄位（proxy 已在擷取時算好），同指紋取第一筆即可（同指紋必同 statement/tables）。
- **redaction 互動**：若擷取時開了 `--redact literals`，事件裡的 `sql` 已是 `?` 佔位，`redactLiterals` 對其為冪等（再跑一次不變）。此時 `exampleSql` 也是佔位版；報告會在該指紋標 `redacted: true`，讓 agent 知道 suggestedCommands 裡的 SQL 需補具體值。判定方式：`exampleSql === fingerprint`（原始即等於正規化版 ⇒ 視為已 redacted）。

### Percentile 計算

對一組 `durationMs` 升序排序後取最近位次（nearest-rank）：`p(k) = sorted[ceil(k/100 * n) - 1]`，空集合回 `0`。p50/p95/p99 與 max 皆由此得出。helper 為純函式。

---

## 5. JSON 輸出契約（核心）

```json
{
  "version": 1,
  "tool": "proxy-analyze",
  "engine": "mysql",
  "source": {
    "files": [".dbcli/proxy/events.jsonl", ".dbcli/proxy/events.jsonl.1"],
    "eventsRead": 12345,
    "malformedLines": 0,
    "timeSpan": { "from": "<ISO>", "to": "<ISO>", "durationMs": 3600000 }
  },
  "summary": {
    "sessions": 8,
    "queries": 4200,
    "errors": 17,
    "errorRate": 0.004,
    "parseErrors": 0,
    "slowCount": 12,
    "latencyMs": { "p50": 3, "p95": 45, "p99": 210, "max": 1800 },
    "bytes": { "request": 1048576, "response": 8388608 }
  },
  "byFingerprint": [
    {
      "fingerprint": "SELECT * FROM users WHERE id = ?",
      "statement": "SELECT",
      "tables": ["users"],
      "count": 1500,
      "durationMs": { "total": 45000, "avg": 30, "p95": 80, "max": 600 },
      "rowsAvg": 1,
      "bytesAvg": { "request": 64, "response": 512 },
      "errorCount": 0,
      "slowCount": 3,
      "redacted": false,
      "exampleSql": "SELECT * FROM users WHERE id = 42",
      "exampleQueryId": "qry_pxy_3_18",
      "suggestedCommands": [
        "dbcli explain \"SELECT * FROM users WHERE id = 42\"",
        "dbcli guide missing-index-for \"SELECT * FROM users WHERE id = 42\""
      ]
    }
  ],
  "slowest": [
    {
      "queryId": "qry_pxy_3_18",
      "durationMs": 1800,
      "sql": "SELECT * FROM users WHERE id = 42",
      "statement": "SELECT",
      "tables": ["users"],
      "timestamp": "<ISO>",
      "sessionId": "pxy_3"
    }
  ],
  "errors": [
    {
      "code": "1146",
      "message": "Table 'x' doesn't exist",
      "count": 5,
      "fingerprint": "SELECT ... FROM x",
      "exampleSql": "SELECT id FROM x WHERE a = 1"
    }
  ],
  "hotTables": [
    { "table": "users", "queryCount": 1820, "totalDurationMs": 52000 }
  ],
  "repetition": [
    {
      "fingerprint": "SELECT * FROM order_items WHERE order_id = ?",
      "sessionId": "pxy_3",
      "count": 50,
      "spanMs": 1200,
      "totalDurationMs": 1500,
      "tables": ["order_items"]
    }
  ]
}
```

### 區塊定義與排序

| 區塊 | 來源事件 | 排序 | 截斷 |
|------|----------|------|------|
| `summary` | 全部 | — | — |
| `byFingerprint` | `query_completed`（+ `query_errored` 計 errorCount） | `durationMs.total` 降序 | JSON 不截；text 取 `--top` |
| `slowest` | `query_completed` | `durationMs` 降序 | JSON 與 text 皆取 `--top` |
| `errors` | `query_errored` | `count` 降序 | JSON 不截；text 取 `--top` |
| `hotTables` | `query_completed` 的 `tables[]` 展開 | `queryCount` 降序 | JSON 不截；text 取 `--top` |
| `repetition` | `query_completed` 依 `(sessionId, fingerprint)` | `count` 降序 | JSON 不截；text 取 `--top` |

- `summary.queries` = `query_completed` 數；`errors` = `query_errored` 數；`errorRate` = `errors / (queries + errors)`（分母為 0 時回 `0`）。
- `summary.slowCount` 與每指紋的 `slowCount`：以 analyze 的 `--slow-ms` 對 `durationMs` 重算（不依事件內既有的 `slow` 旗標），讓分析閾值可獨立調整。
- `latencyMs` 與 `byFingerprint.durationMs` 僅統計 `query_completed`（errored 的耗時不納入延遲分佈，避免被失敗路徑汙染）。
- `bytes` 來自 `query_completed` 的 `requestBytes`/`responseBytes` 加總（summary）與平均（byFingerprint）。

### suggestedCommands 規則

- 只掛在 `byFingerprint` 中 **`statement === 'SELECT'`** 且進入 **top-N（依 `durationMs.total` 排序，N = `--top`）** 的列。
- 內容固定兩條：`dbcli explain "<exampleSql>"`、`dbcli guide missing-index-for "<exampleSql>"`。
- `exampleSql` 內的雙引號做 shell-safe 跳脫。
- 非 SELECT（INSERT/UPDATE/DELETE/DDL/其他）不掛 `suggestedCommands`（`guide missing-index-for` 只對 SELECT 有意義）：該列**省略** `suggestedCommands` 欄位（不輸出空陣列），讓「有建議」與「無建議」對 agent 而言可由欄位是否存在直接判別。

---

## 6. repetition（N+1）啟發式

- 以 `(sessionId, fingerprint)` 分組，`count >= --n-plus-one`（預設 10）即列入。
- 回報 `count`、`spanMs`（該組首末事件 `timestamp` 差，毫秒）、`totalDurationMs`（該組 `durationMs` 加總）、`tables`。
- **不**做真正的時間滑動窗（同 session 同指紋被打很多次，本身就是 N+1 的強訊號；簡單啟發式足夠且無窗口參數複雜度）。v1 非目標已載明。

---

## 7. Text 版（次要）

`report` / `inspect` 風格的分段純文字，依序：

1. `SUMMARY` — 總數、錯誤率、p50/p95/p99/max、slowCount、bytes
2. `TOP QUERIES BY TOTAL TIME` — byFingerprint 前 `--top`（count / total / avg / p95 / tables / 截斷的指紋）
3. `SLOWEST SINGLE QUERIES` — slowest 前 `--top`
4. `HOT TABLES` — hotTables 前 `--top`
5. `ERRORS` — errors 前 `--top`
6. `N+1 SUSPECTS` — repetition 前 `--top`
7. `SUGGESTED COMMANDS` — 彙整所有 byFingerprint 的 suggestedCommands（去重）

text 版是 json 報告的純呈現，**不另算數據**（單一資料來源，避免兩版漂移）。

---

## 8. 架構與檔案

高內聚小檔，核心聚合為純函式：

| 檔案 | 職責 | 依賴 |
|------|------|------|
| `src/proxy/event-reader.ts` | 讀 current（+ `.1`）、容錯解析 JSONL（跳過壞行並計數）、依 timestamp 合併排序，回傳 `{ events: ProxyEvent[], malformedLines: number, files: string[] }` | `node:fs/promises` |
| `src/proxy/analyze.ts` | **純函式** `analyzeEvents(events, opts) → AnalysisReport`；含 percentile helper、指紋分組、各區塊聚合、suggestedCommands 掛載 | `./sql-metadata`（`redactLiterals`）、`./events`（型別） |
| `src/proxy/analyze-render.ts` | `renderAnalysisText(report) → string` | — |
| `src/commands/proxy.ts` | 加 `analyze` 子指令 wiring：解析 flags → reader → analyze → renderer → stdout | 上述三者 |

- `AnalysisReport` 型別與各區塊 interface 定義在 `analyze.ts`（或同層 `analyze-types.ts`，視大小）。
- 聚合純函式不碰 IO；reader 與 command 負責 IO 與 wiring。

---

## 9. 錯誤處理

| 情況 | 行為 |
|------|------|
| events 檔不存在（且 `.1` 也不存在） | 友善錯誤：`no events found at <path>; run 'dbcli proxy ...' first`，exit 1 |
| 壞行（非法 JSON / 缺欄位） | 跳過該行，`source.malformedLines += 1`，不中斷 |
| 空檔 / 全壞行 | 回傳全 0 的合法報告（不報錯）；text 版印「no events to analyze」 |
| 非 `query_*` 事件（lifecycle / parse_error） | 計入 `sessions` / `parseErrors`，不進查詢聚合 |

---

## 10. 測試策略

- **`analyze.ts`（純函式，主力）**：以合成 `ProxyEvent[]` 驗證
  - percentile（含空集合、單元素、p99 邊界）
  - 指紋分組（不同字面值歸同指紋；redacted 事件冪等）
  - `summary` 計數與 `errorRate`（含分母 0）
  - `byFingerprint` 排序、`durationMs` 統計、`slowCount` 用 analyze 閾值
  - `errors` 分群、`hotTables` 展開計數、`repetition` 門檻
  - `suggestedCommands` 只掛 top SELECT；非 SELECT 不掛；shell 跳脫
- **`event-reader.ts`**：合併 current + `.1`、跳壞行並計數、缺檔、`--no-include-rotated`
- **`analyze-render.ts`**：text smoke（含各區塊標題、空報告訊息）
- **command**：flag 驗證錯誤路徑、缺檔友善訊息

---

## 11. 文件

依專案 Development Lifecycle，實作後須更新：

- `assets/reference.md`、`assets/SKILL.md`（proxy 區補 `analyze` 子指令）
- `docs/user/en/index.{md,html}`、`docs/user/zh-TW/index.{md,html}`（雙語 + 雙格式同步）
- `CHANGELOG.md`
