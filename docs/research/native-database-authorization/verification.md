# G2 原生授權分類驗收

狀態：實作與獨立審查完成，完整驗證修復後重跑中，尚未 Human Review。
Story：`specs/stories/native-database-authorization.md`。
ForgePilot：`native-database-authorization`；GATE-001 已由 Carl 核准保留 v1、JSON 省略 verify。

## 驗收條件 → 命令 → 觀察

| AC | 命令／可重現觀察 | 結果 |
| --- | --- | --- |
| AC-01 | `bun test tests/unit/adapters/error-mapper.test.ts`，表列具名碼與 errno-only 的 MySQL／MariaDB 矩陣、PG 42501。 | 新增原生授權矩陣先出現 25 fail；修正後該輪 78 pass。其後加入 authentication 回歸案例並併入下列 873 pass。 |
| AC-02 | `bun test tests/unit/adapters tests/unit/core/recovery tests/unit/utils/connection-error-message.test.ts` | 873 pass、0 fail、7 snapshots、2940 assertions；含 1045／1698／28000／28P01、模糊文字與 42000、原生 query-only 啟動失敗的優先順序與本機 PermissionError 路徑。 |
| AC-03 | 同上，另 `bun test tests/core/repl/repl-engine.test.ts`；AC-06 的 schema/connect CLI。 | 三引擎 execute/schema/list 注入錯誤保留 discriminator；REPL 41 pass、0 fail、91 assertions，新增案例證明只執行一次且沒有 connect 呼叫。schema blacklist catch 的 code 保留與靜態安全訊息經獨立來源審查；既有保護回歸由完整 gate 驗證。 |
| AC-04 | `bun test tests/unit/core/recovery/native-authorization.test.ts`；AC-06 真實 CLI `recover --apply --format json`。 | recovery 新路徑先 4 fail，修正後與 mapper/presentation 合跑 88 pass。輸出人工指引、recovery 空陣列，省略 verify/branches/branchFork；apply results 空陣列、skipped-only，沒有假稱修復成功。 |
| AC-05 | 同一 recovery 測試的 writeLastEnvelope/readLastEnvelopeRaw/parseSavedRecoveryEnvelope round-trip。 | 既有 AUTH_FAILED 與新原生授權 v1 envelope 保存／重讀相同；真實 CLI 讀回相同 envelope 且 config bytes 不變。 |
| AC-06 | `bun test tests/integration/native-database-authorization.test.ts` | 5 pass、0 fail、107 assertions；MySQL/MariaDB 各觀察 1044、1142，PG 42501；每個 CLI denial exit 1。 |
| AC-07 | `bun run docs:check`、`git diff --check`。 | en/zh-TW 各 25 個 Markdown/HTML topics 對齊；CHANGELOG 已更新。獨立審查的本機 adapter-code 文件問題已修正並複審 clean。 |
| AC-08 | `make verify`，再以 `COMPOSE_PROJECT_NAME=dbcli forgepilot verify native-database-authorization --snapshot` 綁定候選。 | 初次 make verify 在第 10 gate 因 ADR Status 格式失敗（7348 pass、1 fail）。已修正 ADR 格式，bun test tests/unit/build/adr-references.test.ts 為 4 pass；ForgePilot 重跑結果保存於本機 Evidence，尚不以 focused checks 代替。 |

## 真實引擎觀察

```text
mysql native database denial {"code":"ER_DBACCESS_DENIED_ERROR","errno":1044}
mysql CLI database denial exit=1
mysql native table denial {"code":"ER_TABLEACCESS_DENIED_ERROR","errno":1142}
mysql CLI table denial exit=1
mariadb native database denial {"code":"ER_DBACCESS_DENIED_ERROR","errno":1044}
mariadb CLI database denial exit=1
mariadb native table denial {"code":"ER_TABLEACCESS_DENIED_ERROR","errno":1142}
mariadb CLI table denial exit=1
postgresql native table denial {"code":"42501"}
postgresql CLI table denial exit=1
```

所有 fixture 使用本機 Compose 專用服務及一次性帳號／物件，沒有 ambient 或 production
憑證。CLI 使用 query-only、agent mode 與非空 blacklist，先執行 blacklist/schema。
MySQL／MariaDB 使用 qualified schema 避免 COUNT；PG 在 schema 前置確認時暫時有 SELECT，
之後由 fixture 管理員明確撤銷，再以受限帳號成功連線、讀取 allowed table 並觀察 denied table
的 42501。這不是用較高權限執行受測命令。

初次整合測試失敗在 schema 前置 fixture，不當作產品程式的 red 證據；產品 red 證據是
mapper 與 recovery 測試。REPL 測試初次斷言錯誤欄位（error，而實際輸出在 output），
修正測試欄位後通過，亦不宣稱是產品缺陷。

## 跳過或受阻的檢查

沒有刻意跳過驗收檢查。完整 gate 修復後重跑中；Human Review 尚未進行。
獨立 reviewer 執行來源與契約審查，未自行執行測試；測試證據由主代理及整合測試代理取得。

## 殘餘風險

- 消費端若只看 recovery 大類 PERMISSION_DENIED，無法區分本機政策與原生授權；需讀取 error.details.connectionCode。
- 首批分類只涵蓋 Story 列出的明確代碼；未知錯誤保持既有行為，沒有廣泛字串猜測。
- 本次是真實本機 MySQL／MariaDB／PostgreSQL 證據，不聲稱驗證 RDS 程序或雲端授權。
- 沒有新增依賴、資料或設定遷移；無關的 .scratch 與 csv Story 保留不變。
