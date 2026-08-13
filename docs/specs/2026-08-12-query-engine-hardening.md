# 查詢引擎 hardening 規格（v1.53 後）

> 正式版本：GitHub issue [#37](https://github.com/CarlLee1983/dbcli/issues/37)（spec）與 #38–#49（tickets，皆貼 ready-for-agent）。本檔為 repo 內快照，實作以 issue 為準。
>
> **狀態（2026-08-13，本規格已完成）**：#38–#50 全數完成並關閉。實測結果記在
> `benchmarks/baseline.json`：`--help` 176ms → 98ms、schema 全掃描（500 表）
> 14.02s → 5.88s、Redis `list`（50 萬 key）350ms → 180ms、命令收尾的 skill 檢查
> 240ms → 190ms。#44 的綁定檔快取只降低讀取次數（每次執行 2–6 次 → 1 次），牆鐘時間
> 量不到差異。
>
> #48 只交付了兩項 AC（SQL driver 與 node-sql-parser 的按需載入），第三項「子命令按需
> 載入」轉為 [#50](https://github.com/CarlLee1983/dbcli/issues/50) 並於 PR #55 完成，
> 決策記於 [ADR 0007](../adr/0007-lazy-subcommand-registration-runs-beside-the-eager-tree.md)。
>
> **這輪最值得帶走的一課**：#50 估 50ms、實得 8ms。那個估計來自對 source 跑
> `bun -e 'await import(m)'` 量各模組的載入成本，但 dbcli 出貨的是 `bun build --outfile`
> 的單檔 bundle、沒有 code splitting —— 延後求值不減少 parse，兩者不是同一回事。下一次
> 動啟動成本前，先在**出貨產物**上量出天花板再選設計。量測本身也要當心：`bun run build`
> 非決定性（[#56](https://github.com/CarlLee1983/dbcli/issues/56)），拿一側的大版比另一側
> 的小版會量出約 13ms 的假象，兩側必須釘在同一個變體。

## Problem Statement

dbcli 的使用者（人類與 AI agent）在日常查詢中遇到多種底層引擎的問題：設定了 `--timeout` 但 MySQL/MariaDB 查詢仍然不受限制地等待；一般的 SQL 錯誤（如資料表不存在）被回報成「認證失敗」，把除錯方向帶偏；每次查詢的固定延遲偏高，對高頻呼叫 CLI 的 AI agent 情境尤其明顯；`schema` 全表掃描與 Redis/ES 的列表操作在正式環境的大型資料庫上慢到不可用；含特殊字元的識別字在 migrate 與 schema 路徑上可能產生錯誤的 SQL 或打到錯誤的 ES endpoint。

## Solution

對查詢引擎做一輪點狀修補（hardening），不改變整體架構：修正四個行為錯誤（timeout 語意、錯誤分類、audit 重複寫入、識別字 escape），削減每次執行的固定 I/O 開銷（schema 全載、skill 更新檢查、config 重複讀取與驗證、bundle eager 載入），並修正三個大型資料庫情境下的效能地雷（schema N+1、Redis 全 keyspace 掃描、adapter 層的 server-side script 防護缺口）。修補後所有引擎的 timeout、錯誤訊息、audit 行為一致且可預期。

## User Stories

1. As a dbcli 使用者, I want `--timeout` 對 MySQL/MariaDB 查詢實際生效, so that 慢查詢會在我指定的時間內被中止而不是無限期等待
2. As a dbcli 使用者, I want 連線逾時與語句逾時是兩個獨立的設定, so that 放寬慢查詢的限制不會同時放寬連線失敗的偵測時間
3. As a PostgreSQL 使用者, I want 預設情況下超過 5 秒的分析查詢不會被伺服器砍掉, so that 我不需要為了跑報表去調整與連線無關的旗標
4. As a dbcli 使用者, I want 「資料表不存在」的錯誤被如實回報, so that 我不會被「認證失敗，請檢查帳號密碼」的誤導訊息帶去錯誤的除錯方向
5. As an AI agent, I want 錯誤分類以資料庫回傳的 error code 為準, so that 我的自動修復流程不會基於錯誤的分類做出錯誤的下一步
6. As a 稽核者, I want 一次成功的查詢在 audit log 恰好留下一筆紀錄, so that 統計與追蹤不會因重複計數而失真
7. As a dbcli 使用者, I want 含反引號、引號或特殊字元的資料表名在 migrate 與 schema 查詢中被正確 escape, so that 產生的 SQL 不會語法錯誤或指到錯誤的物件
8. As an Elasticsearch 使用者, I want index 名稱在組進 API 路徑前被正確編碼, so that 含特殊字元的 index 不會被解讀成不同的 endpoint
9. As an AI agent, I want 查詢命令不載入與本次查詢無關的完整 schema 索引, so that 每次呼叫的延遲降到最低
10. As a dbcli 使用者, I want 預設輸出格式下的命令不在結束前逐檔比對 skill 安裝狀態, so that 每個命令的收尾時間可預期
11. As a dbcli 使用者, I want config 綁定檔在一次執行內只被讀取與驗證一次, so that 不必為同一份檔案重複付出 I/O 與雜湊成本
12. As an AI agent, I want 查 Redis 或 Mongo 時不載入 SQL driver、查詢命令不解析全部子命令模組, so that CLI 冷啟動時間縮短
13. As a DBA, I want `schema` 全表掃描不對每張表做全表 COUNT 與重複的 metadata 查詢, so that 百張表的資料庫也能在合理時間內完成掃描
14. As a Redis 使用者, I want `list` 在大型 keyspace 上有明確的取樣上限, so that 正式環境的百萬 key 不會觸發上百次 SCAN 與十萬筆 key 載入
15. As an Elasticsearch 使用者, I want 列出 index 只發一個輕量請求, so that 大叢集上不會為了取名稱拉回全部 settings
16. As a 資安負責人, I want MongoDB 的 `$where` 與 Elasticsearch 的 `script` 在主查詢路徑上被 adapter 層攔截, so that server-side script 防護不能被繞過 saved-queries 與 DML 支線之外的路徑規避
17. As a dbcli 維護者, I want 修補前後有可比對的效能 baseline, so that 每項固定開銷的削減都有量測證據而非推論
18. As a dbcli 使用者, I want 各引擎在 timeout、錯誤分類、結果上限的行為一致, so that 我在不同資料庫之間切換時不需要重新學習各自的例外

## Implementation Decisions

- **Timeout 語意統一**：逾時拆成連線逾時與語句逾時兩個概念。解析點依 ADR 0003 維持在 AdapterFactory 的三個生成入口，設定物件不攜帶覆寫值。MySQL/MariaDB adapter 開始消費既有的 timeout 選項（連線逾時用 driver 的 connect timeout，語句逾時用 session 級的 max_execution_time）；PostgreSQL 不再把同一值同時餵給連線與語句逾時。ADR 0003 Consequences 中「PG 兩者共用同值、故下限訂 100ms」的段落隨本決策更新。
- **錯誤分類以 error code 為主**：error mapper 的判斷順序改為 driver error code / SQLSTATE 優先，字串比對僅作為無 code 時的後備，且後備字串需為完整詞組而非子字串（消除 "users" 命中 "user" 的誤判）。
- **Audit 單一寫入點**：一次命令執行只在命令層寫入一筆 audit entry，查詢執行器不再自行寫入；執行器保留回報執行資訊（耗時、列數）給命令層的職責。audit 合約明訂「一次 CLI 查詢 = 恰好一筆 entry」。
- **識別字 escape 共用**：PostgreSQL adapter 既有的正確 quote 實作抽為共用工具，DDL 產生器與 MySQL 的 metadata 查詢一律經由它；Elasticsearch 的 index 與 document id 組 URL 路徑前一律 percent-encode。
- **查詢路徑不載入 layered schema**：config 讀取已有的「跳過 schema 全載」選項在查詢命令啟用；size guard 需要個別表的 schema 時按需載入。
- **Skill 更新檢查改為 TTL 快取**：postAction 的逐檔比對改為帶時間戳的快取，快取有效期內直接跳過；機器可讀格式維持完全跳過的現狀。
- **Config 綁定 process 內快取**：綁定檔讀取與完整性驗證加 process-level memo，一次執行內最多一次；寫入路徑使快取失效。
- **CLI 載入分層**：子命令模組改為按需載入，SQL driver 的頂層 import 降級為使用時載入（MongoDB adapter 的動態 import 是既有先例）。既有的 `--version` fast path 模式延伸到查詢命令。
- **Schema 掃描降本**：單表 metadata 的重複查詢合併（engine 與 estimated rows 同源查詢併為一次）；全掃描模式以既有的 estimated rows 取代全表 COUNT；逐表迴圈改為有界並行。
- **Redis 列表上限**：列出 keys 沿用取樣既有的明確 limit 傳遞模式，不再使用十萬 key 的預設上限；blacklist 過濾在掃描過程套用而非掃描完套用。
- **ES 列表輕量化**：列出 index 改用 cat API 一次取得名稱與文件數。
- **Server-side script 防護收斂到 adapter**：MongoDB 的 `$where` 與 Elasticsearch 的 `script`/`script_fields` 檢查移入（或複製到）adapter 的執行入口，使所有呼叫路徑一致受檢；既有 DML 與 saved-queries 支線的檢查保留。
- **Baseline 先行**：動工前重測並更新效能 baseline；查詢 perf 測試的預算從 5000ms 收緊到能抓到迴歸的量級。

## Testing Decisions

- 只測外部行為：timeout 測「慢查詢在指定時間內收到逾時錯誤」，不測內部傳了哪個參數；錯誤分類測「給定 driver 錯誤，回報的錯誤類別與訊息」；escape 測「產出的 SQL 字串 / 請求路徑」；audit 測「一次 CLI 查詢後 log 檔的行數與內容」。
- 三個既有 seam，不新增：
  - **Adapter 單元 seam**（既有 error-mapper、DDL、factory 測試為先例）：錯誤分類、識別字 escape、ES URL 編碼、timeout 選項消費、server-side script 攔截。
  - **Audit 合約 seam**（既有 audit-contract 整合測試為先例）：擴充「一次 CLI 查詢 = 恰好一筆 entry」的斷言。
  - **CLI 整合 seam**（既有 cli 與 live-db 整合測試為先例）：`--timeout` 端到端生效、schema 全掃描的查詢行為、Redis list 上限、查詢命令不觸發 schema 全載。
- 無法在上述 seam 驗證的啟動開銷（bundle 分層載入）以既有 startup bench 護欄，並更新 baseline 數據。

## Out of Scope

- 導入 streaming / cursor（query 有 auto-LIMIT、Redis 有 size guard，唯一無界的 `export --no-limit` 尚無實際 OOM 回報）
- 將 PostgreSQL driver 從 pg 換成 Bun.sql（收益僅規則合規，需重寫全部 metadata 查詢與 SQLSTATE 對接）
- SQL 字串掃描的重複消除（微秒級，排在所有 I/O 問題之後）
- 查詢取消（Ctrl-C 結束 process 已足夠，互動式 shell 另有處理）
- 介面統一（DatabaseAdapter 與 QueryableAdapter 合併）與 capabilities 宣告表重構
- recovery 機制（happy path 零成本，非問題）

## Further Notes

- 本 spec 源自 2026-08-12 的引擎底層分析，分析報告含完整 file:line 佐證，實作時以當下程式碼為準。
- Elasticsearch adapter 是六個 adapter 中唯一整體品質落後的（型別鬆散、URL 未編碼、size 無 clamp），相關 ticket 可視為同一輪 hardening 的一部分。
- ADR 0003（連線逾時於 adapter 建構時解析）為 timeout 修補的邊界約束；timeout 拆分決策若成案，屬於該 ADR 的後果更新而非推翻。
