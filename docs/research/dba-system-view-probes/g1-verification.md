# G1：qualified schema inspection 驗收記錄

Story：[單一物件 schema 查詢](../../../specs/stories/qualified-system-schema-inspection.md)。
人於 2026-10-18 在對話核准；工作項目 `qualified-schema-inspection`。
交付狀態：**驗收及 Human Review 已通過**。ForgePilot EV-002 PASS、EV-003 APPROVED；
人於 2026-10-18 在對話完成審核並授權發 PR。原始 `evidence.json` 未改寫；補充觀察在
[g1-evidence.json](g1-evidence.json)，重現程式為 [g1-reproduce.ts](g1-reproduce.ts)。

## 1. 驗收條件 → 命令 → 觀察

命令均在 repository root 執行：

- **I**：`bun test tests/integration/qualified-schema-inspection.test.ts --timeout 60000` → 34 pass、0 fail、433 assertions。
- **U**：`bun test tests/unit/commands/schema-qualified-name.test.ts tests/unit/commands/schema-protection.test.ts tests/unit/adapters/qualified-schema.test.ts` → 19 pass、0 fail、61 assertions。
- **R**：`bun test tests/unit/adapters/postgresql-schema-identity.test.ts tests/unit/adapters/qualified-schema.test.ts` → 21 pass、0 fail、108 assertions。
- **P**：`bun --no-env-file docs/research/dba-system-view-probes/g1-reproduce.ts --queries` → exit 0；每個 CLI 子命令、exit、stdout、stderr 均保存在補充 JSON。
- **D**：`bun run docs:check` → 兩語言各 25 個主題對齊；新段落 Markdown／HTML 文字比對相同。
- **V**：`make verify` → exit 0，22 個 gates 全通過；7293 pass、0 fail、19 snapshots、22798 assertions。完整 log：`/tmp/dbcli-g1-verify-final.log`。

| AC | 命令／證據 | 實際觀察 |
| --- | --- | --- |
| AC-01 | I：namespace identity、views and system views | PG／MySQL／MariaDB 三引擎的表、view、系統視圖可由 agent query-only CLI 取得；非空 blacklist 生效。 |
| AC-02 | I：namespace identity；U：MySQL metadata preserves comma-containing column identities | 同名跨 namespace 的欄位、enum、PK、索引、FK 各自正確；跨 namespace FK 與逗號欄名未混用或拆錯。 |
| AC-03 | U：qualified schema names、malformed qualified names、native digit and dollar prefixes；I：quoted dots | 原生引號、escaped quote、大小寫與含點號物件成功；空 component、三段名稱與非法引用失敗。 |
| AC-04 | I：namespace identity、bare-view regression；R；V | bare 名稱仍取預設 namespace；既有 PG exact-case／SQL quoting 測試通過。DML／verify／diff 全部回歸列入 V。 |
| AC-05 | I：invalid and missing identities、refresh/reset、table rules | 成功、失敗及保護拒絕前後設定／快取／integrity 檔案快照相同；三種 refresh/reset 組合均非零 exit。 |
| AC-06 | U：qualified views、missing qualified objects；I：views and system views | driver SQL 攔截未見 relation COUNT；明確存在性失敗不回成功；view 輸出 null count/category 且無假的 metadata.rowCount。 |
| AC-07 | I：views and system views、bare-view regression | JSON／文字可辨識 namespace 與 local name；PG materialized view 為 view 並保留 enum labels；bare view 保留原計數行為。 |
| AC-08 | I：bare, qualified, glob and case-insensitive table rules；U：table blacklist | bare／qualified／glob／大小寫規則在兩種輸入形式均拒絕，未命中 view 仍成功。 |
| AC-09 | I：hidden source、target table or column、expression/partial、comma-column regressions；U：single SQL schema、rules union | 整個 PK／index／FK 被省略，兩處 FK 表示均受保護；JSON／文字不含受保護名稱；metadataOmitted 區分保護性省略。 |
| AC-10 | U：各 metadata failure；I：native account visibility、all columns protected | columns／PK／index／FK 失敗向外傳遞；受限原生帳號可讀已授權 view、拒絕未授權物件；全欄隱藏仍辨識物件存在。 |
| AC-11 | I：refresh/reset、native account visibility；V | query-only／agent mode 下成功與拒絕均不修改設定；既有權限、production、scan/list、write-gate gates 由 V 驗證。 |
| AC-12 | P；補充 JSON 的 cases 與 observations | 38 個案例：24 query-succeeded、11 absent-or-native-invisible、1 version-column-mismatch、2 out-of-scope-function-source。原始證據保留。 |
| AC-13 | D；CHANGELOG 與兩語言 index.md/index.html | 語法、shell 引號、舊名稱相容性、省略通知、未知計數與旗標限制齊全。 |
| AC-14 | V 加本表 | 22 個 gates 全通過，AC-01–13 均有上述觀察；ForgePilot 快照驗證及 Human Review 已通過。 |

