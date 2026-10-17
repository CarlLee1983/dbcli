# 線上 DDL 與變更治理的引擎差異（PostgreSQL vs MySQL／MariaDB）

研究題目來自 issue #235（map #231「DBA Role Skill v1」的子題）。本文只整理官方一手資料可證實的事實，供 DBA Role Skill 在 PostgreSQL 與 MySQL／MariaDB 上設計生產變更流程時引用；不做 dbcli 實作決策。查閱日期：2026-10-17。

標示方式：未加註的敘述皆有引用來源佐證；標「**推論**」者是由多個已引用事實推得、原文沒有直接寫出的結論；標「**未驗證**」者列在文末。

## 結論摘要

1. **交易邊界完全不同。** PostgreSQL 的大部分 DDL 可放進 transaction block 一起 `ROLLBACK`，例外是一組明列「不可在 transaction block 執行」的指令（`CREATE INDEX CONCURRENTLY` 等）。MySQL 與 MariaDB 的 DDL 一律在執行前 implicit commit；MySQL 8.0+ 與 MariaDB 10.6.1+ 的「atomic DDL」只保證單一陳述式全有或全無，官方明言它**不是** transactional DDL。
2. **兩邊的主要停機風險都是「排隊中的排他鎖」。** PostgreSQL 的 `ACCESS EXCLUSIVE` 等待者會擋住後來的衝突請求；MySQL 的 pending exclusive metadata lock 會擋住後續交易。兩者的預設等待上限都形同無限（PG `lock_timeout = 0`；MySQL `lock_wait_timeout = 31536000` 秒；MariaDB 為 86400 秒），所以變更流程必須自己設定鎖等待預算。
3. **「線上」能力的形狀不同。** PostgreSQL 靠 `CONCURRENTLY` 變體與 `NOT VALID` + `VALIDATE CONSTRAINT` 降低鎖等級；MySQL／MariaDB 靠 `ALGORITHM`（INSTANT／INPLACE／COPY，MariaDB 另有 NOCOPY）與 `LOCK` 子句，且 MySQL 在開始與結束仍需短暫的 exclusive metadata lock。MySQL 無法線上完成的變更（例如改欄位型別只支援 `ALGORITHM=COPY`）交給 gh-ost 或 pt-online-schema-change。
4. **沒有通用 rollback 的變更**：刪除資料的變更（DROP COLUMN／TABLE、型別縮窄）、PostgreSQL enum 新增值（沒有 DROP VALUE）、MySQL／MariaDB 已 implicit commit 的任何 DDL、`CONCURRENTLY` 中途失敗留下的 INVALID 索引需要人工清理。回復手段只能是預先設計的 forward fix 或備份還原。

## 1. DDL 能否放在交易內、implicit commit

### PostgreSQL

