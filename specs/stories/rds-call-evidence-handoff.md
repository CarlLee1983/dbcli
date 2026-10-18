# Story: RDS CALL 被拒時保留證據不足與人工交接

狀態：使用者已核准政策、本文交付範圍與驗收契約；實作中。
關聯：#240 G4、#241。G3 已由 EV-007 Human Review 核准。

## 已核准決策

query-only 維持對 CALL 的拒絕，不建立 RDS 程序允許清單。無法透過此路徑取得的
RDS 觀察視為 indeterminate（證據不足），交由人工取得證據；不建議升級 admin。
不得以平台 API 的其他欄位冒充等價觀察，也不自動呼叫 AWS 或原生客戶端。

須區分兩個層次：dbcli 的執行遭政策拒絕；DBA 想確認的配置尚無足夠證據。
前者不表示程序不存在、原生帳號被拒、binlog 保留為零或備份不健康。
此處 indeterminate 是 DBA 證據結論，不預先承諾更改 CLI 或 receipt 的既有狀態。

## Goal

使用者遇到 `CALL mysql.rds_show_configuration` 的 query-only 拒絕時，能辨識目前
觀察的限制、所缺證據與人工交接方式，不以提高權限或誤用平台指標繞過限制。

## Out of Scope

- CALL 放行、權限分類變更、新錯誤碼、新 CLI／receipt schema 或 AWS 整合。
- 自動重試、切換 admin、執行原生客戶端或修改任何 RDS 資源。
- 宣稱本機資料庫或 mocks 已驗證 RDS 程序、權限、唯讀交易或結果處理能力。
- 將 G4 誤列為新增 RDS 程序支援；變更或重寫原始研究觀察。

## Acceptance Criteria

1. docs/user/en 與 zh-TW 的 index.md／index.html 同步說明 CALL 拒絕、觀察證據不足、
   與程序不存在／原生權限不足／配置不健康的差別。
2. 人工交接模板列出目標部署與引擎版本、所需觀察、拒絕原因、證據時間與來源、
   去敏後結果、仍缺項目；只在既有授權下由操作人員取得證據，不以升權作為預設補救。
3. 文件明確區分 binlog retention hours 與自動快照 BackupRetentionPeriod；沒有來源
   證明時不宣稱平台 API 等價。證據不足不能判為成功或不健康。
4. 保存／引用既有 Q024／Q025 的本機拒絕證據與共享權限邊界來源，確認未放寬執行政策。
   不為文件變更製造實機 RDS 或成功 CALL 的驗收要求。
5. 文件一致性與 canonical `make verify` 通過；ForgePilot snapshot 驗證與獨立審查完成，
   再等待 Human Review。保留 G2／G3 與其他未提交工作。

## 來源

- [G4 原始觀察](../../docs/research/dba-system-view-probes.md)：本機拒絕不證明 RDS 能力。
- [AWS 程序說明](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/mysql-stored-proc-configuring.html)：binlog retention hours。
- [AWS DBInstance](https://docs.aws.amazon.com/AmazonRDS/latest/APIReference/API_DBInstance.html)：BackupRetentionPeriod 為自動快照保留天數。
