# 原生權限與 TLS 的唯讀稽核（PostgreSQL／MySQL／MariaDB，含 AWS RDS 差異）

研究票：[#239](https://github.com/CarlLee1983/dbcli/issues/239)（地圖 [#231](https://github.com/CarlLee1983/dbcli/issues/231)，部署形態依 [#232](https://github.com/CarlLee1983/dbcli/issues/232)）。查閱日期：2026-10-17。

範圍與前提：

- **引擎層**：只用 SQL 可觀察的訊號，經 dbcli 的 `query`（`query-only` 權限）讀取；同時適用 RDS 與自架。
- **平台層**：只涵蓋 AWS RDS for PostgreSQL／MySQL／MariaDB（不含 Aurora），只用唯讀 API（`describe-*`、`list-*`、CloudWatch `get-metric-*`）。
- 稽核本身唯讀：不執行 GRANT／REVOKE、不改帳號、不改參數群組、不安裝 extension。會變更狀態的指令只列為「交人執行的 runbook」。

可信度標記：**[已核]** 表示本文引用的一手文件頁面已逐字查證；**[推論]** 表示由一手資料推得、但文件未直接寫明；**[未核]** 表示來自既有知識、本次未找到一手來源佐證，採用前須再驗。

## 結論先行

1. 三個引擎都能以純 SELECT／SHOW 列出帳號、角色、成員關係、物件權限與連線 TLS 狀態；**真正卡權限的只有兩處**：PostgreSQL 的密碼雜湊類型（`pg_authid` 不公開，RDS 上沒有真 superuser），以及 MySQL／MariaDB 的 `mysql.*` 授權表（需要對 `mysql` schema 的 SELECT）。
2. **RDS 的「最高權限」不是 superuser**：PG 的 master 是 `NOSUPERUSER` 加 `rds_superuser` 成員；MySQL 8.0.36+ 的 master 透過 `rds_superuser_role` 取得權限，清單中沒有 `SUPER`、`FILE`、`SHUTDOWN`。稽核「superuser 等價者」時，RDS 要看 `rds_superuser`／`rds_superuser_role` 的（遞移）成員，而不是 `rolsuper`／`Super_priv`。
3. **伺服器端是否強制 TLS**：RDS 由參數群組決定（PG 的 `rds.force_ssl`、MySQL／MariaDB 的 `require_secure_transport`），SQL 端可用 `SHOW` 讀到當下值；自架 PG 的強制點在 `pg_hba.conf` 的 `hostssl`，其視圖 `pg_hba_file_rules` 預設只有 superuser 可讀。
4. **平台層**用 `describe-db-instances`（`CACertificateIdentifier`、`CertificateDetails.ValidTill`、`IAMDatabaseAuthenticationEnabled`、`DBParameterGroups`）、`describe-certificates`（CA 的 `ValidTill`）與 `describe-db-parameters`（參數實際值與 `Source`）即可覆蓋 CA 到期、IAM 驗證與 TLS 強制三件事。

## 一、PostgreSQL

### 1.1 帳號與角色屬性

```sql
SELECT rolname, rolsuper, rolinherit, rolcreaterole, rolcreatedb,
       rolcanlogin, rolreplication, rolbypassrls, rolconnlimit, rolvaliduntil
FROM pg_roles
ORDER BY rolname;
```

- `pg_roles` 是 `pg_authid` 的公開視圖，`rolpassword` 一律顯示 `********`。**[已核]** [pg_roles（PG 18）](https://www.postgresql.org/docs/current/view-pg-roles.html)
- `pg_authid` 含密碼，「must not be publicly readable」。**[已核]** [pg_authid](https://www.postgresql.org/docs/current/catalog-pg-authid.html)
- 任何可登入的角色都能讀 `pg_roles`，不需提權。**[已核]**（同上「publicly readable」）

### 1.2 角色成員關係

PG 16 以上：

```sql
SELECT r.rolname AS role, m.rolname AS member, g.rolname AS grantor,
       am.admin_option, am.inherit_option, am.set_option
FROM pg_auth_members am
JOIN pg_roles r ON r.oid = am.roleid
JOIN pg_roles m ON m.oid = am.member
LEFT JOIN pg_roles g ON g.oid = am.grantor
ORDER BY r.rolname, m.rolname;
```

PG 15 以下拿掉 `inherit_option`、`set_option` 兩欄（PG 15 文件只列 `roleid`、`member`、`grantor`、`admin_option`）。**[已核]** [pg_auth_members（PG 15）](https://www.postgresql.org/docs/15/catalog-pg-auth-members.html)、[pg_auth_members（PG 18）](https://www.postgresql.org/docs/current/catalog-pg-auth-members.html)

遞移成員（直接或間接）用 `pg_has_role(member, role, 'MEMBER')`；`USAGE` 表示不需 `SET ROLE` 就生效的權限。**[已核]** [System Information Functions](https://www.postgresql.org/docs/current/functions-info.html)。`SET` 模式是較新版本才有 **[未核：推測 PG 16 起]**，跨版本的稽核應只用 `MEMBER`／`USAGE`。

### 1.3 superuser 等價者與高風險屬性

```sql
-- 真 superuser（RDS 上只應看到 rdsadmin）
SELECT rolname FROM pg_roles WHERE rolsuper;

-- RDS：rds_superuser 的遞移成員（自架環境沒有此角色，需先判斷存在）
SELECT m.rolname
FROM pg_roles m
WHERE EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rds_superuser')
  AND m.rolname <> 'rds_superuser'
  AND pg_has_role(m.oid, (SELECT oid FROM pg_roles WHERE rolname = 'rds_superuser'), 'MEMBER');

-- 能繞過權限或提權的屬性與預設角色
SELECT rolname, rolcreaterole, rolbypassrls, rolreplication
FROM pg_roles
WHERE rolcanlogin AND (rolcreaterole OR rolbypassrls OR rolreplication);

SELECT r.rolname AS predefined_role, m.rolname AS member
FROM pg_roles r
JOIN pg_roles m ON pg_has_role(m.oid, r.oid, 'MEMBER') AND m.oid <> r.oid
WHERE r.rolname IN ('pg_read_server_files','pg_write_server_files',
                    'pg_execute_server_program','pg_read_all_data',
                    'pg_write_all_data','rds_replication','rds_password');
```

依據：

- `pg_read_server_files`／`pg_write_server_files`／`pg_execute_server_program` 會「bypass database permission checks」；`pg_read_all_data`／`pg_write_all_data` 對所有表有讀／寫權但不繞過 RLS。**[已核]** [Predefined Roles（PG 18）](https://www.postgresql.org/docs/current/predefined-roles.html)
- RDS 的 master 角色定義為 `CREATE ROLE postgres WITH LOGIN NOSUPERUSER INHERIT CREATEDB CREATEROLE NOREPLICATION VALID UNTIL 'infinity'`，權限來自 `rds_superuser`；無法以真 superuser 連線。`rds_superuser` 可授予／撤銷 `rds_replication`、`rds_password`，並可透過 `pg_stat_activity` 看所有連線、`pg_terminate_backend`。預設角色 `rds_password`、`rdsadmin`、`rdstopmgr`、`rds_reserved` 不可修改。**[已核]** [Understanding the rds_superuser role](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Appendix.PostgreSQL.CommonDBATasks.Roles.rds_superuser.html)
- master user 的系統權限清單（`CREATE ROLE`、`CREATE DB`、`CREATE EXTENSION`、`ALTER <OBJECT> OWNER`、`PG_TERMINATE_BACKEND()` 等）。**[已核]** [Master user account privileges](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/UsingWithRDS.MasterAccounts.html)

### 1.4 物件與 schema 權限

`information_schema.table_privileges` 只列出「授予給目前啟用角色、或由目前啟用角色授予」的權限 **[已核]** [table_privileges](https://www.postgresql.org/docs/current/infoschema-table-privileges.html)，以非 owner 身分稽核會漏資料。改用 catalog 的 ACL 陣列與 `aclexplode`（`pg_class`、`pg_namespace`、`pg_database` 皆公開可讀）：

```sql
-- 表、視圖、序列（grantee = 0 代表 PUBLIC）
SELECT n.nspname, c.relname, c.relkind,
       pg_get_userbyid(c.relowner) AS owner,
       CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END AS grantee,
       pg_get_userbyid(a.grantor) AS grantor,
       a.privilege_type, a.is_grantable
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
CROSS JOIN LATERAL aclexplode(c.relacl) a
WHERE c.relkind IN ('r','p','v','m','f','S')
  AND n.nspname NOT IN ('pg_catalog','information_schema')
  AND n.nspname NOT LIKE 'pg_toast%';

-- schema
SELECT n.nspname, pg_get_userbyid(n.nspowner) AS owner,
       CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END AS grantee,
       a.privilege_type, a.is_grantable
FROM pg_namespace n
CROSS JOIN LATERAL aclexplode(COALESCE(n.nspacl, acldefault('n', n.nspowner))) a
WHERE n.nspname NOT IN ('pg_catalog','information_schema')
  AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp%';

-- database（PUBLIC 預設有 CONNECT、TEMPORARY）
SELECT d.datname,
       CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END AS grantee,
       a.privilege_type
FROM pg_database d
CROSS JOIN LATERAL aclexplode(COALESCE(d.datacl, acldefault('d', d.datdba))) a;
```

- `aclexplode` 回傳 `(grantor, grantee, privilege_type, is_grantable)`，PUBLIC 以 grantee = 0 表示；`acldefault` 產生 ACL 為 NULL 時的預設權限。**[已核]** [System Information Functions](https://www.postgresql.org/docs/current/functions-info.html)
- 表的 `relacl` 為 NULL 表示只有 owner 的預設權限；上面第一段查詢刻意不展開，避免把每張表的 owner 權限灌進報告。**[推論]**
- PG 15 起新叢集／新資料庫的 `public` schema 不再授予 PUBLIC `CREATE`，owner 改為 `pg_database_owner`；**升級或還原的資料庫會保留舊權限**，因此「PUBLIC 對 public schema 有 CREATE」在 RDS 升級而來的實例上仍可能出現，是重點稽核項目。**[已核]** [PostgreSQL 15 Release Notes](https://www.postgresql.org/docs/release/15.0/)

### 1.5 預設權限（ALTER DEFAULT PRIVILEGES）

```sql
SELECT pg_get_userbyid(d.defaclrole) AS for_role,
       COALESCE(n.nspname, '(all schemas)') AS schema,
       d.defaclobjtype,               -- r 表/視圖, S 序列, f 函式, T 型別, n schema, L large object
       CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END AS grantee,
       a.privilege_type, a.is_grantable
FROM pg_default_acl d
LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace
CROSS JOIN LATERAL aclexplode(d.defaclacl) a;
```

`defaclnamespace = 0` 是全域項目，取代內建預設；指定 schema 的項目是「加在」全域或內建預設之上。**[已核]** [pg_default_acl](https://www.postgresql.org/docs/current/catalog-pg-default-acl.html)

### 1.6 密碼與驗證方式

| 訊號 | 唯讀 SQL | 權限需求 |
| --- | --- | --- |
| 新密碼的雜湊演算法 | `SHOW password_encryption;` | 任何人 |
| RDS 接受的驗證方式 | `SHOW rds.accepted_password_auth_method;`（`md5+scram` 或 `scram`） | 任何人 **[推論]** |
| RDS 密碼管理是否收斂 | `SHOW rds.restrict_password_commands;` | 任何人 |
| 每個角色的實際雜湊類型 | 自架：`SELECT rolname, CASE WHEN rolpassword LIKE 'SCRAM-SHA-256$%' THEN 'scram-sha-256' WHEN rolpassword LIKE 'md5%' THEN 'md5' WHEN rolpassword IS NULL THEN 'none' END FROM pg_authid;` | 自架需 superuser；**RDS 讀不到** |
| IAM 驗證帳號 | `pg_has_role(m.oid, 'rds_iam', 'MEMBER')`（同 1.3 寫法） | 任何人 |
| 密碼到期 | `pg_roles.rolvaliduntil` | 任何人 |

- RDS PG 14 起 `password_encryption` 預設 `scram-sha-256`，PG 13 預設 `md5`；`rds.accepted_password_auth_method` 預設 `md5+scram`。**[已核]** [Using SCRAM for PostgreSQL password encryption](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/PostgreSQL_Password_Encryption_configuration.html)
- RDS 官方給的每角色查法是 `SELECT * FROM rds_tools.role_password_encryption_type();`，但**前置步驟是 `CREATE EXTENSION rds_tools;`**，屬寫入動作，不在唯讀稽核範圍內；若 extension 已存在才可直接查，否則列入 runbook 交人執行。**[已核]**（同上）
- `pg_authid` 的 `rolpassword` 格式：MD5 以 `md5` 開頭，SCRAM 為 `SCRAM-SHA-256$<iter>:<salt>$<StoredKey>:<ServerKey>`；MD5 已 deprecated。**[已核]** [pg_authid](https://www.postgresql.org/docs/current/catalog-pg-authid.html)
- `rds.restrict_password_commands` 預設 `off`；開啟後只有 `rds_password` 成員能改密碼與 `VALID UNTIL`，需 PG 10.6 以上。**[已核]** [Delegating and controlling user password management](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Appendix.PostgreSQL.CommonDBATasks.RestrictPasswordMgmt.html)
- IAM 驗證：授予 `rds_iam`（可巢狀）即啟用。**[已核]** [Creating a database account using IAM authentication](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/UsingWithRDS.IAMDBAuth.DBAccounts.html)
- `pg_hba.conf` 規則（含 `hostssl`、驗證方法）的視圖 `pg_hba_file_rules` 預設只有 superuser 可讀，自架才有意義。**[已核]** [pg_hba_file_rules](https://www.postgresql.org/docs/current/view-pg-hba-file-rules.html)；RDS 上 `rds_superuser` 能否讀此視圖 **[未核]**，預設視為不可用。

### 1.7 連線 TLS

```sql
-- 本連線
SELECT ssl, version, cipher, bits FROM pg_stat_ssl WHERE pid = pg_backend_pid();

-- 所有連線
SELECT a.datname, a.usename, a.client_addr, a.application_name, a.backend_type,
       s.ssl, s.version, s.cipher
FROM pg_stat_ssl s
JOIN pg_stat_activity a ON a.pid = s.pid
WHERE a.backend_type = 'client backend'
ORDER BY s.ssl, a.usename;

-- 伺服器設定（RDS 多一個 rds.force_ssl）
SELECT name, setting FROM pg_settings
WHERE name IN ('ssl','ssl_min_protocol_version','ssl_max_protocol_version',
               'ssl_ciphers','rds.force_ssl');
```

- `pg_stat_ssl` 欄位：`pid`、`ssl`、`version`、`cipher`、`bits`、`client_dn`、`client_serial`、`issuer_dn`。看別人 session 的完整資訊需 superuser 或 `pg_read_all_stats`；一般使用者只看得到自己的。**[已核]** [Cumulative Statistics System（PG 18）](https://www.postgresql.org/docs/current/monitoring-stats.html)
- RDS 官方也用 `pg_stat_ssl JOIN pg_stat_activity` 這個查法，並提醒「只反映查詢當下的連線」，沒看到非 TLS 連線不代表不存在。**[已核]** [PostgreSQL SSL 連線](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/PostgreSQL.Concepts.General.SSL.html)、[Updating applications … PostgreSQL](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/ssl-certificate-rotation-postgresql.html)
- RDS 的 `rds.force_ssl`：PG 15 以上預設 `1`，14 以下預設 `0`。官方另示範 `sslinfo` 的 `ssl_is_used()`，但同樣要 `CREATE EXTENSION`，稽核改用 `pg_stat_ssl`。**[已核]**（同上）
- 伺服器憑證是否被客戶端**驗證**（`sslmode=verify-full`）是 client 端設定，伺服器端 SQL 看不到。**[已核]**（同上「The certificate on the server is verified only when sslrootcert is provided with sslmode set to verify-ca or verify-full」）

## 二、MySQL（以 8.0／8.4 為準）

### 2.1 帳號、角色、成員關係

```sql
-- 帳號（需 mysql.user 的 SELECT）
SELECT user, host, plugin, account_locked, password_expired,
       password_last_changed, password_lifetime, ssl_type
FROM mysql.user
ORDER BY user, host;

-- 角色成員（role_edges：FROM = 角色，TO = 被授予者）
SELECT FROM_USER, FROM_HOST, TO_USER, TO_HOST, WITH_ADMIN_OPTION
FROM mysql.role_edges;

SELECT * FROM mysql.default_roles;
```

- 授權表清單：`user`、`global_grants`（動態全域權限）、`db`、`tables_priv`、`columns_priv`、`procs_priv`、`proxies_priv`、`default_roles`、`role_edges`、`password_history`；`plugin`、`ssl_type`、`password_expired`、`password_last_changed`、`password_lifetime`、`account_locked` 都是 `mysql.user` 欄位。**[已核]** [Grant Tables（8.4）](https://dev.mysql.com/doc/refman/8.4/en/grant-tables.html)
- 讀 `mysql.*` 需要對該表的 SELECT。**[未核：一手頁面未明寫]**，RDS master 有全域 `SELECT`，因此可讀。**[推論]**
- 沒有 `mysql` schema 讀權時的替代：`SHOW GRANTS FOR 'u'@'h';`、`SHOW CREATE USER 'u'@'h';`（官方建議用這兩者而非直接查表）。**[已核]**（同上）。對他人帳號執行時的權限需求 **[未核]**。
- dbcli 的 `query-only` 權限允許 `SELECT`、`SHOW`、`DESCRIBE`、`EXPLAIN`，所以 `SHOW GRANTS` 可經 dbcli 執行。**[已核]** `src/core/permission-guard.ts:365`

### 2.2 權限明細

```sql
SELECT * FROM information_schema.USER_PRIVILEGES;    -- 全域靜態權限
SELECT * FROM information_schema.SCHEMA_PRIVILEGES;
SELECT * FROM information_schema.TABLE_PRIVILEGES;
SELECT * FROM information_schema.COLUMN_PRIVILEGES;
SELECT USER, HOST, PRIV, WITH_GRANT_OPTION FROM mysql.global_grants;  -- 動態權限
```

- `USER_PRIVILEGES` 取自 `mysql.user`，每列一個權限，`IS_GRANTABLE` 表示是否有 GRANT OPTION；官方提醒它與 `SHOW GRANTS` 不等價。**[已核]** [USER_PRIVILEGES](https://dev.mysql.com/doc/refman/8.4/en/information-schema-user-privileges-table.html)
- INFORMATION_SCHEMA 一般規則：使用者只看得到自己有權限的物件的列。**[已核]** [INFORMATION_SCHEMA Introduction](https://dev.mysql.com/doc/refman/8.4/en/information-schema-introduction.html)；`*_PRIVILEGES` 表對他人帳號的可見性規則 **[未核]**，稽核應以 `mysql.*` 為主、`information_schema` 為輔。

### 2.3 superuser 等價者

自架：`mysql.user` 中 `Super_priv='Y'`、`Grant_priv='Y'`、`Create_user_priv='Y'`、`File_priv='Y'`、`Shutdown_priv='Y'`，以及 `mysql.global_grants` 中 `PRIV IN ('SYSTEM_USER','SYSTEM_VARIABLES_ADMIN','CONNECTION_ADMIN','ROLE_ADMIN','SET_USER_ID','BINLOG_ADMIN','ENCRYPTION_KEY_ADMIN')`。後者這組動態權限的危險度分級為 **[未核：依 MySQL 權限文件既有知識]**。

RDS for MySQL：

- 8.0.36 起 master 透過 `rds_superuser_role`（`WITH GRANT OPTION`）取得權限，含 `CREATE USER`、`ROLE_ADMIN`、`SET_USER_ID`、`APPLICATION_PASSWORD_ADMIN`、`XA_RECOVER_ADMIN` 等；**清單沒有 `SUPER`、`FILE`、`SHUTDOWN`、`SYSTEM_USER`**。查法：`SHOW GRANTS FOR rds_superuser_role@'%';`。8.0.36 起不能直接 DML `mysql` 授權表，但仍可查詢。**[已核]** [Role-based privilege model for RDS for MySQL](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Appendix.MySQL.CommonDBATasks.privilege-model.html)、[Master user account privileges](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/UsingWithRDS.MasterAccounts.html)
- 因此 RDS 上的「superuser 等價者」= `role_edges` 中 `FROM_USER='rds_superuser_role'` 的遞移成員，加上直接持有 `CREATE USER` 或 GRANT OPTION 的帳號。**[推論]**
- 角色需 `SET ROLE` 或預設角色才生效，`CURRENT_ROLE()` 可看本 session 生效角色。**[已核]**（同上）

### 2.4 密碼與驗證方式

- `mysql.user.plugin` 決定驗證插件。`mysql_native_password` 自 8.0.34 deprecated、8.4 預設停用、9.0 移除；8.4 client 預設 `caching_sha2_password`。**[已核]** [Native Pluggable Authentication（8.4）](https://dev.mysql.com/doc/refman/8.4/en/native-pluggable-authentication.html)
- IAM 驗證帳號的 `plugin = 'AWSAuthenticationPlugin'`（`CREATE USER … IDENTIFIED WITH AWSAuthenticationPlugin AS 'RDS'`）。**[已核]** [IAM DB accounts](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/UsingWithRDS.IAMDBAuth.DBAccounts.html)
- 不要把 `authentication_string` 選進報告（即使是雜湊也屬機敏），只判斷是否為空：`authentication_string = ''` 且非角色、非 IAM 帳號 → 無密碼帳號。**[推論]**

### 2.5 連線 TLS

```sql
-- 本連線
SHOW SESSION STATUS WHERE Variable_name IN ('Ssl_version','Ssl_cipher');

-- 所有連線（RDS 官方查法，需 performance_schema 啟用）
SELECT id, user, host, connection_type
FROM performance_schema.threads pst
INNER JOIN information_schema.processlist isp ON pst.processlist_id = isp.id;

-- 伺服器強制與協定版本
SHOW GLOBAL VARIABLES WHERE Variable_name IN ('require_secure_transport','tls_version');

-- 個別帳號是否 REQUIRE SSL/X509（'' = 不要求，ANY = REQUIRE SSL）
SELECT user, host, ssl_type FROM mysql.user;
```

- `performance_schema.threads.CONNECTION_TYPE` 值為 `TCP/IP`（未加密）、`SSL/TLS`、`Socket` 等；**此表對有 SELECT 權者顯示所有使用者的 thread，不需 `PROCESS`**（其他來源才需要）。**[已核]** [threads 表（8.4）](https://dev.mysql.com/doc/refman/8.4/en/performance-schema-threads-table.html)。不過 join 的 `information_schema.processlist` 需要 `PROCESS` 才看得到他人連線 **[推論]**，必要時只查 `performance_schema.threads`。
- RDS 官方用上面的 join 判斷應用是否走 TLS（5.7、8.0、8.4，需啟用 Performance Schema）。**[已核]** [Updating applications … MySQL](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/ssl-certificate-rotation-mysql.html)
- RDS for MySQL 的 `require_secure_transport` 預設 `OFF`，改動不需重開機；開啟後非加密連線收到 Error 3159。**[已核]** [Requiring SSL/TLS for all connections to a MySQL DB instance](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/mysql-ssl-connections.require-ssl.html)
- RDS MySQL 8.0／8.4 只支援 TLS 1.2、1.3；5.7 支援 1.0–1.2。8.4 改用 AWS-LC。**[已核]** [SSL/TLS support for MySQL on RDS](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/MySQL.Concepts.SSLSupport.html)
- 上游 MySQL 文件中 `require_secure_transport` 視 Unix socket／shared memory 為安全連線 **[未核：本次未取得該段原文]**；RDS 不提供 socket 連線，影響僅限自架。

## 三、MariaDB

### 3.1 帳號、角色、成員關係

```sql
-- mysql.user 在新版是相容視圖；權威來源是 mysql.global_priv（Priv 為 JSON）
SELECT user, host, is_role, plugin, ssl_type, default_role FROM mysql.user;

SELECT user, host,
       JSON_VALUE(Priv, '$.plugin')                AS plugin,
       JSON_VALUE(Priv, '$.account_locked')        AS account_locked,
       JSON_VALUE(Priv, '$.password_last_changed') AS password_last_changed,
       JSON_VALUE(Priv, '$.password_lifetime')     AS password_lifetime
FROM mysql.global_priv;

-- 角色成員
SELECT Host, User, Role, Admin_option FROM mysql.roles_mapping;
```

- `mysql.global_priv` 取代 `mysql.user`，後者「should be considered obsolete」；`mysql.user` 有 `is_role`、`default_role`、`plugin`、`ssl_type` 欄。**[已核]** [mysql.user](https://mariadb.com/kb/en/mysql-user-table/)、[mysql.global_priv](https://mariadb.com/kb/en/mysql-global_priv-table/)。改為視圖的版本（一般認為 10.4）**[未核]**。
- `global_priv.Priv` 的 JSON 鍵在官方範例中可見 `access`、`plugin`、`authentication_string`、`account_locked`、`password_last_changed`、`version_id`；`password_lifetime` 鍵 **[未核]**，查不到時回 NULL，不致出錯。
- `mysql.roles_mapping` 欄位：`Host`、`User`、`Role`、`Admin_option`。**[已核]** [mysql.roles_mapping](https://mariadb.com/kb/en/mysql-roles_mapping-table/)
- `mysql.user.password_expired` 在 MariaDB 是「MySQL-compatibility option that MariaDB does not implement」，不可用來判斷到期。**[已核]**（mysql.user 頁）

### 3.2 權限明細與 superuser 等價者

權限明細同 MySQL：`information_schema.USER_PRIVILEGES`／`SCHEMA_PRIVILEGES`／`TABLE_PRIVILEGES`／`COLUMN_PRIVILEGES`，或 `SHOW GRANTS FOR`。**[推論：MariaDB 沿用相同 information_schema 表]**

RDS for MariaDB 的 master 權限清單沒有 `SUPER`、`FILE`、`SHUTDOWN`，有 `CREATE USER`、`RELOAD`、`PROCESS`、`REPLICATION CLIENT/SLAVE`；11.4 起多 `SHOW CREATE ROUTINE`。RDS for MariaDB **沒有**對應 `rds_superuser_role` 的角色（表中 Database role 欄為「—」）。**[已核]** [Master user account privileges](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/UsingWithRDS.MasterAccounts.html)

因此 MariaDB 的 superuser 等價判斷：自架看 `Super_priv='Y'`；RDS 看 `Create_user_priv='Y'` 或 `Grant_priv='Y'` 的帳號。MariaDB 10.5 起把 SUPER 拆成多個細權限 **[未核]**，自架稽核時要一併列入。

### 3.3 驗證方式

`plugin` 欄常見值：`mysql_native_password`、`ed25519`、`unix_socket`、`AWSAuthenticationPlugin`（IAM，同 MySQL 寫法）。IAM 部分 **[已核]**（[IAM DB accounts](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/UsingWithRDS.IAMDBAuth.DBAccounts.html)，MariaDB 與 MySQL 共用），其餘插件名稱 **[未核]**。

### 3.4 連線 TLS

```sql
SHOW SESSION STATUS WHERE Variable_name IN ('Ssl_version','Ssl_cipher');
SHOW GLOBAL VARIABLES WHERE Variable_name IN ('require_secure_transport','tls_version');
SELECT user, host, ssl_type FROM mysql.user;
```

- RDS for MariaDB 的 `require_secure_transport`：11.4 以前預設 `OFF`，**11.8 起預設 `ON`**；只支援 10.5 以上；不需重開機。**[已核]** [Requiring SSL/TLS for all connections to a MariaDB DB instance](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/mariadb-ssl-connections.require-ssl.html)
- `tls_version` 自 10.4.6 起，靜態、全域；10.6.16、10.11.6、11.0.4 之後預設 `TLSv1.2,TLSv1.3`，更早版本也預設啟用 TLSv1.1。**[已核]** [SSL/TLS System Variables](https://mariadb.com/docs/server/security/encryption/data-in-transit-encryption/ssltls-system-variables)
- 全實例連線的 TLS 列表：MariaDB 的 `performance_schema.threads` 是否有 `CONNECTION_TYPE` 欄 **[未核]**；v1 先只做本連線與伺服器強制兩項，全連線列表留作後續驗證。

## 四、RDS 上的限制總表（引擎層）

| 稽核項目 | PostgreSQL on RDS | MySQL on RDS | MariaDB on RDS |
| --- | --- | --- | --- |
| 帳號／角色清單 | `pg_roles`，任何人可讀 | `mysql.user` 需 SELECT（master 有） | `mysql.user`／`global_priv` 需 SELECT（master 有） |
| 成員關係 | `pg_auth_members`，任何人可讀 | `mysql.role_edges` | `mysql.roles_mapping` |
| 物件權限 | `aclexplode` over catalog，任何人可讀 | `mysql.*_priv`／`information_schema` | 同 MySQL |
| 預設權限 | `pg_default_acl` | 無此概念 | 無此概念 |
| 真 superuser | 只有 `rdsadmin`，使用者無法取得 | 無 `SUPER`；有 `rds_superuser_role`（8.0.36+） | 無 `SUPER`，無對應角色 |
| 密碼雜湊類型（逐帳號） | **讀不到**（`pg_authid` 不開放）；`rds_tools` 需 CREATE EXTENSION | `plugin` 欄可讀 | `plugin` 欄可讀 |
| 伺服器強制 TLS | `SHOW rds.force_ssl` | `require_secure_transport` | `require_secure_transport` |
| 全連線 TLS 狀態 | `pg_stat_ssl`，需 `pg_read_all_stats` 或 rds_superuser 才看得全 | `performance_schema.threads.CONNECTION_TYPE` | **[未核]** |
| `pg_hba` 規則 | 不可用（預設視為） | — | — |

## 五、平台層（AWS RDS，唯讀 API）

### 5.1 可用 API 與欄位

| API | 欄位 | 用途 |
| --- | --- | --- |
| `aws rds describe-db-instances` | `CACertificateIdentifier`、`CertificateDetails.CAIdentifier`、`CertificateDetails.ValidTill` | 實例使用哪個 CA、**伺服器憑證**何時到期 |
| 同上 | `IAMDatabaseAuthenticationEnabled` | IAM DB 驗證是否開啟 |
| 同上 | `DBParameterGroups[].DBParameterGroupName`、`ParameterApplyStatus` | 找出參數群組，及是否 `pending-reboot` |
| 同上 | `PubliclyAccessible`、`StorageEncrypted`、`DeletionProtection`、`MasterUsername`、`MasterUserSecret`、`PendingModifiedValues`、`Engine`、`EngineVersion` | 周邊安全姿態；`MasterUserSecret` 只看是否由 Secrets Manager 管理，**不取 secret 值** |
| `aws rds describe-certificates` | `CertificateIdentifier`、`ValidFrom`、`ValidTill`、`CustomerOverride`、`CustomerOverrideValidTill` | **CA 本身**的有效期，與帳號層級預設 CA 覆寫 |
| `aws rds describe-db-engine-versions` | `SupportedCACertificateIdentifiers`、`SupportsCertificateRotationWithoutRestart` | 該引擎版本可選的 CA、憑證輪替是否需重開機 |
| `aws rds describe-pending-maintenance-actions` | `server-certificate-rotation` 動作 | 不支援免重開機輪替的引擎，RDS 會在憑證半衰期或到期前至少 3 個月掛出此動作 |
| `aws rds describe-db-parameters` | `ParameterName`、`ParameterValue`、`Source`、`ApplyType`、`IsModifiable`、`ApplyMethod` | 讀參數群組裡的實際值 |

依據 **[已核]**：[DBInstance](https://docs.aws.amazon.com/AmazonRDS/latest/APIReference/API_DBInstance.html)、[CertificateDetails](https://docs.aws.amazon.com/AmazonRDS/latest/APIReference/API_CertificateDetails.html)、[Certificate](https://docs.aws.amazon.com/AmazonRDS/latest/APIReference/API_Certificate.html)、[describe-db-parameters](https://docs.aws.amazon.com/cli/latest/reference/rds/describe-db-parameters.html)、[Using SSL/TLS](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/UsingWithRDS.SSL.html)、[Rotating your SSL/TLS certificate](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/UsingWithRDS.SSL-certificate-rotation.html)。

範例（唯讀）：

```bash
aws rds describe-db-instances --db-instance-identifier <id> \
  --query 'DBInstances[0].{CA:CACertificateIdentifier,ServerCertValidTill:CertificateDetails.ValidTill,IAM:IAMDatabaseAuthenticationEnabled,PG:DBParameterGroups}'

aws rds describe-certificates \
  --query 'Certificates[].[CertificateIdentifier,ValidTill,CustomerOverride]' --output text

aws rds describe-db-parameters --db-parameter-group-name <pg> \
  --filters "Name=parameter-name,Values=rds.force_ssl,ssl_min_protocol_version,password_encryption,rds.accepted_password_auth_method,rds.restrict_password_commands" \
  --query 'Parameters[].[ParameterName,ParameterValue,Source]' --output text
```

MySQL／MariaDB 把 `--filters` 的值換成 `require_secure_transport,tls_version`。

### 5.2 讀參數要注意

- `--filters` 只支援 `parameter-name`，不支援萬用字元、區分大小寫。**[已核]**
- **不要加 `--source user`**：它只回傳使用者改過的值；要知道實例實際生效值（例如 PG 15 的 `rds.force_ssl` 預設 1），必須不限 source 讀全部，再看 `Source` 欄。**[推論]**
- SQL 端 `SHOW` 讀到的是執行中值；API 讀到的是參數群組設定值。兩者不同且 `ParameterApplyStatus = pending-reboot` 時，表示改了但尚未生效，報告應並列兩者。**[推論]**

### 5.3 CA 與憑證事實

- RDS 提供 `rds-ca-rsa2048-g1`（預設）、`rds-ca-rsa4096-g1`、`rds-ca-ecc384-g1`，三者皆支援伺服器憑證自動輪替；後兩者在部分 Region（孟買、墨爾本、卡加利、蘇黎世、西班牙、特拉維夫）不提供。**[已核]** [Using SSL/TLS](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/UsingWithRDS.SSL.html)
- `rds-ca-2019` 已於 2024 年 8 月到期；仍掛此 CA 的實例是高優先發現。**[已核]** [Rotating your SSL/TLS certificate](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/UsingWithRDS.SSL-certificate-rotation.html)
- 伺服器憑證效期：支援免重開機輪替的引擎版本 1 年，否則 3 年。**[已核]**（同上兩頁）
- 「CA 的 `ValidTill`」（`describe-certificates`）與「實例伺服器憑證的 `ValidTill`」（`CertificateDetails`）是兩件事，報告要分開呈現。**[已核]**（欄位定義）

### 5.4 執行稽核所需的 IAM 權限

`rds:DescribeDBInstances`、`rds:DescribeCertificates`、`rds:DescribeDBEngineVersions`、`rds:DescribePendingMaintenanceActions`、`rds:DescribeDBParameters`。動作名稱依 API 名稱推得 **[推論]**；不需要 `secretsmanager:GetSecretValue`、`rds-db:connect`。

### 5.5 只列入 runbook、交人執行的變更 API

| 目的 | 指令 |
| --- | --- |
| 換 CA | `aws rds modify-db-instance --ca-certificate-identifier rds-ca-rsa2048-g1 [--apply-immediately]` |
| 手動套用伺服器憑證輪替 | `aws rds apply-pending-maintenance-action` |
| 改帳號層級預設 CA | `aws rds modify-certificates` |
| 強制 TLS／改密碼策略 | `aws rds modify-db-parameter-group --parameters "ParameterName=rds.force_ssl,ParameterValue=1,ApplyMethod=..."`（需自訂參數群組；把自訂群組掛到既有實例需重開機。`rds.force_ssl` 本身是否為動態參數 **[未核]**；MySQL／MariaDB 的 `require_secure_transport` 改動不需重開機 **[已核]**） |
| 開 IAM DB 驗證 | `aws rds modify-db-instance --enable-iam-database-authentication` **[未核：旗標名依 CLI 慣例]** |
| PG 逐帳號查雜湊類型 | `CREATE EXTENSION rds_tools;` 後 `SELECT * FROM rds_tools.role_password_encryption_type();` |

## 六、最小權限檢查清單

### PostgreSQL

- [ ] 應用帳號不是 `rds_superuser`（或自架 `rolsuper`）的遞移成員。
- [ ] 應用帳號沒有 `CREATEROLE`、`BYPASSRLS`、`REPLICATION`，也不是 `pg_read_server_files`／`pg_write_server_files`／`pg_execute_server_program`／`pg_write_all_data`／`rds_replication`／`rds_password` 的成員。
- [ ] 應用不直接使用 master 帳號（AWS 明確建議）。
- [ ] `public` schema 沒有授予 PUBLIC `CREATE`（尤其是從 PG 14 以前升級上來的資料庫）。
- [ ] 資料庫層 PUBLIC 的 `CONNECT`／`TEMPORARY` 是刻意保留的。
- [ ] 表的權限授予角色而非個別登入帳號；沒有 PUBLIC 對業務表的 `SELECT`／寫入。
- [ ] `pg_default_acl` 沒有把寫權限預設給 PUBLIC 或過寬角色。
- [ ] `password_encryption = scram-sha-256`；RDS 上 `rds.accepted_password_auth_method` 已收斂為 `scram`（需先確認無 md5 帳號，見 runbook）。
- [ ] 有到期需求的帳號設定了 `rolvaliduntil`。
- [ ] `rds.force_ssl = 1`（或自架只用 `hostssl`），`ssl_min_protocol_version` ≥ `TLSv1.2`；`pg_stat_ssl` 沒有 `ssl = f` 的 client backend。

### MySQL

- [ ] 應用帳號不持有 `rds_superuser_role`（RDS）或 `SUPER`／`SYSTEM_USER`（自架），也沒有 `CREATE USER`、GRANT OPTION、`FILE`、`SHUTDOWN`。
- [ ] 沒有 `host = '%'` 搭配高權限的帳號。**[推論：一般實務]**
- [ ] 沒有使用 `mysql_native_password` 的帳號（8.4 預設停用、9.0 移除）。
- [ ] 沒有空密碼帳號（`authentication_string = ''`，排除角色與 IAM 帳號）。
- [ ] `account_locked`、`password_lifetime` 符合政策；閒置帳號已鎖。
- [ ] `require_secure_transport = ON`，或至少應用帳號 `ssl_type <> ''`；`tls_version` 不含 1.0／1.1。
- [ ] `performance_schema.threads` 沒有 `CONNECTION_TYPE = 'TCP/IP'` 的應用連線。

### MariaDB

- [ ] 應用帳號沒有 `Super_priv`、`Grant_priv`、`Create_user_priv`、`File_priv`。
- [ ] `roles_mapping` 中 `Admin_option = 'Y'` 只出現在 DBA 帳號。
- [ ] 沒有空密碼帳號；不用 `password_expired` 欄判斷到期（MariaDB 未實作）。
- [ ] `require_secure_transport = ON`（RDS 11.8 起預設 ON，11.4 以前需手動開）；`tls_version` 不含 1.0／1.1（舊版預設仍含 1.1）。

### RDS 平台層（三引擎共用）

- [ ] `CACertificateIdentifier` 不是 `rds-ca-2019`；`CertificateDetails.ValidTill` 距今大於門檻（建議 90 天，與 RDS 掛出輪替動作的 3 個月對齊）。
- [ ] `describe-pending-maintenance-actions` 沒有逾期的 `server-certificate-rotation`。
- [ ] 參數群組不是 `default.*`（否則無法收斂 TLS 與密碼參數）；`ParameterApplyStatus` 不是 `pending-reboot`。**[推論]**
- [ ] 若組織政策要求 IAM 驗證，`IAMDatabaseAuthenticationEnabled = true`，且應用帳號是 `rds_iam` 成員或 `AWSAuthenticationPlugin`。
- [ ] `PubliclyAccessible = false`、`StorageEncrypted = true`、`MasterUserSecret` 存在（由 Secrets Manager 管理）。

## 七、未決與待核

- PG：`rds_superuser` 是否為 `pg_read_all_stats` 成員、能否讀 `pg_hba_file_rules`，官方只說它「可透過 `pg_stat_activity` 取得所有連線狀態」。需在實例上以 `pg_has_role('rds_superuser','pg_read_all_stats','MEMBER')` 驗證。
- PG：`pg_has_role` 的 `SET` 模式與 `pg_auth_members` 新欄位的起始版本（推測 16），以 15／16 文件對照確認。
- MySQL：`SHOW CREATE USER` 與 `information_schema.*_PRIVILEGES` 對他人帳號的權限需求；上游 `require_secure_transport` 對 socket 的豁免原文。
- MariaDB：`mysql.user` 改為視圖的版本、`global_priv.Priv` 是否含 `password_lifetime` 鍵、10.5 起 SUPER 拆分的細權限清單、`performance_schema.threads.CONNECTION_TYPE` 是否存在、RDS for MariaDB 上 `AWSAuthenticationPlugin` 帳號的實際 `plugin` 值。
- 平台層：IAM 動作名稱與 `--enable-iam-database-authentication` 旗標以 IAM Service Authorization Reference 與 CLI 參考再核。
- 以上 SQL 都未在實際資料庫上執行（本票限制：不執行資料庫或 AWS 指令），交付給 Skill 前應各在 PG 15／16、MySQL 8.0／8.4、MariaDB 10.11／11.4 跑過一次。
