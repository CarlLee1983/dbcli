# Story: 區分資料庫原生授權不足與登入驗證失敗

狀態：本次對話已由使用者核准本文、ForgePilot 計畫與 GATE-001 的 v1 相容性修正；實作中。
關聯：#240 G2；G1 已由 PR #246 合併。
決策：[ADR-0049](../../docs/adr/ADR-0049-native-authorization-has-a-distinct-recovery-path.md)。

## Goal

MySQL、MariaDB 與 PostgreSQL 使用者遇到明確的原生授權不足時，取得可機器辨識的
原生授權分類與正確處理建議，不被引導去更換密碼、重新初始化或放寬 dbcli 政策。
原生授權不足可能在連線建立或執行查詢時發生；不得據此斷言登入已成功。

## Out of Scope

- G3 grant 文字去敏與 G4／#241 RDS CALL 政策。
- 自動 GRANT、切換帳號、修改密碼或設定、提高原生或本機權限。
- 改變 query-only、agent mode、blacklist、production selection 或 write gate。
- 其他引擎的錯誤分類重設、依模糊文字推測權限、通用錯誤架構重構。
- recovery schema 版本升級、改寫已保存的 recovery envelope、新增套件。

## 行為契約

### 原生錯誤與分類

共用 SQL adapter 邊界新增 `DB_PERMISSION_DENIED`，支援以下明確原生代碼：

| 引擎 | 原生代碼 |
| --- | --- |
| MySQL／MariaDB | `ER_DBACCESS_DENIED_ERROR`／1044、`ER_TABLEACCESS_DENIED_ERROR`／1142、`ER_COLUMNACCESS_DENIED_ERROR`／1143、`ER_SPECIFIC_ACCESS_DENIED_ERROR`／1227 |
| PostgreSQL | `42501`（insufficient_privilege） |

MySQL／MariaDB 的具名 code 與僅有 errno 的形式都要涵蓋。不得只因 SQLSTATE `42000`
或訊息包含 access denied 而套用新分類。既有登入驗證失敗（包括 1045、1698、
PostgreSQL 28000／28P01）、未知錯誤與 dbcli 本機政策拒絕，保留原本語意。
新分類不是 transport error，不應觸發自動重連或連線故障的復原分支。
query-only 的交易啟動失敗仍保留既有錯誤優先順序。

### 復原與相容性

保留 recovery schema v1 與既有大類 `PERMISSION_DENIED`，以
`details.connectionCode: "DB_PERMISSION_DENIED"` 明確區分原生授權不足。
一般 adapter 錯誤與 recovery envelope 的辨識方式都需文件化。

新路徑只提供人工建議：確認目標資料庫／物件及操作所需權限，必要時交由 DBA 處理，
處理後重新執行原命令。不得提供可由 `recover --apply` 執行的修復動作，也不新增
inspect、doctor、init 或其他自動診斷命令。驗證步驟產生器回 null，JSON 沿用 v1 省略 `verify`，不得以連線成功或
本機 canWrite／canDestruct 等旗標宣告原生授權已修復。

指引採靜態安全文字，不複製原生錯誤中的帳號、SQL、物件名稱或憑證材料至新增欄位；
保留現有遮罩與受保護 schema 錯誤的限制。既有 local PERMISSION_DENIED 復原行為不變。
讀取既有 v1 envelope 與保存／重讀新分類的 envelope 都要有相容性驗證，不遷移歷史檔案。

## Acceptance Criteria

| ID | 可觀察結果 | 必需證據 |
| --- | --- | --- |
| AC-01 | 表列原生代碼均映射至 DB_PERMISSION_DENIED，涵蓋具名與 errno-only 形式。 | 共用 mapper 的參數化單元測試；PG 42501 既有測試更新為新契約。 |
| AC-02 | 登入驗證、本機政策拒絕、未知錯誤與模糊文字不被誤判；一般 42000 不足以分類。 | 正反例回歸測試，含既有 authentication 代碼與 query-only 交易啟動錯誤優先順序。 |
| AC-03 | 新錯誤經 connect、execute、schema、list 的既有共用邊界保持分類，非 transport，不誤觸發重連。 | adapter／命令與 REPL 相關邊界測試；保留 blacklist 的錯誤遮罩。 |
| AC-04 | recovery v1 明示原生 discriminator，只提供人工指引、JSON 省略 verify，無連線修復分支、無可自動執行動作。 | recovery 產生、文字／JSON 呈現與 recover --apply 的行為測試；確認不修改設定或執行 grant/init。 |
| AC-05 | 舊 v1 envelope 仍可讀，新 envelope 保存後可重讀；原生與本機拒絕復原路徑互不混用。 | 持久化及既有本機 PERMISSION_DENIED 回歸測試，不改寫歷史檔案。 |
| AC-06 | 真實受限帳號的錯誤證明分類正確；成功連線不代表有查詢權限。 | 隔離 MySQL／MariaDB：可存取 fixture DB，但拒絕另一 DB 及受限操作；隔離 PG：可連線但表讀取遭 42501。記錄 driver 代碼與 CLI 非零結果，遵循 blacklist/schema 前置流程，不使用 ambient／production credentials。 |
| AC-07 | 使用者能區分三種拒絕與兩層錯誤碼，知道如何人工處理及相容性影響。 | docs/user/en、zh-TW 的 index.md／index.html 同步更新，CHANGELOG 記錄代碼變化；docs parity 通過。 |
| AC-08 | 完整驗證通過，每個 AC 都有可重現觀察，安全／公開介面獨立審查無未解決重大問題。 | make verify exit 0，ForgePilot 綁定候選的證據與逐條驗收報告；缺少任何證據時只能報 partial。 |

## 驗證與交付

測試 fixture 的管理員只用於隔離環境建置與清理；受測 CLI 使用受限帳號、query-only、
DBCLI_AGENT_MODE=1 與非空 blacklist。單元注入與真實引擎證據分別記錄，不能互相冒充。
研究原始證據不覆寫。環境不足或修復超出本文範圍時停止並回報，不降低驗收標準。

完成後依序獨立審查、make verify／ForgePilot verify、Human Review；不自行核准 Review。
核准本文僅啟動 G2，不代表 G3、G4 的策略已核准。無資料或設定遷移；回退需還原程式與文件，
並留意下游可能已依賴新的 discriminator，不刪除已保存證據。
