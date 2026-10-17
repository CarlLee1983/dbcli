# 備份與 PITR 的可觀察訊號與原生工具（研究 #237）

> 範圍：回答 [#237](https://github.com/CarlLee1983/dbcli/issues/237)，供 [#231](https://github.com/CarlLee1983/dbcli/issues/231) DBA Role Skill v1 使用。分兩層：**引擎層**（SQL 可觀察、經 dbcli 唯讀讀取；PostgreSQL／MySQL／MariaDB，含 RDS 差異）與**平台層**（只限 AWS RDS for PostgreSQL／MySQL／MariaDB，不含 Aurora；只用 `describe-*`／`list-*`／CloudWatch `get-metric-*`）。
>
> 來源：PostgreSQL 18 文件（頁首 18.6）、MySQL 8.4 Reference Manual、MariaDB 官方文件、AWS RDS User Guide／API Reference、AWS CLI v2 reference、AWS Backup Developer Guide，皆於 2026-10-17 讀取。每條敘述標註模式：**已查證**（原文直接陳述）、**推論**（由已查證事實推得）、**未查證**（記憶或二手，需日後確認）。dbcli 本身的行為以檔案行號查證。

## 結論先行

「備份存在、完整、可讀」三個問題，兩層能回答的範圍不同：

| 問題 | 引擎層（SQL） | 平台層（RDS 唯讀 API） |
|---|---|---|
| 備份**存在**、最後一次何時 | 自管：`pg_stat_archiver.last_archived_time`、`SHOW BINARY LOGS`；全量備份時間 SQL 看不到 | `describe-db-snapshots` 的 `SnapshotCreateTime`、`describe-events` 的 RDS-EVENT-0002／0091 |
| 日誌**連續性**（WAL／binlog） | 自管：`pg_stat_archiver.failed_count`／`last_failed_*`、binlog 檔號連續；RDS 上只能間接看 | `LatestRestorableTime` 持續前進（約落後 5 分鐘內）＝ RDS 的日誌上傳在運作 |
| **保留期** | `binlog_expire_logs_seconds`、RDS `binlog retention hours` | `BackupRetentionPeriod`、`RestoreWindow.EarliestTime` |
| **可讀**（真的還原得回來） | 無法從線上主庫證明 | 只有實際還原演練能證明；AWS Backup restore testing 可排程並回傳 `ValidationStatus` |

核心判斷（推論）：在 RDS 上，平台層是備份健康的權威來源，引擎層只是補充；在自管環境則相反。不論哪種環境，「可讀」都只能靠隔離環境的還原演練證明，這一步必須由人核准後執行，Skill 只做演練後的唯讀驗證。

## 一、引擎層：PostgreSQL

### 唯讀訊號

| 訊號 | SQL | 意義 | 權限 |
|---|---|---|---|
| 歸檔進度 | `SELECT * FROM pg_stat_archiver;` | `archived_count`、`last_archived_wal`、`last_archived_time`、`failed_count`、`last_failed_wal`、`last_failed_time`、`stats_reset`。**已查證** [monitoring-stats](https://www.postgresql.org/docs/18/monitoring-stats.html#MONITORING-PG-STAT-ARCHIVER-VIEW) | 一般使用者可讀（**未查證**：頁面未明列權限） |
| 歸檔設定 | `SHOW wal_level; SHOW archive_mode; SHOW archive_command; SHOW archive_library; SHOW archive_timeout;` | PITR 需要 `wal_level` ≥ `replica`、`archive_mode=on`、設定 `archive_command` 或 `archive_library`。**已查證** [continuous-archiving](https://www.postgresql.org/docs/18/continuous-archiving.html) | 部分設定需 `pg_read_all_settings`（**未查證**） |
| 目前 WAL 位置 | `SELECT pg_current_wal_lsn(), pg_walfile_name(pg_current_wal_lsn());` | 與 `last_archived_wal` 比對可估歸檔落後幾個段。文件說 `pg_current_wal_*` 「are all read-only operations and do not require superuser permissions」。**已查證** [functions-admin](https://www.postgresql.org/docs/18/functions-admin.html) | 無特別權限 |
| 待歸檔積壓 | `SELECT count(*) FROM pg_ls_archive_statusdir() WHERE name LIKE '%.ready';` | `.ready` 檔數量＝尚未歸檔的段數（推論）。 | 限 superuser 或 `pg_monitor`，可另行 GRANT EXECUTE。**已查證** |
| WAL 目錄 | `SELECT count(*), sum(size) FROM pg_ls_waldir();` | WAL 堆積（歸檔失敗或 slot 卡住時會長大）。 | 同上，**已查證** |
| Replication slot 留存 | `SELECT slot_name, active, wal_status, restart_lsn FROM pg_replication_slots;` | 卡住的 slot 會讓 WAL 無法回收（推論，與備份無直接關係，但會吃滿磁碟、間接讓備份停擺）。 | 一般可讀（**未查證**） |
| 是否處於復原 | `SELECT pg_is_in_recovery(), pg_last_xact_replay_timestamp();` | 演練時在還原出的實例上用：後者是最後重播交易的時間，可對照 PITR 目標時間。**已查證** | 無特別權限 |

注意一個陷阱（**已查證**）：「it is not safe to assume that all files older than `last_archived_wal` have also been successfully archived」，因為 promote standby 或 crash recovery 後歸檔不保證依序。所以 `pg_stat_archiver` 只能當健康指標，不能當連續性證明。

連續性要求（**已查證**）：「you need a continuous sequence of archived WAL files that extends back at least as far as the start time of your backup」。這個連續性只有在歸檔目的地（檔案系統或物件儲存）才能完整驗證，SQL 看不到。

### 原生工具（自管）

- `pg_basebackup`：基礎備份，`-X` 把所需 WAL 一併收進備份，`--incremental` 做增量。**已查證** [continuous-archiving](https://www.postgresql.org/docs/18/continuous-archiving.html)
- `pg_verifybackup`：依 `backup_manifest` 檢查檔案是否齊全、checksum 是否相符，並用 `pg_waldump` 解析還原所需 WAL。文件明說它「does not and cannot include every check which will be performed by a running server」，仍需實際還原。tar 格式要加 `-n` 跳過 WAL 解析。**已查證** [app-pgverifybackup](https://www.postgresql.org/docs/18/app-pgverifybackup.html)
- PITR：設定 `restore_command` 與 recovery target（例如 `recovery_target_time`），建立 `recovery.signal`。停止點必須晚於基礎備份結束時間。**已查證**（`recovery_target_time` 參數名稱本次讀取頁面未出現，屬**未查證**，見 runtime-config-wal 章節）
- `pg_dump`：邏輯備份，非 PITR 工具。

這些工具都要 shell 或檔案系統存取，不屬於 dbcli 的 SQL 範圍；Skill 只能在 runbook 中列出，交人執行。

### RDS for PostgreSQL 的差異

- 主帳號 `postgres` 是 `NOSUPERUSER ... NOREPLICATION`，透過 `rds_superuser` 取得管理權限；「you can't access the host OS, and you can't connect using the PostgreSQL superuser account」。**已查證** [rds_superuser](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Appendix.PostgreSQL.CommonDBATasks.Roles.rds_superuser.html)
- 因此 `pg_basebackup`（需 REPLICATION 屬性）無法對 RDS 使用（**推論**），`pg_verifybackup` 也就沒有對象。RDS 的備份是儲存區快照加交易日誌上傳到 S3，使用者看不到備份檔本身。**已查證**（[Introduction to backups](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_WorkingWithAutomatedBackups.html)：「RDS creates a storage volume snapshot」「Backups are stored in Amazon S3」）
- WAL 歸檔由 RDS 管理。`archive_command` 在 RDS 上是 RDS 自己的腳本、使用者不能改（**未查證**：AWS 文件未找到明文；第三方資料顯示其值為 `/etc/rds/dbbin/pgscripts/rds_wal_archive`）。`pg_stat_archiver` 在 RDS 上應仍反映這支腳本的成敗（**推論，未查證**），可作輔助訊號，但權威來源是平台層的 `LatestRestorableTime`。
- `rds_superuser` 是否預設具備 `pg_monitor`（決定能否呼叫 `pg_ls_waldir`／`pg_ls_archive_statusdir`）：**未查證**。
- 平台層有對應指標：`TransactionLogsDiskUsage`、`TransactionLogsGeneration`、`OldestReplicationSlotLag`、`ReplicationSlotDiskUsage`（見第三節）。

## 二、引擎層：MySQL／MariaDB

### 唯讀訊號

| 訊號 | SQL | 意義 / 來源 |
|---|---|---|
| binlog 是否開啟 | `SELECT @@log_bin, @@binlog_format, @@sync_binlog;` | PITR 的來源是「the set of binary log files generated subsequent to the full backup operation」，必須開 binlog（MySQL 8.4 預設開）。**已查證** [point-in-time-recovery-binlog](https://dev.mysql.com/doc/refman/8.4/en/point-in-time-recovery-binlog.html)；`binlog_format` 在 8.4 已 deprecated，預設 `ROW`。**已查證** [replication-options-binary-log](https://dev.mysql.com/doc/refman/8.4/en/replication-options-binary-log.html) |
| binlog 清單與大小 | `SHOW BINARY LOGS;` | 欄位 `Log_name`、`File_size`、`Encrypted`（MySQL）；MariaDB 為 `Log_name`、`File_size`。檔號連續＝本機 binlog 未斷。MySQL 需 `REPLICATION CLIENT`；MariaDB 需 `BINLOG MONITOR`。**已查證** [MySQL](https://dev.mysql.com/doc/refman/8.4/en/show-binary-logs.html)、[MariaDB](https://mariadb.com/docs/server/reference/sql-statements/administrative-sql-statements/show/show-binary-logs) |
| 目前 binlog 位置 | MySQL 8.4：`SHOW BINARY LOG STATUS;`；MariaDB／舊版 MySQL：`SHOW MASTER STATUS;` | **已查證**（8.4 頁面）；舊語法對照為**未查證** |
| binlog 保留期 | MySQL：`SELECT @@binlog_expire_logs_seconds;`（預設 2592000＝30 天，0 表示不自動清除） | **已查證**；MariaDB 對應變數（`expire_logs_days`／`binlog_expire_logs_seconds`）**未查證** |
| GTID 位置 | MySQL：`SELECT @@gtid_mode, @@gtid_executed;`；MariaDB：`SELECT @@gtid_binlog_pos, @@gtid_current_pos;` | 演練時比對來源與還原實例的交易位置（**推論**）；變數名**未查證** |
| 非 crash-safe 引擎 | `SELECT table_schema, table_name, engine FROM information_schema.TABLES WHERE engine NOT IN ('InnoDB') AND table_schema NOT IN ('mysql','information_schema','performance_schema','sys');` | RDS MySQL：自動備份「only supported for the InnoDB storage engine」，MyISAM 可能還原後損毀。RDS MariaDB：PITR 與快照還原只支援建議引擎（InnoDB），其他引擎目前不支援（MyRocks 10.6+ 可用）。**已查證** [MySQL](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Overview.BackupDeviceRestrictions.html)、[MariaDB](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/MariaDB.Concepts.Storage.html) |

### 原生工具（自管）

- PITR 流程：全量備份＋`mysqlbinlog binlog_files | mysql`；加密 binlog 要用 `--read-from-remote-server`。**已查證** [point-in-time-recovery-binlog](https://dev.mysql.com/doc/refman/8.4/en/point-in-time-recovery-binlog.html)。`--stop-datetime`／`--stop-position` 定義在 mysqlbinlog 章節（本次未讀，**未查證**）。
- 全量備份工具：`mysqldump`、MySQL Shell dump utilities、MariaDB 的 `mariadb-dump`／`mariadb-backup`；Percona XtraBackup 為常用第三方工具。這些都不在本次查證範圍（**未查證**）。

### RDS for MySQL／MariaDB 的差異

- binlog 開關由備份保留期決定：保留期 > 0 開啟，= 0 關閉。**已查證** [binary logging](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_LogAccess.MySQL.BinaryFormat.html)
- binlog 在 RDS 本機「normally purges ... as soon as possible」；`binlog retention hours` 預設 `NULL`（＝0 小時），最大 168。查詢方式是 `CALL mysql.rds_show_configuration;`。**已查證** [mysql-stored-proc-configuring](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/mysql-stored-proc-configuring.html)。所以在 RDS 上 `SHOW BINARY LOGS` 只看到短暫留存的本機檔，**不能**用來判斷 PITR 涵蓋範圍（推論）；PITR 範圍要看平台層的 `RestoreWindow`。
- **dbcli 限制（已查證）**：`query-only` 權限只允許 `SELECT`、`SHOW`、`DESCRIBE`、`EXPLAIN`（`src/core/permission-guard.ts:365`），`CALL mysql.rds_show_configuration` 不在其中，Skill 在 query-only 下無法讀取。替代方案是直接 `SELECT` 程序寫入的 `mysql.rds_configuration` 表（文件提到 `source delay` 會存進此表），但主帳號對該表的 SELECT 權限**未查證**。這點值得在 #231 決定是否開唯讀白名單。
- MariaDB 10.5+ 的 `SHOW REPLICA STATUS` 需要 `REPLICATION REPLICA ADMIN`，RDS 主帳號沒有，改用 `mysql.rds_replica_status`。**已查證** [MariaDB feature support](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/MariaDB.Concepts.FeatureSupport.html)。主帳號是否有 `BINLOG MONITOR`（決定 `SHOW BINARY LOGS` 能否在 RDS MariaDB 執行）**未查證**；RDS MySQL 主帳號是否有 `REPLICATION CLIENT` 亦**未查證**。

## 三、平台層：AWS RDS（唯讀 API）

### 3.1 備份設定與 PITR 窗口

`aws rds describe-db-instances --db-instance-identifier <id>`（[DBInstance](https://docs.aws.amazon.com/AmazonRDS/latest/APIReference/API_DBInstance.html)，**已查證**）：

| 欄位 | 用途 |
|---|---|
| `BackupRetentionPeriod` | 自動備份保留天數。0＝停用自動備份（也停用 PITR，MySQL 同時關 binlog）。範圍 0–35，CLI/API 建立預設 1 天、主控台預設 7 天。**已查證** [Backup retention](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_WorkingWithAutomatedBackups.BackupRetention.html) |
| `LatestRestorableTime` | 可 PITR 的最新時間。RDS「uploads transaction logs ... to Amazon S3 every five minutes」，正常應落後現在 5 分鐘左右；若持續落後，代表日誌上傳中斷。**已查證** [USER_PIT](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_PIT.html)（落後門檻屬推論） |
| `PreferredBackupWindow` | 每日自動快照時段 |
| `BackupTarget` | 備份存放位置（Region／Outposts／Local Zones） |
| `AwsBackupRecoveryPointArn` | 若由 AWS Backup 管理，對應的 recovery point |
| `DBInstanceAutomatedBackupsReplications` | 跨 Region 備份複寫清單 |
| `DBInstanceStatus` | 非 `available`（例如 `storage_full`）時自動備份不會進行。**已查證** [Introduction to backups](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_WorkingWithAutomatedBackups.html) |
| `StorageEncrypted`／`KmsKeyId` | 還原到其他帳號或 Region 時需 KMS 權限 |

`aws rds describe-db-instance-automated-backups --db-instance-identifier <id>`（[DBInstanceAutomatedBackup](https://docs.aws.amazon.com/AmazonRDS/latest/APIReference/API_DBInstanceAutomatedBackup.html)、[CLI](https://docs.aws.amazon.com/cli/latest/reference/rds/describe-db-instance-automated-backups.html)，**已查證**）：

- `RestoreWindow.EarliestTime`／`RestoreWindow.LatestTime`：PITR 可用區間，是回答「保留期實際涵蓋多遠」的最直接欄位。
- `Status`：`active`（現存實例）、`retained`（已刪除實例保留的備份）、`creating`（等第一份自動快照）。
- `BackupRetentionPeriod`、`Encrypted`、`KmsKeyId`、`EngineVersion`。
- 支援 `--filters Name=status,Values=active,retained`；`describe-db-instance-automated-backups` 也能列出已刪除實例保留的備份（`retained`）。

### 3.2 快照清單

`aws rds describe-db-snapshots --db-instance-identifier <id> --snapshot-type automated|manual|awsbackup`（[CLI](https://docs.aws.amazon.com/cli/latest/reference/rds/describe-db-snapshots.html)、[DBSnapshot](https://docs.aws.amazon.com/AmazonRDS/latest/APIReference/API_DBSnapshot.html)，**已查證**）：

| 欄位 | 用途 |
|---|---|
| `SnapshotCreateTime` | 快照時間（複製後會變） |
| `OriginalSnapshotCreateTime` | 原始建立時間（複製後不變），算「最後備份距今」用這個 |
| `SnapshotDatabaseTime` | 快照內最後一筆已套用交易的時間；對 read replica 的快照可算出 replica lag |
| `SnapshotType` | `automated`、`manual`、`awsbackup`（以及 `shared`／`public`） |
| `Status`、`PercentProgress` | 是否已 `available` |
| `Encrypted`、`KmsKeyId`、`EngineVersion`、`AllocatedStorage`、`FullSnapshotSizeInBytes` | 還原前置條件與規模 |

手動快照每 Region 上限 100，自動備份不受此限。**已查證** [Backup retention](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_WorkingWithAutomatedBackups.BackupRetention.html)

### 3.3 事件

`aws rds describe-events --source-identifier <id> --source-type db-instance --duration <minutes>`（最長回溯期間**未查證**），以及 `--source-type db-snapshot`。相關事件（**已查證** [USER_Events.Messages](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_Events.Messages.html)）：

| 類別 | 事件 | 訊息 |
|---|---|---|
| backup | RDS-EVENT-0001／0002 | Backing up DB instance.／Finished DB instance backup. |
| configuration change | RDS-EVENT-0028／0032 | Disabled／Enabled automated backups. |
| failure | RDS-EVENT-0031 | DB instance put into {name} state. RDS recommends that you initiate a point-in-time-restore. |
| low storage | RDS-EVENT-0007／0089 | 儲存空間耗盡／偏低（會讓自動備份停止） |
| restoration | RDS-EVENT-0019 | Restored from DB instance {name} to {name}.（PITR 完成） |
| creation | RDS-EVENT-0005 | DB instance created. |
| snapshot | RDS-EVENT-0090／0091 | Creating／Automated snapshot created. |
| snapshot | RDS-EVENT-0040／0042 | Creating／Manual snapshot created. |
| snapshot | RDS-EVENT-0043 | Restored from snapshot {name}. |
| snapshot | RDS-EVENT-0059／0060、0196／0197 | 跨 Region／同 Region 快照複製開始／完成 |

### 3.4 CloudWatch 指標

`aws cloudwatch get-metric-data`／`get-metric-statistics`，namespace `AWS/RDS`，維度 `DBInstanceIdentifier`（**已查證** [rds-metrics](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/rds-metrics.html)；維度名稱為**未查證**的常識）：

| 指標 | 引擎 | 單位 | 與備份的關係 |
|---|---|---|---|
| `BinLogDiskUsage` | MySQL、MariaDB | Bytes | 自動備份開啟時才會產生 binlog |
| `TransactionLogsDiskUsage` | PostgreSQL | Bytes | 本機交易日誌佔用；持續成長可能是歸檔或 slot 卡住（推論） |
| `TransactionLogsGeneration` | PostgreSQL | Bytes/s | WAL 產生速率，估 PITR 重播量（推論） |
| `OldestReplicationSlotLag`、`ReplicationSlotDiskUsage` | PostgreSQL | Bytes | slot 卡住讓 WAL 無法回收 |
| `FreeStorageSpace` | 全部 | Bytes | `storage_full` 時自動備份停止 |
| `ReplicaLag` | 全部 | Seconds | read replica 落後 |

本次讀到的 `AWS/RDS` 實例層級清單**沒有**備份儲存量指標（例如 `BackupRetentionPeriodStorageUsed`、`SnapshotStorageUsed`、`TotalBackupStorageBilled`）；這些名稱過去出現在 Aurora 文件，不適用本範圍（**未查證**）。

若使用 AWS Backup，namespace `AWS/Backup` 每 5 分鐘更新：`NumberOfBackupJobsCompleted`／`Failed`／`Expired`、`NumberOfRestoreJobsCompleted`／`Failed`、`NumberOfRecoveryPointsCompleted`／`Partial`／`Expired` 等，維度含 resource type 與 vault name。**已查證** [AWS Backup CloudWatch](https://docs.aws.amazon.com/aws-backup/latest/devguide/cloudwatch.html)

### 3.5 AWS Backup（若有使用）

- 對 RDS 開啟 continuous backup 後，AWS Backup 接管 RDS 自動備份窗口，之後不能在 RDS 端修改 continuous backup 設定；最長 35 天；RDS 可還原到最近 5 分鐘內的活動；Multi-AZ DB cluster 不支援。**已查證** [point-in-time-recovery](https://docs.aws.amazon.com/aws-backup/latest/devguide/point-in-time-recovery.html)
- 唯讀呼叫：`aws backup list-recovery-points-by-resource --resource-arn <db-arn>`、`aws backup describe-recovery-point`（`Status`：`COMPLETED`／`AVAILABLE`／`PARTIAL`／`EXPIRED`／`STOPPED`／`CREATING`／`DELETING`；`CreationDate`、`CompletionDate`、`CalculatedLifecycle.DeleteAt`、`IsEncrypted`、`LastRestoreTime`）。**已查證** [DescribeRecoveryPoint](https://docs.aws.amazon.com/aws-backup/latest/devguide/API_DescribeRecoveryPoint.html)。`STOPPED` 對 RDS 的意義是 continuous backup 規則的保留期被改過，需注意。
- `aws backup list-backup-jobs --by-resource-arn <arn>`、`list-restore-jobs`、`list-restore-jobs-by-protected-resource`、`describe-restore-job`、`list-restore-testing-plans`、`get-restore-testing-plan`、`list-restore-testing-selections`（`list-*` 的參數名稱除最後三者外為**未查證**）。

## 四、還原／PITR 演練（人工核准後執行）

### 4.1 會變更資源的 API（只列給 runbook，Skill 不執行）

| 目的 | 呼叫 | 來源 |
|---|---|---|
| PITR 到新實例 | `aws rds restore-db-instance-to-point-in-time --source-db-instance-identifier <src> --target-db-instance-identifier <drill-id> --restore-time <ISO8601>`（或 `--use-latest-restorable-time`），建議加 `--db-subnet-group-name`、`--vpc-security-group-ids`、`--no-publicly-accessible`、`--db-parameter-group-name` 把演練實例放進隔離網段 | **已查證** [USER_PIT](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_PIT.html)（隔離相關旗標為**未查證**，需對照 CLI reference） |
| 從保留的自動備份還原（來源已刪除） | 同上，改用 `--source-dbi-resource-id` 或 `--source-db-instance-automated-backups-arn`（**未查證**） | |
| 從快照還原 | `aws rds restore-db-instance-from-db-snapshot --db-snapshot-identifier <snap> --db-instance-identifier <drill-id>` | **未查證**（本次未讀該頁） |
| 演練後刪除 | `aws rds delete-db-instance --db-instance-identifier <drill-id> --skip-final-snapshot` | **未查證** |
| 經 AWS Backup 還原 | `aws backup start-restore-job --recovery-point-arn ... --metadata '{"DBInstanceIdentifier":...,"Engine":...,"RestoreTime":...}' --iam-role-arn ... --resource-type RDS` | **已查證** [point-in-time-recovery](https://docs.aws.amazon.com/aws-backup/latest/devguide/point-in-time-recovery.html) |
| 排程化演練 | `aws backup create-restore-testing-plan` ＋ `create-restore-testing-selection`；驗證結果用 `put-restore-validation-result` | **已查證** [restore-testing](https://docs.aws.amazon.com/aws-backup/latest/devguide/restore-testing.html) |

注意（**已查證**）：還原出的實例預設套用預設 parameter／option group；儲存空間不能縮小，增加至少 10%；還原完成後磁碟仍在背景從 S3 載入區塊，`StorageOperationStatus=Initializing` 期間效能較低，完成後 `StorageOperationStatus` 與 `StorageOperationPercentProgress` 兩欄位消失。PITR 一律產生**新**實例，不改動來源。

AWS Backup restore testing（**已查證**）支援 RDS，到期後自動刪除還原資源（帶 `awsbackup-restore-test` 標籤），驗證保留窗口 1–168 小時，可透過 EventBridge「Restore Job State Change」`COMPLETED` 觸發驗證，再以 `PutRestoreValidationResult` 回寫 `ValidationStatus`（`SUCCESSFUL`／`FAILED`／`TIMED_OUT`／`VALIDATING`），設定後不可更改。這是最接近「人核准一次、之後自動演練、Skill 唯讀讀結果」的現成機制（推論）。

### 4.2 量測復原時間（唯讀）

- **RDS 原生**：起點取 `RestoreDBInstanceToPointInTime` 的呼叫時間（由執行者記錄，或 CloudTrail；CloudTrail 不在本研究的 API 範圍內），終點取 `describe-events` 中演練實例的 RDS-EVENT-0019（PITR）或 RDS-EVENT-0043（快照還原）事件時間，或 `describe-db-instances` 的 `DBInstanceStatus` 首次變成 `available` 的時間（輪詢）。另記錄 `StorageOperationStatus` 消失的時間，作為「效能完全恢復」的第二個時間點（推論）。
- **AWS Backup**：`describe-restore-job` 的 `CompletionDate − CreationDate`，另有 `ExpectedCompletionTimeMinutes` 可對照；AWS Backup Audit Manager 有「Restore time for resources meet target」控制項。**已查證**
- **RPO**：PITR 目標時間與 `RestoreWindow.LatestTime` 的距離；在還原實例上（PostgreSQL）`pg_last_xact_replay_timestamp()` 只在 recovery 期間有值，實例開放後會回 NULL（**已查證**：「When the server has been started normally without recovery, the function returns NULL」），因此 RDS 上要改用資料本身的時間欄位（推論）。

### 4.3 資料一致性驗證（唯讀，經 dbcli 對演練實例執行）

建議由 Skill 產生下列唯讀查詢，在來源（或來源的唯讀副本）與演練實例上各跑一次比對（以下皆**推論**的做法，所用 SQL 功能為各引擎標準功能）：

1. **結構**：`dbcli schema` 對比表、欄位、索引數。
2. **時間截點**：對有 `created_at`／`updated_at` 的關鍵表，`SELECT max(updated_at)` 應 ≤ PITR 目標時間，且接近目標時間。這是驗證「還原到對的時間點」最直接的方式。
3. **筆數**：以截點時間過濾後的 `count(*)`，在來源上用 `WHERE updated_at <= :target` 近似（只對 append-only 表準確）。
4. **內容摘要**：MySQL／MariaDB 用 `CHECKSUM TABLE t;`（屬於 dbcli 允許的類型與否需確認，**未查證**）；PostgreSQL 用 `SELECT md5(string_agg(t::text, ',' ORDER BY id)) FROM t WHERE id BETWEEN ...` 分段比對。
5. **引擎完整性**：PostgreSQL `amcheck` 擴充（RDS 是否提供、是否需 CREATE EXTENSION——後者屬寫入，需人工）**未查證**；MySQL `CHECK TABLE` 非純唯讀語意，列入 runbook 而非 Skill。
6. **引擎層狀態**：MySQL 比對 `@@gtid_executed`；PostgreSQL 在演練實例上確認 `pg_is_in_recovery()` 為 false（已開放）。

演練實例的連線設定應以獨立的 dbcli connection 名稱存在，並設為 `query-only`，避免誤連生產（推論）。

## 五、在 RDS 上不可用或受限的引擎層訊號（彙整）

| 訊號／工具 | 狀態 | 依據 |
|---|---|---|
| `pg_basebackup`、`pg_verifybackup` | 不可用（主帳號 NOREPLICATION、無主機存取） | 已查證＋推論 |
| `archive_command` 自訂 | 不可改，由 RDS 管理 | 未查證 |
| `pg_stat_archiver` | 可讀，但僅輔助；權威是 `LatestRestorableTime` | 推論 |
| `pg_ls_waldir`、`pg_ls_archive_statusdir` | 需 `pg_monitor`，`rds_superuser` 是否具備未確認 | 未查證 |
| `SHOW BINARY LOGS`（RDS MySQL／MariaDB） | 可能可讀，但本機 binlog 很快清除，不代表 PITR 範圍 | 已查證（清除行為）＋未查證（權限） |
| `binlog retention hours` | 只能用 `CALL mysql.rds_show_configuration`，dbcli query-only 擋 `CALL` | 已查證（`src/core/permission-guard.ts:365`） |
| `SHOW REPLICA STATUS`（MariaDB 10.5+） | 主帳號缺權限，改用 `mysql.rds_replica_status`（也是 CALL） | 已查證 |
| 非 InnoDB 表 | 可讀，但 RDS 不保證其備份還原 | 已查證 |
| 全量備份時間 | SQL 完全看不到 | 推論 |

## 六、對 #231 的建議（推論）

- Skill 的「備份健康」檢查以平台層為主：`BackupRetentionPeriod > 0`、`LatestRestorableTime` 距今 ≤ 某門檻（例如 15 分鐘）、`RestoreWindow` 涵蓋政策要求天數、最近一份自動快照 `OriginalSnapshotCreateTime` ≤ 26 小時、近期無 RDS-EVENT-0028／0031／0007。
- 引擎層在 RDS 只做兩件事：列出非 InnoDB 表（MySQL／MariaDB），以及 PostgreSQL 的 `pg_stat_archiver.failed_count` 與 slot 堆積。
- 自管環境則反過來，引擎層 `pg_stat_archiver`／binlog 設定是主要訊號，但連續性與可讀性仍需檔案系統工具與演練。
- 是否讓 dbcli 在 query-only 下放行少數 RDS 唯讀程序（`mysql.rds_show_configuration`、`mysql.rds_replica_status`）是邊界決策，應在 #231 的規劃中決定。
- 「可讀」只能靠演練證明。優先評估 AWS Backup restore testing（人核准建立計畫一次，之後由服務自動還原並清除，Skill 唯讀讀 `describe-restore-job`），其次是人工執行 `restore-db-instance-to-point-in-time` 的 runbook。

## 未查證事項

- RDS for PostgreSQL 上 `archive_command` 的實際值與是否可改；`pg_stat_archiver` 在 RDS 上的行為。
- `rds_superuser` 是否含 `pg_monitor`；RDS MySQL 主帳號是否有 `REPLICATION CLIENT`；RDS MariaDB 主帳號是否有 `BINLOG MONITOR`；對 `mysql.rds_configuration` 的 SELECT 權限。
- MariaDB binlog 保留變數與 GTID 變數名稱；MySQL `SHOW MASTER STATUS` 與 `SHOW BINARY LOG STATUS` 的版本對照。
- `restore-db-instance-from-db-snapshot`、`delete-db-instance` 及隔離網段旗標的完整 CLI 參數；`describe-events` 最長回溯期間；AWS Backup `list-*` 呼叫的參數名稱。
- RDS 是否提供 `amcheck`；dbcli 是否把 `CHECKSUM TABLE` 歸為唯讀。
- CloudWatch `AWS/RDS` 維度名稱 `DBInstanceIdentifier`（常識，本次未讀到）。