另以 `bun test tests/integration/command-evidence-receipts.test.ts --timeout 60000` 觀察 8 pass、0 fail、208 assertions：修正空 blacklist 的錯誤文字回歸，保留非空 blacklist 的去敏。

`graft build` 已重建；freshness 的 added／removed／changed／stale 均為空。`git diff --check` 通過。

### ForgePilot 驗證與人工審查

命令：`COMPOSE_PROJECT_NAME=dbcli forgepilot verify qualified-schema-inspection --snapshot`。

- EV-002：**PASS**；22 gates，7293 pass／0 fail，19 snapshots、22790 assertions。
- Candidate：`8b235c38f31106f7f562a88c88b3219f6b816781`（SNAPSHOT）。
- Base：`2f8dfc605a3e7a73a639943026ab1642337c5f0a`。
- Candidate tree：`8589ff50061b987860244bd55a21606810ab1d9b`。
- Attestation SHA-256：`8e40368bce293e8e2e984a97645adab5effc87366dcb33267b6107a4eba585db`。
- EV-001 因隔離 checkout 改變 Compose project name，fixture 找不到服務而失敗；指定既有測試容器的 `dbcli` project 後重跑，兩輪 candidate tree 相同，沒有改測試或程式。
- 人確認「審核完成，發 pr」後，執行 `forgepilot review approve qualified-schema-inspection --by Carl`，結果 EV-003 APPROVED、工作 DONE、Goal COMPLETED。

## 2. 未執行或受阻檢查

- ForgePilot 使用不可變 SNAPSHOT candidate，並非驗證後才建立的 PR commit。程式碼與測試沿用已驗證內容；後續僅回填交付狀態。
- 無關的 `.scratch/` 與 CSV Story 不納入 PR。
- #240 回填內容另存 [g1-issue-update.md](g1-issue-update.md)，未對 GitHub 發文。
- RDS／replica topology／PITR 不在本 Story 範圍，未以空的本機 replication view 宣稱其健康。

## 3. 剩餘風險與相容性

- 原生權限不會被提高。information_schema 查無結果時，只能說不存在或不可見；不把推論寫成實測權限錯誤碼。
- PG 16 的 Q043 缺少 `inactive_since`、`invalidation_reason`、`failover`、`synced`，因此未執行原 SQL，也未擅改它。
- Q009／Q010 是 set-returning functions，無法以 table/view schema 契約驗收；保留為範圍外。
- CLI 會保守省略無法完整表達欄位依賴的 expression／partial index；不將部分 metadata 冒充完整約束。其他 adapter 呼叫者沿用既有 JOIN 行為。
- 完整名稱不做精確計數；舊名稱維持原計數路徑。schema 的黑名單保護會改變先前可見的輸出；新增 namespace 與省略通知是預期相容性差異。
- 獨立 production diff 審查：原五項問題及後續 JOIN 回歸均已修正，最後結論 clean。沒有新增依賴。