- 一般 `CREATE INDEX`、`REINDEX TABLE/INDEX`、`DROP INDEX` 可以在 transaction block 內執行；其 `CONCURRENTLY` 版本不行。[CREATE INDEX](https://www.postgresql.org/docs/18/sql-createindex.html)、[REINDEX](https://www.postgresql.org/docs/18/sql-reindex.html)、[DROP INDEX](https://www.postgresql.org/docs/18/sql-dropindex.html)
- 官方明列不可在 transaction block 執行的指令（PG 18 文件逐頁確認）：`CREATE DATABASE`、`DROP DATABASE`、`CREATE TABLESPACE`、`VACUUM`、`ALTER SYSTEM`（「acts directly on the file system and cannot be rolled back」）、不帶表名的 `CLUSTER` 與分割表的 `CLUSTER`、`REINDEX SYSTEM`、`CREATE/DROP INDEX CONCURRENTLY`、`REINDEX CONCURRENTLY`、`ALTER TABLE ... DETACH PARTITION ... CONCURRENTLY`。[CREATE DATABASE](https://www.postgresql.org/docs/18/sql-createdatabase.html)、[DROP DATABASE](https://www.postgresql.org/docs/18/sql-dropdatabase.html)、[CREATE TABLESPACE](https://www.postgresql.org/docs/18/sql-createtablespace.html)、[VACUUM](https://www.postgresql.org/docs/18/sql-vacuum.html)、[ALTER SYSTEM](https://www.postgresql.org/docs/18/sql-altersystem.html)、[CLUSTER](https://www.postgresql.org/docs/18/sql-cluster.html)、[ALTER TABLE](https://www.postgresql.org/docs/18/sql-altertable.html)
- `ALTER TYPE ... ADD VALUE`：PG 12 起可在 transaction block 內執行，但新值在交易 commit 前不可使用；PG 12 以前除非與建立該 enum 同一交易，否則不能在 transaction block 中執行。[ALTER TYPE](https://www.postgresql.org/docs/18/sql-altertype.html)、[PG 12 release notes](https://www.postgresql.org/docs/release/12.0/)
- **推論**：除上述例外，`ALTER TABLE`、`CREATE TABLE`、`DROP TABLE` 等可與資料變更放在同一交易並一起回滾。ALTER TABLE 文件只記載 `DETACH PARTITION CONCURRENTLY` 的 transaction block 限制。注意：在交易內做的 DDL 會持有鎖直到交易結束（見第 2 節），所以「可回滾」與「鎖持有時間短」互相拉扯。

### MySQL（8.4 文件）

- DDL（`ALTER TABLE`、`CREATE/DROP INDEX`、`CREATE/DROP TABLE`、`RENAME TABLE`、`TRUNCATE TABLE` 等）「implicitly end any transaction active in the current session, as if you had done a COMMIT before executing the statement」，且多數在執行後也再 commit 一次。[Statements That Cause an Implicit Commit](https://dev.mysql.com/doc/refman/8.4/en/implicit-commit.html)
- 例外：`CREATE/DROP TEMPORARY TABLE` 不觸發 implicit commit，但也無法回滾（文件原文「transactional atomicity to be violated」）；對暫存表的 `ALTER TABLE`、`CREATE INDEX` 仍會 commit。同頁。
- Atomic DDL：單一 DDL 的 data dictionary、storage engine 與 binlog 寫入合為一個原子操作，即使 server 中途停止也會整體回滾。但官方明言「Atomic DDL is not transactional DDL」，DDL 不能與其他陳述式放在同一交易。只有 InnoDB 支援；`DROP DATABASE` 刪除目錄的步驟在原子操作之外。[Atomic Data Definition Statement Support](https://dev.mysql.com/doc/refman/8.4/en/atomic-ddl.html)

### MariaDB

- 「All these statements cause an implicit commit before execution」，即使該陳述式失敗，原交易也已 commit；`CREATE/DROP TEMPORARY TABLE` 例外，但 `TRUNCATE` 暫存表仍會 commit。[SQL statements that cause an implicit commit](https://mariadb.com/docs/server/reference/sql-statements/transactions/sql-statements-that-cause-an-implicit-commit)
- Atomic DDL 自 MariaDB 10.6.1 起：多數 DDL 為 atomic，其餘為 crash-safe。[Atomic DDL](https://mariadb.com/docs/server/reference/sql-statements/data-definition/atomic-ddl)

## 2. 鎖模型與「排隊鎖」風險

### PostgreSQL

- `ALTER TABLE` 預設取得 `ACCESS EXCLUSIVE`，除非文件另有註明；多個子命令時取最嚴格者。較低鎖等級的子命令有：`VALIDATE CONSTRAINT`（`SHARE UPDATE EXCLUSIVE`）、`ADD FOREIGN KEY`（雙方表都取 `SHARE ROW EXCLUSIVE`）、`SET STATISTICS` 等（`SHARE UPDATE EXCLUSIVE`）、`ATTACH PARTITION`（父表 `SHARE UPDATE EXCLUSIVE`，被掛上的表與 default partition 為 `ACCESS EXCLUSIVE`）。[ALTER TABLE](https://www.postgresql.org/docs/18/sql-altertable.html)
- 一般 `CREATE INDEX` 取 `SHARE`（擋寫不擋讀）；`CREATE INDEX CONCURRENTLY`、`REINDEX CONCURRENTLY` 取 `SHARE UPDATE EXCLUSIVE`。`DROP TABLE`、`TRUNCATE`、`REINDEX`、`CLUSTER`、`VACUUM FULL` 取 `ACCESS EXCLUSIVE`。[Explicit Locking](https://www.postgresql.org/docs/18/explicit-locking.html)
- 鎖會等待「indefinitely」直到衝突鎖釋放（無 deadlock 時）。同頁。
- 排隊語意：lock manager 讓衝突請求「granted in order of arrival」，等待者只有在不與先前無法喚醒的等待者衝突時才會被喚醒。[src/backend/storage/lmgr/README](https://github.com/postgres/postgres/blob/master/src/backend/storage/lmgr/README)。**推論**：一個排隊中的 `ACCESS EXCLUSIVE`（例如被長交易卡住的 `ALTER TABLE`）會讓之後所有對該表的普通 `SELECT` 也排隊。這是設定 `lock_timeout` 的主要理由。
- 表重寫條件（PG 18）：`ADD COLUMN` 搭配非 volatile `DEFAULT` 不重寫（PG 11 起）；volatile default（例如 `clock_timestamp()`）、stored generated column、identity column、帶約束的 domain 型別會重寫整表與索引；virtual generated column 不重寫。改型別通常重寫，除非是 binary coercible 且 `USING` 不改內容。[ALTER TABLE](https://www.postgresql.org/docs/18/sql-altertable.html)、[PG 11 release notes](https://www.postgresql.org/docs/release/11.0/)
- `NOT VALID` + `VALIDATE CONSTRAINT`：先以 `NOT VALID` 加約束（不掃描舊資料），再以 `SHARE UPDATE EXCLUSIVE` 驗證。PG 17 只支援 FK 與 `CHECK`；PG 18 起也支援 `NOT NULL`（release notes：「Allow ALTER TABLE to set the NOT VALID attribute of NOT NULL constraints」）。PG 18 文件另記載 `SET NOT NULL` 在已有有效 `CHECK (col IS NOT NULL)` 時可跳過全表掃描。[PG 17 ALTER TABLE](https://www.postgresql.org/docs/17/sql-altertable.html)、[PG 18 ALTER TABLE](https://www.postgresql.org/docs/18/sql-altertable.html)、[PG 18 release notes](https://www.postgresql.org/docs/release/18.0/)
- 版本差異補充：PG 18 新增 `CHECK`／FK 的 `NOT ENFORCED`，並允許分割表上的 `NOT VALID` FK。[PG 18 release notes](https://www.postgresql.org/docs/release/18.0/)

### MySQL（InnoDB，8.4 文件）

- Online DDL 分三階段：初始化取 shared upgradeable metadata lock；執行階段視情況短暫升級為 exclusive；commit 階段一定升級為 exclusive 以替換表定義。「a pending exclusive metadata lock requested by an online DDL operation blocks subsequent transactions on the table」，長交易或閒置交易會讓 online DDL 等待逾時。被擋的 session 在 processlist 顯示 `Waiting for table metadata lock`，可從 `performance_schema.metadata_locks` 查依賴關係。[Online DDL Performance and Concurrency](https://dev.mysql.com/doc/refman/8.4/en/innodb-online-ddl-performance.html)
- Metadata lock 持有到交易結束（autocommit 下為陳述式結束）；寫鎖請求優先於讀鎖請求（`max_write_lock_count` 預設極大）。[Metadata Locking](https://dev.mysql.com/doc/refman/8.4/en/metadata-locking.html)

### MariaDB

- 任何 DDL 不論鎖策略，都在開始與結束時短暫取得 exclusive lock；「Any active transactions that may have accessed the table must be committed or aborted for the operation to continue.」[InnoDB Online DDL Overview](https://mariadb.com/docs/server/server-usage/storage-engines/innodb/innodb-online-ddl/innodb-online-ddl-overview)

## 3. MySQL／MariaDB 的 ALGORITHM 與 LOCK

### MySQL

- `ALGORITHM=INSTANT | INPLACE | COPY`；`LOCK=NONE`（允許查詢與 DML）、`SHARED`（允許查詢、擋 DML）、`EXCLUSIVE`（全擋）、`DEFAULT`。指定的鎖比該操作能支援的更寬鬆時，陳述式直接報錯，不會降級執行。[Online DDL Performance and Concurrency](https://dev.mysql.com/doc/refman/8.4/en/innodb-online-ddl-performance.html)。**推論**：明確寫出 `ALGORITHM=... , LOCK=...` 可以當成安全閘，不符合預期就失敗，而不是悄悄改成重建整表。
- 8.4 操作矩陣重點（[Online DDL Operations](https://dev.mysql.com/doc/refman/8.4/en/innodb-online-ddl-operations.html)）：

| 操作 | INSTANT | INPLACE | 重建表 | 允許並行 DML |
| --- | --- | --- | --- | --- |
| 加欄位 | 是 | 是 | 否 | 是 |
| 刪欄位 | 是 | 是 | 是 | 是 |
| 改欄位名 | 是 | 是 | 否 | 是 |
| 改欄位型別 | 否 | 否（只支援 COPY） | 是 | 否 |
| 擴充 VARCHAR | 否 | 是 | 否 | 是 |
| 改為 NOT NULL | 否 | 是 | 是 | 是 |
| ENUM/SET 尾端加成員 | 是 | 是 | 否 | 是 |
| 加次級索引 | 否 | 是 | 否 | 是 |
| 加 FULLTEXT／SPATIAL 索引 | 否 | 是 | 否 | 否 |
| 刪主鍵（不同時加回） | 否 | 否（只支援 COPY） | 是 | 否 |
| 加 FK | 否 | 只有 `foreign_key_checks=0` 時 | 否 | 是 |
| 轉換字元集 | 否 | 是 | 是（編碼不同時） | 否 |

- INSTANT 的版本演進（8.0 文件）：8.0.12 起加欄位預設 INSTANT，但 8.0.29 前只能加在最後一欄；8.0.28 起 rename column 支援 INSTANT；8.0.29 起可加在任意位置、刪欄位也預設 INSTANT。[8.0 Online DDL Operations](https://dev.mysql.com/doc/refman/8.0/en/innodb-online-ddl-operations.html)
- INSTANT 限制：每次 INSTANT 加／刪欄位產生一個 row version，上限 64（MySQL 9.1.0 起 255），達上限報 `ERROR 4092`，需 rebuild 歸零（`INFORMATION_SCHEMA.INNODB_TABLES.TOTAL_ROW_VERSIONS`）；`ROW_FORMAT=COMPRESSED`、有 FULLTEXT 索引的表、data dictionary tablespace 的表、暫存表不支援；內部欄位數上限 1022。[8.4 Online DDL Operations](https://dev.mysql.com/doc/refman/8.4/en/innodb-online-ddl-operations.html)
- 已知正確性缺陷：Bug #115608「Inplace ALTER TABLE might cause lost rows if concurrent purge」，影響 8.0、8.4、9.0，官方標註修正於 8.0.41、8.4.4、9.2.0。[MySQL Bug #115608](https://bugs.mysql.com/bug.php?id=115608)。相關的 Bug #115511（並行插入時 INPLACE ALTER 可能報 duplicate key）未查證修正版本。[MySQL Bug #115511](https://bugs.mysql.com/bug.php?id=115511)

### MariaDB

- `ALGORITHM` 值為 DEFAULT／COPY／INPLACE／NOCOPY／INSTANT，語意是「可接受的最低效率演算法」，效率由低到高為 COPY < INPLACE < NOCOPY < INSTANT；`alter_algorithm` session 變數等同此子句。`ALTER ONLINE TABLE` 等同 `LOCK=NONE`。[InnoDB Online DDL Overview](https://mariadb.com/docs/server/server-usage/storage-engines/innodb/innodb-online-ddl/innodb-online-ddl-overview)
- MariaDB 11.2 起，多數操作可用 `ALGORITHM=COPY, LOCK=NONE`（線上複製表）；10.8 起 `binlog_alter_two_phase` 讓 replica 與 primary 同時開始執行 ALTER，以消除大型 ALTER 造成的複寫延遲。[ALTER TABLE](https://mariadb.com/docs/server/reference/sql-statements/data-definition/alter/alter-table)
- INSTANT 限制：表有隱藏 `FTS_DOC_ID` 時不能 instant 加欄；改為 `NOT NULL` 永遠不是 instant；VARCHAR 擴充只有在長度前綴位元組數不變時才是 instant；ENUM／SET 只能在尾端加值。instant 加／刪／重排欄位會讓 tablespace 處於非標準格式，可用 `ALTER TABLE ... FORCE, ALGORITHM=INPLACE` 正規化。[Instant ALTER algorithm](https://mariadb.com/docs/server/server-usage/storage-engines/innodb/innodb-online-ddl/innodb-online-ddl-operations-with-the-instant-alter-algorithm)
- `WAIT n`／`NOWAIT`：可附加在 `ALTER TABLE`、`CREATE INDEX`、`DROP INDEX`、`DROP TABLE`、`RENAME TABLE`、`TRUNCATE TABLE`、`OPTIMIZE TABLE`、`LOCK TABLE`、`SELECT ... FOR UPDATE` 等，針對單一陳述式覆寫 `lock_wait_timeout` 與 `innodb_lock_wait_timeout`。MySQL 的 DDL 沒有對應子句。[WAIT and NOWAIT](https://mariadb.com/docs/server/reference/sql-statements/transactions/wait-and-nowait)

## 4. 鎖等待與執行時間預算

| 引擎 | 變數 | 管什麼 | 預設 | 來源 |
| --- | --- | --- | --- | --- |
| PostgreSQL | `lock_timeout` | 每次取得表／索引／列等物件鎖的等待時間（含隱式取得的鎖） | 0（停用） | [Client Connection Defaults](https://www.postgresql.org/docs/18/runtime-config-client.html) |
| PostgreSQL | `statement_timeout` | 單一陳述式從抵達到完成的時間 | 0（停用） | 同上 |
| PostgreSQL | `transaction_timeout` | 整個交易（含隱式單句交易）的時間；PG 17 新增 | 0（停用） | 同上、[PG 17 release notes](https://www.postgresql.org/docs/release/17.0/) |
| PostgreSQL | `idle_in_transaction_session_timeout` | 交易中閒置的 session（避免長期持鎖） | 0（停用） | 同上 |
| MySQL | `lock_wait_timeout` | 取得 metadata lock 的等待（DML、DDL、`LOCK TABLES`、`FLUSH TABLES WITH READ LOCK` 等）；可用 `SET_VAR` hint | 31536000 秒（1 年） | [Server System Variables](https://dev.mysql.com/doc/refman/8.4/en/server-system-variables.html) |
| MySQL | `max_execution_time` | 只限唯讀 `SELECT` 的執行時間（毫秒） | 0（停用） | 同上 |
| MySQL／MariaDB | `innodb_lock_wait_timeout` | InnoDB 列鎖等待 | 未在本次查證預設值 | — |
| MariaDB | `lock_wait_timeout` | 取得 metadata lock 的等待，每次嘗試分別計時 | 86400 秒（1 天） | [Server System Variables](https://mariadb.com/docs/server/server-management/variables-and-modes/server-system-variables) |
| MariaDB | `max_statement_time` | 所有查詢（不限 SELECT）的執行時間，stored procedure 內的陳述式除外 | 0（停用） | 同上 |

- PostgreSQL 官方對 `lock_timeout`、`statement_timeout`、`transaction_timeout` 都寫明「不建議」設在 `postgresql.conf`，因為會影響所有 session；`lock_timeout` 若不小於非零的 `statement_timeout` 便沒有意義。[Client Connection Defaults](https://www.postgresql.org/docs/18/runtime-config-client.html)
- **推論**：MySQL 沒有能限制 DDL 執行時間的內建變數（`max_execution_time` 只管唯讀 SELECT），所以 DDL 的預算只能透過 `lock_wait_timeout`（限等待）加上外部監控或工具（gh-ost／pt-osc 的節流與中止條件）達成。MariaDB 的 `max_statement_time` 適用於所有查詢，但本次未查證它對 DDL 中途中止的行為。

## 5. PostgreSQL 的 CONCURRENTLY 系列

- `CREATE INDEX CONCURRENTLY`：掃描兩次表，並等待所有可能修改或使用該索引的既有交易結束；同一張表同時只能有一個 concurrent build；分割表不支援，需逐個 partition concurrent build，再以非 concurrent 方式建立父索引。失敗時（deadlock、唯一性衝突）會留下 INVALID 索引，查詢不使用但仍有寫入成本；建議 `DROP INDEX` 後重試，或 `REINDEX INDEX CONCURRENTLY`。[CREATE INDEX](https://www.postgresql.org/docs/18/sql-createindex.html)
- `REINDEX CONCURRENTLY`（PG 12 新增）：失敗時留下的 INVALID 索引若以 `_ccnew` 結尾，刪掉後重試；若以 `_ccold` 結尾，表示重建已成功，刪掉即可。`REINDEX SYSTEM` 不支援 concurrent。[REINDEX](https://www.postgresql.org/docs/18/sql-reindex.html)、[PG 12 release notes](https://www.postgresql.org/docs/release/12.0/)
- `DETACH PARTITION ... CONCURRENTLY`：不可在 transaction block 內執行；有 default partition 時不允許；同時最多一個 partition 處於 pending detach；中斷後以 `FINALIZE` 完成。[ALTER TABLE](https://www.postgresql.org/docs/18/sql-altertable.html)
- **推論**：因為 `CONCURRENTLY` 不能放在交易內，PostgreSQL 的「整個 migration 包在一個交易裡」策略不適用於這些步驟；migration 工具必須把它們拆成獨立、自動 commit 的步驟，並在失敗時檢查 `pg_index.indisvalid`。

## 6. 外部線上變更工具

### gh-ost（GitHub，最新 release v1.1.11，2026-08-17）

- 不用 trigger，靠讀取 binlog 同步 shadow table。需求：MySQL 5.7 以上；至少一台 server 提供 ROW 格式 binlog；`binlog_row_image=FULL`；需 `REPLICATION SLAVE` 加上 `SUPER` 或 `REPLICATION CLIENT`（`SUPER` 只用在 `STOP/START SLAVE`，已是 RBR 時可用 `--assume-rbr` 避開）。[Requirements and limitations](https://github.com/github/gh-ost/blob/master/doc/requirements-and-limitations.md)
- 限制：**不支援 foreign key**、**不支援 trigger**；新舊表必須共享 PRIMARY KEY 或 UNIQUE KEY，且 key 不得含 NULL；不支援 `ALTER TABLE ... RENAME TO`、FEDERATED 表、加密 binlog、active-active master-master。同頁。
- 雲端：Amazon RDS 可用（無 `SUPER`，需 `--assume-rbr` + `binlog_format=ROW`，backup retention 需大於 1 天才有 binlog）；Aurora 需把 `aurora_enable_repl_bin_log_filtering` 設為 0 否則 cut-over 會被擋，且共享儲存讓 test-on-replica 模式需另開 cluster。[RDS](https://github.com/github/gh-ost/blob/master/doc/rds.md)。Azure Database for MySQL 需 `--azure`、`--assume-master-host`、`--master-user`、`--master-password`、`--assume-rbr`，replica 的 `binlog_row_image` 需由 `MINIMAL` 改為 `FULL`。[Azure](https://github.com/github/gh-ost/blob/master/doc/azure.md)。Google Cloud SQL 以 `--gcp` 支援。[Requirements and limitations](https://github.com/github/gh-ost/blob/master/doc/requirements-and-limitations.md)
- Cut-over 預設為 atomic：一條連線持鎖，另一條等待 `RENAME`，以 sentry table 防止過早 rename；逾時或連線中斷時原表保持原狀並可重試。[Cut-over](https://github.com/github/gh-ost/blob/master/doc/cut-over.md)
- MariaDB：官方文件**沒有**宣告支援；issue tracker 有 MariaDB 相關錯誤回報（例如 #1268「MariaDB 10.6 User privilege error」）。[gh-ost issues](https://github.com/github/gh-ost/issues/1268)

### pt-online-schema-change（Percona Toolkit 3.7.1 文件）

- 建立空的 shadow table、修改它、分批複製資料，並以 trigger 同步期間的變更，最後以 atomic `RENAME TABLE` 交換。[pt-online-schema-change](https://docs.percona.com/percona-toolkit/pt-online-schema-change.html)
- 需要 PRIMARY KEY 或 UNIQUE INDEX；表上已有 trigger 時不能執行，除非使用 `--preserve-triggers`（需 MySQL 5.7.2+）。
- Foreign key：`--alter-foreign-keys-method` 有 `auto`、`rebuild_constraints`、`drop_swap`（期間表短暫不存在，查詢會失敗）、`none`（子表 FK 指向不存在的表）。
- 預設 session 設定 `innodb_lock_wait_timeout=1`、`lock_wait_timeout=60`，讓工具讓路給其他交易；`--max-lag`（預設 1 秒）依 replica 延遲暫停；`--max-load`（預設 `Threads_running=25`）暫停、`--critical-load`（預設 `Threads_running=50`）中止。
- 託管環境：RDS 沒有 SUPER，開啟 binlog 時建立 trigger 需在 parameter group 設 `log_bin_trust_function_creators=1`（AWS re:Post 文章，本次 WebFetch 回 403，內容取自搜尋摘要，見文末）。

### PostgreSQL 對應：pg_repack

- 用途是線上重建表與索引（取代 `VACUUM FULL` 消除 bloat），不是一般的 schema change 工具。需要 PRIMARY KEY 或非 NULL 的 UNIQUE 索引；只在開始建立 log table 與最後 swap-and-drop 時短暫取 `ACCESS EXCLUSIVE`；執行期間不能對目標表做 DDL。`--wait-timeout` 預設 60 秒，逾時後預設會取消、再終止衝突的 backend，`--no-kill-backend` 則改為跳過該表。支援 PostgreSQL 9.5 至 18。[pg_repack](https://reorg.github.io/pg_repack/)
- RDS for PostgreSQL 支援 pg_repack（9.6.3 以上），需 `rds_superuser` 帳號並以 `-k` 連線（不支援 `-a`）。[RDS pg_repack](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Appendix.PostgreSQL.CommonDBATasks.pg_repack.html)

## 7. 版本支援現況（2026-10-17）

- PostgreSQL：受支援的大版本為 14（EOL 2026-11-12）、15、16、17、18（18.6，EOL 2030-11-14）；13 已於 2025-11-13 EOL；官網顯示 PostgreSQL 19 RC 1，尚未正式發布。[Versioning Policy](https://www.postgresql.org/support/versioning/)
- MySQL：8.0 於 2026-04 隨 8.0.46 進入 EOL，官方建議升級至 8.4 LTS 或 Innovation release。[8.0 Release Notes](https://dev.mysql.com/doc/relnotes/mysql/8.0/en/)。LTS 提供 5 年 premier 加 3 年 extended support；8.4 手冊提到下一個 LTS 系列為 9.7.x；Innovation release 只支援到下一個 Innovation release。[MySQL Releases](https://dev.mysql.com/doc/refman/8.4/en/mysql-releases.html)、[9.7 Release Notes](https://dev.mysql.com/doc/relnotes/mysql/9.7/en/)
- MariaDB LTS：10.6（Community EOL 2026-07-06，已過）、10.11（2028-02-16）、11.4（2029-05-29）、11.8（2028-06-04）、12.3（2029-06-12）。[MariaDB maintenance policy](https://mariadb.org/about/#maintenance-policy)
- **推論，對 v1 影響**：PostgreSQL 的 `NOT NULL ... NOT VALID` 只有 18 可用；`transaction_timeout` 只有 17 以上可用；MySQL 8.0 已 EOL，但託管服務可能有延長支援（未驗證，見文末）；MariaDB 的 `ALGORITHM=COPY, LOCK=NONE` 只有 11.2 以上可用，LTS 中對應 11.4 起。

## 8. 沒有通用 rollback 的變更

以下每一項都標出依據：直接引用，或由引用事實推得（**推論**）。

- **MySQL／MariaDB 的任何 DDL**：執行前就 implicit commit，交易層級沒有 `ROLLBACK` 可用；atomic DDL 只保證單句內全有或全無。[MySQL implicit commit](https://dev.mysql.com/doc/refman/8.4/en/implicit-commit.html)、[MySQL atomic DDL](https://dev.mysql.com/doc/refman/8.4/en/atomic-ddl.html)、[MariaDB implicit commit](https://mariadb.com/docs/server/reference/sql-statements/transactions/sql-statements-that-cause-an-implicit-commit)。反向操作只能另寫一條 DDL，而反向 DDL 本身也可能需要 COPY 重建（**推論**）。
- **刪除資料的變更（兩引擎皆然）**：`DROP COLUMN`、`DROP TABLE`、`TRUNCATE`、縮窄型別或改型別造成截斷。PostgreSQL 在**同一交易尚未 commit 前**可回滾；commit 之後，或在 MySQL／MariaDB 上，只能從備份或 PITR 還原（**推論**）。
- **PostgreSQL enum 新增值**：`ALTER TYPE` 只有 `ADD VALUE` 與 `RENAME VALUE`，沒有 `DROP VALUE`。[ALTER TYPE](https://www.postgresql.org/docs/18/sql-altertype.html)
- **PostgreSQL 不能在交易內執行的指令**（`CONCURRENTLY` 系列、`CREATE/DROP DATABASE`、`ALTER SYSTEM`、`VACUUM` 等）：不能與其他步驟一起回滾；`CONCURRENTLY` 失敗會留下 INVALID 索引，需要人工 `DROP INDEX`。見第 1、5 節。
- **外部工具 cut-over 之後**：gh-ost 與 pt-osc 都以 `RENAME` 交換表，pt-osc 預設刪除原表。[pt-online-schema-change](https://docs.percona.com/percona-toolkit/pt-online-schema-change.html)。**推論**：cut-over 後要回到原 schema，只能再跑一次反向遷移。
- **MySQL INSTANT 的累積效應**：每次 INSTANT 加／刪欄位都消耗 row version（上限 64／255），「加了又刪」不會歸還額度，只有 rebuild 能歸零。[8.4 Online DDL Operations](https://dev.mysql.com/doc/refman/8.4/en/innodb-online-ddl-operations.html)

## 9. 對 DBA Role Skill 的意涵（推論，待 map #231 決策）

以下是由上述事實推得的設計約束，不是已核准的決策：

- 變更計畫需要逐引擎標註「能否交易內回滾」，不能用同一套 rollback 敘述涵蓋兩個引擎。
- 每個 DDL 步驟都應帶鎖等待預算：PostgreSQL 用 session 層級 `SET lock_timeout`／`statement_timeout`；MySQL 用 session `lock_wait_timeout`；MariaDB 可用 `WAIT n`／`NOWAIT`。三者的預設值都不適合生產變更。
- MySQL 的變更建議明確寫出 `ALGORITHM` 與 `LOCK`，讓不支援的組合直接失敗；需要 COPY 的變更改走 gh-ost 或 pt-osc，再依「有沒有 FK、有沒有 trigger」選擇工具（gh-ost 兩者都不支援）。
- 部署在自建或託管環境會改變工具可行性：RDS 沒有 SUPER，Aurora 需調整 binlog filtering，Azure 需額外旗標；PostgreSQL 的 CONCURRENTLY 與 timeout 在託管環境的可用性本次未逐一查證。

## 未驗證或待查

- 託管服務（RDS、Aurora、Azure Database、Cloud SQL）對 MySQL 8.0 的延長支援期限：只見到二手來源與 Oracle HeatWave 部落格的摘要（HeatWave 8.0 延長至 2027-04），沒有逐一查官方頁面。
- AWS re:Post「rds-mysql-functions」（`log_bin_trust_function_creators=1` 才能在 RDS 開 binlog 時建 trigger）：WebFetch 回 403，內容來自搜尋摘要，未讀到原文。
- MySQL Bug #115511 的修正版本未查證；Bug #115608 頁面寫的是「upcoming」8.0.41／8.4.4／9.2.0，本次未在對應 release notes 交叉確認。
- MySQL「26.x」版本線出現在文件版本選單，但本次沒有找到說明其與 9.x LTS／Innovation 關係的官方頁面。
- MariaDB instant ADD COLUMN／DROP COLUMN／重排欄位的起始版本（常見說法為 10.3 與 10.4）在 MariaDB 文件頁面沒有寫出，未驗證。
- MariaDB `WAIT`／`NOWAIT` 的引入版本未寫在文件頁面。
- MariaDB `max_statement_time` 中止 DDL 的行為、以及 MySQL／MariaDB `innodb_lock_wait_timeout` 的預設值，本次未查證。
- gh-ost 對 MariaDB 與 Galera 的相容性：官方文件未宣告，只有使用者 issue。
- Azure Database for PostgreSQL、Cloud SQL for PostgreSQL 對 pg_repack 的支援，以及託管 PostgreSQL 是否限制 `ALTER SYSTEM`（通常由 parameter group 取代）：未查證。
