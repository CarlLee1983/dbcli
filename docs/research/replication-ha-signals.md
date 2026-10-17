# Replication／HA 的唯讀訊號與 failover 前置條件

回應 [#238](https://github.com/CarlLee1983/dbcli/issues/238)（上層 map：[#231](https://github.com/CarlLee1983/dbcli/issues/231)；部署形態：[#232](https://github.com/CarlLee1983/dbcli/issues/232)）。查閱日期：2026-10-17。

本文只整理一手來源（PostgreSQL 18、MySQL 8.4、MariaDB 官方文件、AWS RDS User Guide／API Reference／CLI Reference）。每條敘述附來源；標記 **〔推論〕** 者是由來源組合推得、來源本身沒有直接寫出；標記 **〔未核實〕** 者是來源不一致或找不到一手依據。本研究沒有對任何資料庫或 AWS 帳號執行指令。

## 結論摘要

- **引擎層可以靠純 SQL 判斷身分、拓樸與 lag**：PostgreSQL 用 `pg_is_in_recovery()`、`pg_stat_replication`、`pg_stat_wal_receiver`、`pg_replication_slots`；MySQL 8.4 用 `SHOW REPLICA STATUS`、`SHOW BINARY LOG STATUS`、`performance_schema.replication_*` 與 `GTID_SUBSET`／`GTID_SUBTRACT`；MariaDB 用 `SHOW [ALL] REPLICA STATUS` 與 `gtid_*` 變數。所需權限都是唯讀監控類（`pg_monitor`／`pg_read_all_stats`、`REPLICATION CLIENT`、`REPLICA MONITOR`）。
- **RDS 的 Multi-AZ DB instance（單一 standby）在 SQL 層看不到 standby**：它不可讀，AWS 只透過 `describe-db-instances` 的 `MultiAZ`／`SecondaryAvailabilityZone` 揭露。所以「這台有沒有 HA」只能由平台層回答。
- **WAL／binlog 保留是最主要的儲存風險**：PG 端看 `pg_replication_slots.wal_status`／`safe_wal_size` 與 CloudWatch `OldestReplicationSlotLag`、`TransactionLogsDiskUsage`、`ReplicationSlotDiskUsage`；MySQL／MariaDB 端看 `binlog retention hours`（`CALL mysql.rds_show_configuration`）與 `BinLogDiskUsage`。
- **lag 數字有已知盲點**：MySQL `Seconds_Behind_Source` 在慢網路或閒置時可能是 0；RDS PG 的 `ReplicaLag` 在沒有寫入時最多會虛報 5 分鐘；`ReplicaLag = -1` 代表 replication 未運作。Skill 不應只依單一數字判斷健康。
- **failover／promotion 一律交人執行**：RDS 上的變更動作是 `reboot-db-instance --force-failover`、`failover-db-cluster`、`promote-read-replica`（不可逆），以及 `mysql.rds_*` 預存程序。PostgreSQL 官方明說需要 STONITH 類機制避免雙主；MySQL 官方 failover 流程要求先確認 relay log 已全部套用。

## 1. 部署形態與可觀察面

| 形態 | 引擎 | Replication 機制 | 讀取 standby？ | SQL 層看得到對方？ | 來源 |
| --- | --- | --- | --- | --- | --- |
| Multi-AZ DB instance | PG／MySQL／MariaDB | 同步複製到單一 standby（AWS「Amazon failover technology」） | 否 | 否〔推論：standby 不接受連線，且 AWS 未說明它以引擎原生 replication 實作〕 | [Multi-AZ DB instance](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Concepts.MultiAZSingleStandby.html) |
| Multi-AZ DB cluster | PG、MySQL（**不支援 MariaDB**） | 一個 writer + 兩個可讀 reader，引擎原生 semisynchronous replication | 是 | 是〔推論：使用引擎原生 replication，writer 的 `pg_stat_replication`／reader 的 `SHOW REPLICA STATUS` 理應可見；未實測〕 | [Multi-AZ DB cluster](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/multi-az-db-clusters-concepts.html)、[支援引擎](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Concepts.RDS_Fea_Regions_DB-eng.Feature.MultiAZDBClusters.html) |
| Read replica | PG／MySQL／MariaDB | 引擎原生**非同步** replication | 是（唯讀） | 是 | [Read replicas](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_ReadRepl.html) |
| 自建（self-hosted） | 三者 | 引擎原生 | 視設定 | 是 | 各引擎文件 |

補充事實：

- Multi-AZ DB cluster 的 semisynchronous 只要求至少一個 reader 確認，不保證所有 reader 都已套用。[來源](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/multi-az-db-clusters-concepts.html)
- RDS 不支援 circular replication。MySQL／MariaDB 與部分 PG 版本可以從 replica 再建 replica；PG 的 cascading replica 需 14.1 以上。[Read replicas](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_ReadRepl.html)、[RDS PG read replicas](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_PostgreSQL.Replication.ReadReplicas.html)
- 同一個 DB instance 可以同時是 Multi-AZ（同步 standby）並帶 read replica（非同步）。[Read replicas](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_ReadRepl.html)

## 2. 引擎層：PostgreSQL（文件版本 18.6）

### 2.1 身分與拓樸

```sql
-- 身分：true = standby（recovery 中），false = primary
SELECT pg_is_in_recovery();

-- 在 primary 上：每個直接連線的 standby 一列（不含下游 cascading standby）
SELECT pid, usename, application_name, client_addr, state,
       sent_lsn, write_lsn, flush_lsn, replay_lsn,
       write_lag, flush_lag, replay_lag, sync_state, reply_time
FROM pg_stat_replication;

-- 在 standby 上：恰好一列，顯示上游
SELECT status, receive_start_lsn, written_lsn, flushed_lsn,
       latest_end_lsn, latest_end_time, slot_name, sender_host, sender_port
FROM pg_stat_wal_receiver;
```

- `state` 可能是 `startup`／`catchup`／`streaming`／`backup`／`stopping`；`sync_state` 可能是 `async`／`potential`／`sync`／`quorum`。[Monitoring stats](https://www.postgresql.org/docs/current/monitoring-stats.html)
- 系統閒置且已追上時，`*_lag` 欄位會在短時間後回到 NULL，不能把 NULL 當成「故障」。[同上](https://www.postgresql.org/docs/current/monitoring-stats.html)
- `pg_stat_wal_receiver.conninfo` 已將敏感欄位遮蔽，但仍建議 Skill 不輸出該欄位〔推論：遮蔽範圍以官方說法為準，未逐項核對〕。

### 2.2 Lag

```sql
-- primary：以位元組計的 replay 落後
SELECT application_name,
       pg_wal_lsn_diff(pg_current_wal_lsn(), replay_lsn) AS replay_lag_bytes,
       replay_lag
FROM pg_stat_replication;

-- standby：時間落後（RDS 的 ReplicaLag 正是用這個式子）
SELECT extract(epoch FROM now() - pg_last_xact_replay_timestamp()) AS reader_lag_seconds,
       pg_last_wal_receive_lsn(), pg_last_wal_replay_lsn(),
       pg_get_wal_replay_pause_state();
```

- `pg_current_wal_lsn()` 不能在 recovery 中執行；`pg_get_wal_replay_pause_state()`、`pg_is_wal_replay_paused()` 只能在 recovery 中執行。[Admin functions](https://www.postgresql.org/docs/current/functions-admin.html)
- `pg_last_xact_replay_timestamp()` 以「最後一筆 replay 的交易時間」計算，primary 沒有寫入時數字會持續變大。RDS 明載：無寫入時 PG replica 會回報最多約 5 分鐘的 lag，直到 WAL segment 切換（RDS 預設每 5 分鐘）。[RDS PG read replicas](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_PostgreSQL.Replication.ReadReplicas.html)、[Monitoring read replication](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_ReadRepl.Monitoring.html)

### 2.3 Replication slot 與 WAL 保留風險

```sql
SELECT slot_name, slot_type, database, active, active_pid,
       wal_status, safe_wal_size, restart_lsn, confirmed_flush_lsn,
       pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn) AS retained_bytes,
       inactive_since, conflicting, invalidation_reason, failover, synced
FROM pg_replication_slots;
```

- `wal_status`：`reserved`（在 `max_wal_size` 內）、`extended`（超過 `max_wal_size`，但由 slot 或 `wal_keep_size` 保留）、`unreserved`（下個 checkpoint 會移除部分所需 WAL）、`lost`（slot 已無法使用）。[pg_replication_slots](https://www.postgresql.org/docs/current/view-pg-replication-slots.html)
- `safe_wal_size`：slot 變成 `lost` 前還能寫多少 WAL；`max_slot_wal_keep_size = -1`（不設上限）時為 NULL。換言之，NULL 加上 `active = false` 代表 WAL 可能無限累積。[同上](https://www.postgresql.org/docs/current/view-pg-replication-slots.html)
- `invalidation_reason`：`wal_removed`、`rows_removed`、`wal_level_insufficient`、`idle_timeout`。[同上](https://www.postgresql.org/docs/current/view-pg-replication-slots.html)
- `inactive_since`、`invalidation_reason`、`failover`、`synced` 等欄位屬較新版本；該頁沒有標註各欄位加入的版本，Skill 實作時需依 `server_version_num` 降級查詢〔未核實：各欄位起始版本〕。
- RDS 明載：建立 logical slot 卻沒有讀取，會快速填滿儲存空間。[RDS PG logical replication](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/PostgreSQL.Concepts.General.FeatureSupport.LogicalReplication.html)
- RDS 對 cross-Region read replica 會建立 physical replication slot；落後嚴重時 `TransactionLogsDiskUsage` 會大幅增加。[Monitoring read replication](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_ReadRepl.Monitoring.html)

### 2.4 權限與 RDS 差異

| 需求 | 自建 PG | RDS for PostgreSQL | 來源 |
| --- | --- | --- | --- |
| 讀完整 `pg_stat_replication`／`pg_stat_wal_receiver` 列 | superuser 或 `pg_read_all_stats`（`pg_monitor` 含此角色）；一般使用者看他人 session 時多數欄位為 NULL | master user 明列有 `SELECT PG_STAT_REPLICATION`；把 `pg_monitor` 授予監控帳號〔推論：PG 內建角色，`rds_superuser` 有 CREATEROLE；AWS 未明寫〕 | [Monitoring stats](https://www.postgresql.org/docs/current/monitoring-stats.html)、[Predefined roles](https://www.postgresql.org/docs/current/predefined-roles.html)、[RDS master user](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/UsingWithRDS.MasterAccounts.html) |
| `pg_is_in_recovery()`、`pg_last_*`、`pg_wal_lsn_diff` | 文件未列特殊權限 | 同左 | [Admin functions](https://www.postgresql.org/docs/current/functions-admin.html) |
| 讀 `pg_replication_slots` | 一般 view〔推論：文件未列限制〕 | 同左 | — |
| 建立／刪除 slot（變更） | superuser 或有 `REPLICATION` 屬性的角色 | 需 `rds_replication` 角色（由 `rds_superuser` 授予） | [Admin functions](https://www.postgresql.org/docs/current/functions-admin.html)、[RDS logical replication](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/PostgreSQL.Concepts.General.FeatureSupport.LogicalReplication.html) |
| `pg_promote()`（變更） | 預設僅 superuser，可 `GRANT EXECUTE` | `rds_superuser` 並非 superuser（`NOSUPERUSER NOREPLICATION`），**RDS 上應以 `promote-read-replica` API 取代**〔推論：AWS 未明文禁止 `pg_promote()`，但 master user 不具 superuser〕 | [Admin functions](https://www.postgresql.org/docs/current/functions-admin.html)、[rds_superuser](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Appendix.PostgreSQL.CommonDBATasks.Roles.rds_superuser.html) |

RDS 的 master user 定義為 `CREATE ROLE postgres WITH LOGIN NOSUPERUSER INHERIT CREATEDB CREATEROLE NOREPLICATION`，並繼承 `rds_superuser`；`rdstopmgr` 是 RDS 內部支援 Multi-AZ 的角色，不可修改。[rds_superuser](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Appendix.PostgreSQL.CommonDBATasks.Roles.rds_superuser.html)

## 3. 引擎層：MySQL（文件版本 8.4）

### 3.1 身分與拓樸

```sql
-- 在 replica 上
SHOW REPLICA STATUS;                 -- 需要 REPLICATION CLIENT（或已棄用的 SUPER）

-- 在 source 上
SHOW BINARY LOG STATUS;              -- 取代 SHOW MASTER STATUS（8.4 已不支援後者）；需要 REPLICATION CLIENT
SHOW REPLICAS;                       -- 需要 REPLICATION SLAVE；只顯示曾連線過的 replica，可能含過時列
SELECT @@global.read_only, @@global.super_read_only, @@global.server_uuid, @@global.gtid_mode;
```

- 主要欄位：`Replica_IO_Running`（`Yes`／`Connecting`／`No`）、`Replica_SQL_Running`、`Last_IO_Errno`／`Last_IO_Error`、`Last_SQL_Errno`／`Last_SQL_Error`、`Retrieved_Gtid_Set`、`Executed_Gtid_Set`、`Auto_Position`、`Source_Host`、`Source_Server_Id`、`Source_UUID`。[SHOW REPLICA STATUS](https://dev.mysql.com/doc/refman/8.4/en/show-replica-status.html)
- `SHOW REPLICA STATUS` 不會阻塞，可能反映不到最新狀態；而且 `Last_SQL_Errno` 可能非零、但 `Replica_SQL_Running` 仍短暫顯示 `Yes`。[同上](https://dev.mysql.com/doc/refman/8.4/en/show-replica-status.html)
- `SHOW REPLICAS` 的 `Host`／`Port` 來自 replica 的 `--report-host`／`--report-port`，`Port = 0` 代表未回報。[SHOW REPLICAS](https://dev.mysql.com/doc/refman/8.4/en/show-replicas.html)
- `SHOW MASTER STATUS` 在 8.4 手冊列為「no longer supported」。[SHOW BINARY LOG STATUS](https://dev.mysql.com/doc/refman/8.4/en/show-binary-log-status.html)。RDS for MySQL 8.0 仍會遇到舊語法，Skill 需依版本選語法。

### 3.2 Lag

- `Seconds_Behind_Source`：applier 未執行時為 NULL；relay log 已讀完時為 0；手冊說它「useful only for fast networks」，慢網路下可能顯示 0 而 receiver 其實落後很多；NTP 調整也會影響。[SHOW REPLICA STATUS](https://dev.mysql.com/doc/refman/8.4/en/show-replica-status.html)
- 較可靠的做法是 `performance_schema` 時間戳（需啟用 Performance Schema 才會收集時間）：

```sql
SELECT c.CHANNEL_NAME, c.SERVICE_STATE AS io_state,
       c.LAST_ERROR_NUMBER AS io_errno,
       c.LAST_QUEUED_TRANSACTION_ORIGINAL_COMMIT_TIMESTAMP
FROM performance_schema.replication_connection_status c;

SELECT w.CHANNEL_NAME, w.WORKER_ID, w.SERVICE_STATE,
       w.LAST_ERROR_NUMBER, w.LAST_ERROR_MESSAGE,
       w.LAST_APPLIED_TRANSACTION_ORIGINAL_COMMIT_TIMESTAMP,
       w.LAST_APPLIED_TRANSACTION_END_APPLY_TIMESTAMP
FROM performance_schema.replication_applier_status_by_worker w;
```

[Performance Schema replication tables](https://dev.mysql.com/doc/refman/8.4/en/performance-schema-replication-tables.html)。`SERVICE_STATE` 為 `ON`／`CONNECTING`／`OFF`。比較 source 端 commit 時間與本地 `NOW()` 時須考慮時鐘差。`LAST_APPLIED_TRANSACTION_ORIGINAL_COMMIT_TIMESTAMP` 欄位名稱來自各表專頁，本次只核對了總覽頁〔未核實：完整欄位清單〕。

### 3.3 GTID／binlog 健康與 errant transaction

```sql
SELECT @@global.gtid_executed, @@global.gtid_purged;
-- 在候選 replica 上，貼上 source 的 gtid_executed：
SELECT GTID_SUBSET('<source gtid_executed>', @@global.gtid_executed) AS has_all_source_trx;
SELECT GTID_SUBTRACT(@@global.gtid_executed, '<source gtid_executed>') AS errant_gtids;
```

- `GTID_SUBSET`／`GTID_SUBTRACT` 的語意來自 [GTID functions](https://dev.mysql.com/doc/refman/8.4/en/gtid-functions.html)；用它們偵測 errant transaction 是由語意推得的常見作法，手冊本身沒有給這個範例〔推論〕。
- `WAIT_FOR_EXECUTED_GTID_SET` 會阻塞等待，不適合放進唯讀 Skill 的自動流程。[同上](https://dev.mysql.com/doc/refman/8.4/en/gtid-functions.html)

### 3.4 RDS for MySQL 差異

- master user 有 `REPLICATION CLIENT`、`REPLICATION SLAVE`、`PROCESS`，沒有 `SUPER`；8.0.36 起另有 `rds_superuser_role`。[RDS master user](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/UsingWithRDS.MasterAccounts.html)
- replication 控制改由 `mysql.rds_*` 預存程序執行，且文件寫明「The master user must run」這些程序：`rds_stop_replication`、`rds_start_replication`、`rds_start_replication_until`、`rds_skip_repl_error`、`rds_set_external_source*`（8.4）／`rds_set_external_master*`（8.0 以下）、`rds_reset_external_source`、`rds_set_source_auto_position`、`rds_next_source_log`、`rds_set_source_delay` 等。**全部屬於變更動作**。[Replicating procedures](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/mysql-stored-proc-replicating.html)
- binlog 保留：`CALL mysql.rds_show_configuration;`（唯讀）。`binlog retention hours` 預設 NULL，對 RDS for MySQL 代表不保留；最大 168 小時。Multi-AZ DB cluster 只能在 writer 設定，非同步傳到 reader。[Configuring procedures](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/mysql-stored-proc-configuring.html)
- binlog 是否開啟由自動備份決定：backup retention 設為 0 會關閉 binlog。[Binary logging](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_LogAccess.MySQL.BinaryFormat.html)
- RDS for MySQL Multi-AZ DB cluster 預設開啟 flow control（`rpl_semi_sync_master_target_apply_lag`，預設 120 秒）；可用 `SHOW GLOBAL STATUS LIKE '%flow_control%'` 讀取目前注入的延遲（微秒）。強烈建議所有表都有 primary key。[Multi-AZ DB cluster](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/multi-az-db-clusters-concepts.html)

## 4. 引擎層：MariaDB

### 4.1 身分、拓樸與 lag

```sql
SHOW REPLICA STATUS;          -- 舊版用 SHOW SLAVE STATUS
SHOW ALL REPLICAS STATUS;     -- 多來源；額外有 Gtid_Slave_Pos、Retried_transactions 等
SHOW BINLOG STATUS;           -- 舊名 SHOW MASTER STATUS
SELECT @@global.gtid_current_pos, @@global.gtid_slave_pos,
       @@global.gtid_binlog_pos, @@global.gtid_strict_mode, @@global.read_only;
```

- 欄位沿用 `Slave_*`／`Master_*` 命名：`Slave_IO_Running`、`Slave_SQL_Running`、`Seconds_Behind_Master`、`Using_Gtid`（`No`／`Slave_Pos`／`Current_Pos`）、`Gtid_IO_Pos`、`Parallel_Mode`、`Master_Server_Id`。[SHOW REPLICA STATUS](https://mariadb.com/docs/server/reference/sql-statements/administrative-sql-statements/show/show-replica-status)
- `Seconds_Behind_Master` 的盲點：沒在處理 event 時為 0；serial replica 可能倒退；parallel replica 只在 commit 後更新；含 `MASTER_DELAY`；重啟後在執行第一筆交易前顯示 0（MDEV-17516）。[同上](https://mariadb.com/docs/server/reference/sql-statements/administrative-sql-statements/show/show-replica-status)
- RDS 的 `ReplicaLag` 對 MySQL／MariaDB 就是 `Seconds_Behind_Master`，因此繼承上述盲點；`-1` 等同 NULL（replication 未運作）。[Monitoring read replication](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_ReadRepl.Monitoring.html)

### 4.2 GTID

- 格式 `domain-server_id-sequence`；**與 MySQL GTID 不相容**（MariaDB replica 可跟 MySQL primary，反之不行）。`MASTER_USE_GTID=slave_pos` 為建議值；`current_pos` 可能因本地寫入 binlog 而選錯起點。[MariaDB GTID](https://mariadb.com/docs/server/ha-and-performance/standard-replication/gtid)
- 因此 errant transaction 檢查需比對各 domain 的 `gtid_binlog_pos`／`gtid_slave_pos`，不能沿用 MySQL 的 `GTID_SUBSET`。MariaDB 官方 GTID 頁沒有給出升格前的 errant transaction 檢查程序〔未核實：缺一手程序〕。

### 4.3 權限

| 權限 | 允許的唯讀敘述 | 來源 |
| --- | --- | --- |
| `BINLOG MONITOR`（舊名 `REPLICATION CLIENT`，10.5.2 改名） | `SHOW BINLOG STATUS`、`SHOW BINARY LOGS` | [GRANT](https://mariadb.com/docs/server/reference/sql-statements/account-management-sql-statements/grant)、[10.5.2 release notes](https://mariadb.com/docs/release-notes/community-server/old-releases/mariadb-10-5-series/mariadb-1052-release-notes) |
| `REPLICA MONITOR` | `SHOW REPLICA STATUS`、`SHOW RELAYLOG EVENTS` | 同上 |
| `REPLICATION MASTER ADMIN` | `SHOW REPLICA HOSTS`（但也含變更系統變數的能力） | 同上 |

- 自 10.5 起 `BINLOG MONITOR` 不再能執行 `SHOW REPLICA STATUS`（MDEV-23899）。升級時具 `REPLICATION CLIENT` 或 `REPLICATION SLAVE` 的帳號會自動得到 `REPLICA MONITOR`。[MDEV-23899](https://jira.mariadb.org/browse/MDEV-23899)、[GRANT](https://mariadb.com/docs/server/reference/sql-statements/account-management-sql-statements/grant)
- RDS for MariaDB master user 有 `REPLICATION CLIENT`、`REPLICATION SLAVE`、`PROCESS`，沒有 `SUPER`。[RDS master user](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/UsingWithRDS.MasterAccounts.html)。是否同時具 `REPLICA MONITOR` 未見 AWS 明文〔未核實〕。
- RDS for MariaDB 使用 `mysql.rds_*_master` 系列預存程序（`rds_set_external_master`、`rds_next_master_log` 等）。[Replicating procedures](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/mysql-stored-proc-replicating.html)
- **RDS for MariaDB 沒有 Multi-AZ DB cluster**，HA 只能是 Multi-AZ DB instance 或 read replica。[支援引擎](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Concepts.RDS_Fea_Regions_DB-eng.Feature.MultiAZDBClusters.html)

## 5. 平台層：AWS RDS 唯讀 API

### 5.1 拓樸與身分

| 問題 | 唯讀呼叫 | 欄位 | 來源 |
| --- | --- | --- | --- |
| 有沒有同步 standby、在哪個 AZ | `aws rds describe-db-instances` | `MultiAZ`、`AvailabilityZone`、`SecondaryAvailabilityZone` | [DBInstance](https://docs.aws.amazon.com/AmazonRDS/latest/APIReference/API_DBInstance.html) |
| 誰是 replica、來源是誰 | 同上 | `ReadReplicaSourceDBInstanceIdentifier`、`ReadReplicaDBInstanceIdentifiers`、`ReadReplicaSourceDBClusterIdentifier` | 同上 |
| replica 狀態 | 同上 | `StatusInfos`（replica 才有；狀態值見下） | 同上、[Monitoring read replication](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_ReadRepl.Monitoring.html) |
| 是否屬於 Multi-AZ DB cluster | 同上 | `DBClusterIdentifier` | [DBInstance](https://docs.aws.amazon.com/AmazonRDS/latest/APIReference/API_DBInstance.html) |
| cluster 的 writer 是誰 | `aws rds describe-db-clusters` | `DBClusterMembers[].IsClusterWriter` | [DBClusterMember](https://docs.aws.amazon.com/AmazonRDS/latest/APIReference/API_DBClusterMember.html) |
| failover 前提：備份、待套用變更 | `describe-db-instances` | `BackupRetentionPeriod`、`LatestRestorableTime`、`PendingModifiedValues`、`DBInstanceStatus` | [DBInstance](https://docs.aws.amazon.com/AmazonRDS/latest/APIReference/API_DBInstance.html) |
| 過去是否發生 failover | `aws rds describe-events` | 事件 ID（見 5.3） | [Event messages](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_Events.Messages.html) |

`StatusInfos` 的 read replication 狀態：`replicating`、`replication degraded`（僅 PG／SQL Server）、`error`、`terminated`（MySQL／MariaDB／PG：停止超過 30 天後 RDS 終止 replication）、`stopped`（MySQL／MariaDB，客戶要求）、`replication stop point set`／`replication stop point reached`（MySQL）。[Monitoring read replication](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_ReadRepl.Monitoring.html)

### 5.2 CloudWatch 指標（namespace `AWS/RDS`）

以 `aws cloudwatch get-metric-data`／`get-metric-statistics` 讀取，維度用 `DBInstanceIdentifier`〔推論：維度名稱未在指標頁逐列寫出〕。

| 指標 | 引擎 | 單位 | 用途 |
| --- | --- | --- | --- |
| `ReplicaLag` | 三者 | 秒 | read replica 落後；Multi-AZ DB cluster 為 writer 最新交易與 reader 最新已套用交易的時間差；`-1` = 無法判定或 replication 未運作 |
| `OldestReplicationSlotLag` | PG | Bytes | 落後最多的 replica 以 WAL 計的落後量 |
| `OldestLogicalReplicationSlotLag` | PG | Bytes | logical slot 的落後 |
| `ReplicationSlotDiskUsage` | PG | Bytes | replication slot 檔案所占空間 |
| `TransactionLogsDiskUsage` | PG | Bytes | WAL 所占空間 |
| `TransactionLogsGeneration` | PG | Bytes/s | WAL 產生速率 |
| `BinLogDiskUsage` | MySQL／MariaDB | Bytes | binlog 所占空間（開啟自動備份才會產生 binlog） |
| `ReplicationChannelLag` | MySQL | 秒 | multi-source replica 個別 channel 的落後 |
| `FreeStorageSpace` | 全部 | Bytes | WAL／binlog 堆積的最終後果 |
| `MaximumUsedTransactionIDs` | PG | Count | 交易 ID wraparound 風險（slot 的 `xmin` 會阻擋 vacuum〔推論〕） |

來源：[RDS CloudWatch metrics](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/rds-metrics.html)。

### 5.3 RDS 事件（`describe-events`）

| 事件 ID | 類別 | 訊息 |
| --- | --- | --- |
| RDS-EVENT-0013 | failover | Multi-AZ instance failover started. |
| RDS-EVENT-0015 | failover | Multi-AZ failover to standby complete - DNS propagation may take a few minutes. |
| RDS-EVENT-0049 | failover | Multi-AZ instance failover completed. |
| RDS-EVENT-0034 | failover | Abandoning user requested failover since a failover recently occurred on the database instance. |
| RDS-EVENT-0065 | failover | Recovered from partial failover. |
| RDS-EVENT-0069～0073 | failover（DB cluster） | cluster failover 失敗／重新升格原 primary／完成／同 AZ 開始／跨 AZ 開始 |
| RDS-EVENT-0045 | read replica | Replication has stopped.（replication 錯誤） |
| RDS-EVENT-0057 | read replica | Replication streaming has been terminated. |
| RDS-EVENT-0062 | read replica | Replication for the Read Replica has been manually stopped. |
| RDS-EVENT-0089／0221／0222 | low storage／availability | 儲存空間偏低／到達門檻並關機 |

來源：[Event messages](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_Events.Messages.html)。

## 6. Failover／failback：前置條件、split-brain 與停止條件

### 6.1 RDS 會自己做的部分

- **Multi-AZ DB instance**：觸發條件包括 OS 修補、primary 主機不健康、網路不可達、客戶修改、primary 忙碌無回應、儲存故障、使用者要求的 reboot with failover；通常 60–120 秒；透過改 DNS 指向 standby，既有連線需重建，JVM DNS TTL 建議 ≤ 60 秒。[Multi-AZ failover](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Concepts.MultiAZ.Failover.html)
- **Multi-AZ DB cluster**：通常 35 秒內；failover 須先消化 replica lag。MySQL 要兩個 reader 都套用完畢；PG 取 lag 最小的 reader 套用完畢後升格。[Multi-AZ DB cluster](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/multi-az-db-clusters-concepts.html)、[cluster failover](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/multi-az-db-clusters-concepts-failover.html)
- 這兩種形態的 failback 不需另外處理：RDS 會自動重建 standby〔推論：AWS 未在上述頁面描述 failback 程序〕，所以 Skill 只需觀察事件與 `describe-*` 結果。

### 6.2 Read replica promotion（DR）

AWS 列出的前置條件：

1. 啟用備份並至少完成一次備份；replica 不能處於 `backing-up` 狀態。
2. 停止對 primary 的寫入，等 `ReplicaLag` 確認全部套用。
3. 了解非同步 replication 的資料遺失風險。

promotion 會停止 replication 並重啟 replica，之後成為獨立 instance，**不能再當 replication 目標**（不可逆）。RDS 沒有 Oracle 以外引擎的 switchover，所以「failback」等於從新 primary 重建 replica，再做一次 promotion。[Promote](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_ReadRepl.Promote.html)。PG 在 cascading 鏈中升格時，下游 replica 會自動改從升格後的 instance 收 WAL。[RDS PG read replicas](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_PostgreSQL.Replication.ReadReplicas.html)

### 6.3 Split-brain 與自建環境的公認原則

- **PostgreSQL**：old primary 重新啟動時，必須有機制告知它已不是 primary（STONITH），否則兩邊都認為自己是 primary，「ultimately data loss」。PostgreSQL 本身不提供故障偵測與通知，需外部工具；failover 後處於「degenerate state」，要重建 standby（`pg_rewind` 可加速）。若使用 logical slot 同步，切換前應確認 standby 上的 slot 已可 failover。[Failover](https://www.postgresql.org/docs/current/warm-standby-failover.html)
- **MySQL**：先在各 replica `STOP REPLICA IO_THREAD`，`SHOW PROCESSLIST` 等到狀態為「Has read all relay log」；replica 之間不同步，可能有的超前很多；新 source 執行 `STOP REPLICA; RESET BINARY LOGS AND GTIDS;`；old source 回來時要先 `RESET BINARY LOGS AND GTIDS`，否則 replica 可能拿到 stale writes。[Switching sources](https://dev.mysql.com/doc/refman/8.4/en/replication-solutions-switch.html)
- **RDS 的 split-brain 風險**：Multi-AZ 形態由 RDS 控制 DNS 與 standby，客戶無法讓兩邊同時可寫〔推論〕。真正的風險出現在 read replica promotion：promotion 後原 primary 仍可寫，應用若仍連舊 endpoint 就會分岔；而且已升格的 instance 無法再接回 replication，所以分岔後無法靠 replication 合併〔推論，依 promote 文件的「can't use as a replication target」〕。

### 6.4 建議的停止條件（給 Skill runbook 使用）

以下由上述來源組合而成，屬建議而非官方條文〔推論〕。任一成立時，Skill 只回報、不建議繼續：

- 候選 replica 的 `StatusInfos` 不是 `replicating`，或 `ReplicaLag` 為 `-1`。
- PG：候選 standby 的 `pg_get_wal_replay_pause_state()` 不是 `not paused`，或 `pg_last_wal_receive_lsn()` ≠ `pg_last_wal_replay_lsn()`（仍有未套用 WAL）。
- MySQL：`Replica_SQL_Running = No`、`Last_SQL_Errno ≠ 0`，或 `GTID_SUBTRACT(候選 gtid_executed, source gtid_executed)` 非空（errant transaction）。
- MariaDB：`Slave_SQL_Running = No`，或各 domain 的 GTID 位置不一致。
- 舊 primary 的寫入尚未確認停止（無法排除雙寫）。
- 候選端 `BackupRetentionPeriod = 0`，或 `DBInstanceStatus` 為 `backing-up`。
- 最近剛發生過 failover（RDS 會以 RDS-EVENT-0034 拒絕使用者要求的 failover）。

### 6.5 交人執行的變更動作清單（runbook 只列出，不執行）

| 動作 | 指令 | 來源 |
| --- | --- | --- |
| Multi-AZ DB instance 手動 failover | `aws rds reboot-db-instance --db-instance-identifier <id> --force-failover`（非 Multi-AZ 不能用） | [CLI reboot-db-instance](https://docs.aws.amazon.com/cli/latest/reference/rds/reboot-db-instance.html) |
| Multi-AZ DB cluster 手動 failover | `aws rds failover-db-cluster --db-cluster-identifier <id> [--target-db-instance-identifier <reader>]`（RDS for MySQL cluster 不支援 target） | [CLI failover-db-cluster](https://docs.aws.amazon.com/cli/latest/reference/rds/failover-db-cluster.html) |
| Read replica 升格（不可逆） | `aws rds promote-read-replica --db-instance-identifier <id>` | [Promote](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_ReadRepl.Promote.html) |
| 升格後轉 Multi-AZ | `aws rds modify-db-instance --multi-az` | 同上、[Multi-AZ DB instance](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Concepts.MultiAZSingleStandby.html) |
| RDS MySQL／MariaDB replication 控制 | `CALL mysql.rds_stop_replication;`、`mysql.rds_start_replication`、`mysql.rds_skip_repl_error`、`mysql.rds_start_replication_until[_gtid]`、`mysql.rds_set_configuration('binlog retention hours', N)` | [Replicating procedures](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/mysql-stored-proc-replicating.html)、[Configuring procedures](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/mysql-stored-proc-configuring.html) |
| 刪除不用的 PG slot | `SELECT pg_drop_replication_slot('<slot>');`（需 `rds_replication`／`REPLICATION`） | [RDS logical replication](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/PostgreSQL.Concepts.General.FeatureSupport.LogicalReplication.html) |
| 自建 PG 升格 | `pg_ctl promote` 或 `SELECT pg_promote();` | [Failover](https://www.postgresql.org/docs/current/warm-standby-failover.html) |
| 自建 MySQL 切換 source | `STOP REPLICA; RESET BINARY LOGS AND GTIDS;`、`CHANGE REPLICATION SOURCE TO ...` | [Switching sources](https://dev.mysql.com/doc/refman/8.4/en/replication-solutions-switch.html) |

## 7. 對 DBA Role Skill v1 的意涵

- **引擎層 workflow 所需最小權限**：PG `pg_monitor`；MySQL `REPLICATION CLIENT`（`SHOW REPLICAS` 另需 `REPLICATION SLAVE`，可省略）＋ `performance_schema` 的 `SELECT`〔推論〕；MariaDB `BINLOG MONITOR` ＋ `REPLICA MONITOR`。
- **引擎層無法回答的問題**一律標示「需平台層」：Multi-AZ DB instance 是否存在、standby 位置、failover 歷史、儲存剩餘量趨勢。
- **語法分版本**：MySQL 8.0 與 8.4（`SHOW MASTER STATUS` → `SHOW BINARY LOG STATUS`）、MariaDB 10.5 前後（`SLAVE` → `REPLICA` 與權限拆分）、PG 欄位依 `server_version_num` 降級。
- **lag 判讀需兩個以上訊號**：例如 PG 同時看 `pg_last_xact_replay_timestamp()` 與 receive／replay LSN 差；MySQL 同時看 `Seconds_Behind_Source` 與 `performance_schema` 時間戳及 IO thread 狀態。

## 未核實事項

- PG `pg_replication_slots` 各欄位（`inactive_since`、`invalidation_reason`、`failover`、`synced`）的起始版本：18 版文件頁未標註。
- MariaDB `REPLICA MONITOR` 的確切加入版本：官方 GRANT 頁寫「Split from SUPER in 11.0」，與 10.5.2 release notes 及 MDEV-23899 的時間線矛盾；MaxScale 文件寫 10.5.9，但屬第三方工具文件。
- RDS for MariaDB master user 是否具 `REPLICA MONITOR`；RDS for PostgreSQL 上 `rds_superuser` 是否可把 `pg_monitor` 授予其他角色（依 PG 規則推論可以，AWS 未明文）。
- Multi-AZ DB instance 的 standby 在 SQL 層完全不可見：由「standby 不可讀」與「Amazon failover technology」推論，未實測。
- Multi-AZ DB cluster 的 reader 是否出現在 writer 的 `pg_stat_replication`／是否可用 `SHOW REPLICAS` 看到：推論可以，未實測。
- MySQL `performance_schema` 個別欄位（如 `LAST_APPLIED_TRANSACTION_ORIGINAL_COMMIT_TIMESTAMP`）只核對到總覽頁，未逐表核對。
- CloudWatch 指標的維度名稱（`DBInstanceIdentifier`、`DBClusterIdentifier`）未在指標頁逐列寫出。
- 使用 GTID 函式偵測 errant transaction、以及 6.4 的停止條件，都是依官方語意組合的作法，不是官方條文。
