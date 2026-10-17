# DBA 系統視圖唯讀實測（#240）

狀態：**partial**。本次完成可用本機環境的實測與缺口整理；不是所有研究查詢皆可執行，
也不是 DBA Role Skill、RDS 或最小原生權限的驗收通過。

## 範圍與證據

依 [#240](https://github.com/CarlLee1983/dbcli/issues/240)，逐項整理前三份研究的具體 SQL，
固定 dbcli `query-only`、`DBCLI_AGENT_MODE=1` 與非空 blacklist。
查詢原文、來源檔案與行號、完整命令參數、exit code、stdout、stderr 都保存在
[evidence.json](dba-system-view-probes/evidence.json)。`Q` 是研究查詢編號，`C` 是環境控制，
`O` 是實際命令觀察；ID 是整理證據時配置，不代表執行時間順序。
每個 case 的 `scopedSchema` 記錄其查詢前成功的 schema，重現程式也先執行這些前置步驟。
同一查詢的重複來源合併，SQL fence 的行號指向該區塊開頭。

來源固定為以下版本，而非會移動的分支：

- [備份與 PITR](https://github.com/CarlLee1983/dbcli/blob/e0fdaf58770690ca593c6d431ce3121fe9559836/docs/research/backup-pitr-signals.md)
- [Replication／HA](https://github.com/CarlLee1983/dbcli/blob/103c29f82807efb35d0bcd8a4c7b4ba63ef0f113/docs/research/replication-ha-signals.md)
- [原生權限與 TLS](https://github.com/CarlLee1983/dbcli/blob/62775eb196d2a7e32f0e5cf12b256b3a7379587d/docs/research/native-privileges-tls-audit.md)

本次不重做前三份外部文件研究；版本支援與權限的結論，只依本次命令觀察或明示的本 repo 原始碼推論。
修改範圍僅本研究報告、去敏證據與重現程式；未改工具規則、DB grant、資料、replication 或雲端資源。

## 環境與隔離

- 日期：2026-10-17；dbcli commit `2f8dfc605a3e7a73a639943026ab1642337c5f0a`，Bun `1.4.2`。
- 本 repo `docker-compose.test.yml` 的既有容器；Docker labels 指向本 repo 與該 compose 檔。
- 版本由真實 dbcli 查詢取得：PostgreSQL `16.11`、MySQL `8.4.8`、MariaDB `11.8.8`。
- 僅使用 compose 已公開的 `dbcli` 測試帳號與本機端口 5433／3307／3308。
  PostgreSQL `SHOW is_superuser` 為 `on`；MySQL／MariaDB `SHOW GRANTS` 顯示測試資料庫的
  `ALL PRIVILEGES` 與全域 `USAGE`。**CLI query-only 不等於原生帳號最小權限**。
- 暫存 `.dbcli` 由既有 `writeConfigWithIntegrity` 建立，沿用
  `tests/integration/schema-cache-agent-mode.test.ts` 的測試 fixture 做法。
  CLI 子程序使用 allowlist 環境、獨立 HOME／config home、`--no-env-file`；不繼承使用者連線或憑證。
  設定建立後，每次實測皆啟用 agent mode；未改使用者的設定。
- baseline database 為 `dbcli_test`。另以同一帳號建立獨立暫存設定，把 default database 指向
  `information_schema`、`mysql` 或 `performance_schema`，只為驗證 schema 前置條件，沒有提高權限。
- baseline blacklist：表 `pg_authid`、`pg_catalog.pg_authid`、`mysql.global_priv`；
  所有表的欄位 `password`、`rolpassword`、`authentication_string`、`Priv`。
  每個設定先跑 `blacklist list`；既有內建 SQL 保護及原生唯讀執行路徑保持生效。
- audit 在暫存 fixture 關閉；本次不驗證 audit。schema 的衍生快取只寫入暫存 fixture。

## 驗收與觀察摘要

| 檢查 | 命令／證據 | 觀察 |
| --- | --- | --- |
| 模式與 capability | 三引擎 `capabilities check --require schema.read,query.read --format json` | 都回 `permission=query-only`、`agentMode=true`、兩 capability `available`。這不承諾任意系統 schema 都可讀。 |
| schema 先行 | 每筆 case 的 `observations` 與 `scopedSchema` | schema 無法確認的表查詢不繼續執行；沒有補造欄位或快取。 |
| 表 blacklist | 兩引擎 `blacklistControls` 的 table 組 | 已確認的 `information_schema.TABLES` 加入表 blacklist 後，SELECT exit 1，訊息 `is blacklisted for SELECT operations`。 |
| 欄位 blacklist | 兩引擎 `blacklistControls` 的 column 組 | `USER_PRIVILEGES.GRANTEE` 被移除，仍有 1 列其他欄位；`securityNotification` 明示省略 1 欄。 |
| 查詢清單 | 94 筆實質研究 case，另保留 9 筆摘要／不完整片段供追溯 | 30 成功、15 查詢失敗、32 schema 前置檢查受阻、17 未執行。另有 2 筆環境控制，不混入研究通過數。 |
| 來源與輸出 | 固定 commit、來源 sha256、139 個去重的命令觀察 | 可依 ID 查回命令與輸出；成功包含空集合，不證明角色／replica／備份健康。 |

17 筆未執行包括缺少實際目標／GTID 的範例、敏感來源與 RDS／extension 前置條件。
94 筆是研究中的具體命令或待具體化範例，不代表 94 個不同 capability。

## 確認的工具限制與待決事項

### G1：系統 schema 的前置確認受限

`schema pg_roles` 回 `Table 'public.pg_roles' not found`；
`schema pg_catalog.pg_roles` 回 `Table 'public.pg_catalog.pg_roles' not found`。
PostgreSQL introspection 固定 `table_schema = 'public'`
（[postgresql-adapter.ts](../../src/adapters/postgresql-adapter.ts)，`getTableSchema`，263–302 行）。
因此本次未執行相關 catalog／stats 查詢，不能把它們寫成 query.read 拒絕或資料庫缺少該 view。
研究採用較新 PostgreSQL 文件的 slot 欄位，在本機 16.11 是否存在也尚未實測確認。

MySQL／MariaDB `schema information_schema.TABLES` 在 `dbcli_test` 失敗，
因 introspection 以 `TABLE_SCHEMA=DATABASE()` 加 literal `TABLE_NAME` 查找
（[mysql-adapter.ts](../../src/adapters/mysql-adapter.ts)，301–319 行）。
同帳號、default database 改為 `information_schema` 後，`schema TABLES` 成功，
再由 baseline 設定執行原始 SQL 成功。Q022、Q023、Q075–Q078 共六筆完成此路徑；
這是獨立設定 context 的 workaround，不是跨 schema 參數已受支援。

候選 Story：讓 schema 正確表達並讀取引擎允許的系統 schema／qualified relation，
明確區分不存在與無權存取，並維持 blacklist 與 agent-mode 邊界。需另行核准。

### G2：原生權限與 AUTH_FAILED 的歸因需區分

MySQL `SHOW BINARY LOGS`、`SHOW REPLICA STATUS` 等回原生權限要求；
MariaDB 對應命令回 `BINLOG MONITOR`／`SLAVE MONITOR` 等權限要求。
這些查詢已抵達資料庫，不是 dbcli 把 SHOW 一律擋下。

同帳號可連 `dbcli_test`，但以 `mysql`／`performance_schema` 為 default database
的 schema 嘗試回 `AUTH_FAILED` 與「check your username or password」。
[error-mapper.ts](../../src/adapters/error-mapper.ts) 的 74–89 行把
`ER_DBACCESS_DENIED_ERROR`／1044 與登入驗證錯誤一起映射成 `AUTH_FAILED`。
**推論**：觀察與 default database 存取權不足一致；本次未保存原始 driver errno，
不能宣稱這些個案已直接觀察到 1044。也不能據此要求使用者更換正確的帳密。

候選 Story：將資料庫授權不足與登入驗證失敗區分；原生監控權限的授予則屬環境前置條件，
本次不自動授權或切換 root。

### G3：MariaDB SHOW GRANTS 的文字可能含憑證材料

C002 在 baseline blacklist 下 exit 0；授權文字的欄名是 `Grants for dbcli@%`，
其內容包含 `IDENTIFIED BY PASSWORD` 與測試密碼雜湊。上述 password 欄名規則沒有遮掉它。
[blacklist-validator.ts](../../src/core/blacklist-validator.ts) 的欄位過濾依回傳欄名／路徑匹配，
不是任意文字內容的秘密偵測。此結果不代表表 blacklist 或欄位省略失效。

分享證據中已由研究程式把雜湊替換成 `<REDACTED_FIXTURE_PASSWORD_HASH>`；
**這是保存證據時的去敏，不是 dbcli 原生輸出已去敏。** 原始雜湊不納入 repo。
後續工作流程不宜直接收錄原始 MariaDB grant 文字；結構化投影或專用遮罩需要獨立規格與審查。

### G4：RDS 唯讀程序的 #241 決策仍成立

Q024／Q025 在本機 MySQL／MariaDB 的 query-only 設定皆回：

```text
Unrecognised SQL statement (current level: query-only). Security policy requires admin for unknown statements.
```

預設與 `--no-limit` 均遭拒。這證明 dbcli 在此條件下拒絕該 CALL，
**未證明本機或 RDS 上程序存在、原生帳號可呼叫、或平台 API 可提供等價資訊**。
[#241](https://github.com/CarlLee1983/dbcli/issues/241) 應據此討論允許清單、平台替代或人工交接，
不把本次實測當作放寬 query-only 的授權。

## 環境限制，不是工具缺口

- Q042 在 primary 回 `recovery is not in progress`；不能把 standby-only 函式在 primary 失敗當成 dbcli 缺陷。
- Q055 的舊 `SHOW MASTER STATUS` 在 MySQL 8.4.8 回語法錯誤；它是原研究明示的舊版本語法。
- MySQL／MariaDB 本連線 TLS 查詢成功，但 cipher/version 為空；只證明此測試連線沒有 TLS，
  不證明 RDS TLS、所有連線 TLS 或 CA 到期稽核已完成。
- SQL 有空結果、null 或只顯示自身權限時，保留原結果，不推導環境健康或資料完整。
- 沒有 RDS 目標／唯讀授權，未操作 AWS；沒有配置 replica topology、PITR 或還原演練。
  未建立 extension、授予監控權限、執行 failover 或任何研究列出的 mutation。
- `CHECKSUM TABLE t`、業務表時間／摘要比對、來源 GTID 比對仍缺少具體目標或演練資料。
- 依 repo 的 schema 先行規則，32 筆表查詢在前置檢查受阻即停止；其 query 接受度仍未知。

## 重現

先確認是本 repo 的隔離測試容器；此命令不啟動容器、不改 grant、不建立資料。
測試帳密是 `docker-compose.test.yml` 的公開 fixture，不得替換為 production 憑證。

```sh
bun --no-env-file docs/research/dba-system-view-probes/reproduce.ts
```

[重現程式](dba-system-view-probes/reproduce.ts) 建立私有暫存設定、重播已執行的觀察，
以子程序固定 query-only／agent mode；不執行 manifest 中未測的 SQL。
先重播必要 schema，包括成功的 scoped schema，再重播其查詢。
原本成功的非 query 前置步驟若失敗則停止，不直接往下跑。
輸出只顯示 observation ID 與 exit code；去敏 JSON 留在列出的暫存路徑，
含帳密的 fixture 設定會清除。重現結果屬執行當時的 working tree，不覆寫原始證據。

以下以 `bun run src/cli.ts` 代表重現程式對絕對 CLI 路徑的呼叫；完整 argv、profile 與輸出見 JSON。
成功的 schema 切換例：

```text
profile mysql-information_schema: blacklist list --format json
profile mysql-information_schema: schema TABLES --format json
profile mysql-dbcli_test: query <Q022.sql> --format json --no-limit
```

## 交付檢查

- `make verify`：22 步全部通過；完整測試 `7240 pass`、`0 fail`。驗證針對本次未提交工作目錄，非合併後 CI。
- 獨立唯讀審查：無重大發現；不把部分觀察當作 #240 全部驗收完成。

- 執行重現程式：139／139 個命令觀察均已重播，exit code 與原證據相同；不要求動態列值或耗時相同。
- 檢查所有 case 的 evidence ID：皆指向存在的觀察；報告六個本地連結皆可解析。
- 搜尋交付檔案中的測試密碼雜湊模式：零筆；去敏標記保留在 C002。

## 逐項結果

SQL 原文與固定來源在 JSON 的 `cases`；下表不以失敗訊息替代完整證據。

| Case | 引擎 | 結果 | 觀察／未執行原因 | Evidence IDs |
| --- | --- | --- | --- | --- |
| Q002 | pg | schema 前置檢查受阻 | Table 'public.pg_stat_archiver' not found in database 'dbcli_test' | O017 |
| Q003 | pg | 執行成功 | rowCount=1 | O018 |
| Q004 | pg | 執行成功 | rowCount=1 | O019 |
| Q005 | pg | 執行成功 | rowCount=1 | O020 |
| Q006 | pg | 執行成功 | rowCount=1 | O021 |
| Q007 | pg | 執行成功 | rowCount=1 | O022 |
| Q008 | pg | 執行成功 | rowCount=1 | O023 |
| Q009 | pg | schema 前置檢查受阻 | Table 'public.pg_ls_archive_statusdir' not found in database 'dbcli_test' | O024 |
| Q010 | pg | schema 前置檢查受阻 | Table 'public.pg_ls_waldir' not found in database 'dbcli_test' | O025 |
| Q011 | pg | schema 前置檢查受阻 | Table 'public.pg_replication_slots' not found in database 'dbcli_test' | O026 |
| Q012 | pg | 執行成功 | rowCount=1 | O027 |
| Q013 | mysql | 執行成功 | rowCount=1 | O028 |
| Q014 | maria | 執行成功 | rowCount=1 | O029 |
| Q015 | mysql | 執行遭拒／失敗 | Database error (ER_SPECIFIC_ACCESS_DENIED_ERROR): Access denied; you need (at least one of) the SUPER, REPLICATION CLIENT privilege(s) for this operation | O030, O031 |
| Q016 | maria | 執行遭拒／失敗 | Database error (ER_SPECIFIC_ACCESS_DENIED_ERROR): Access denied; you need (at least one of) the BINLOG MONITOR privilege(s) for this operation | O032, O033 |
| Q017 | mysql | 執行遭拒／失敗 | Database error (ER_SPECIFIC_ACCESS_DENIED_ERROR): Access denied; you need (at least one of) the SUPER, REPLICATION CLIENT privilege(s) for this operation | O034, O035 |
| Q018 | maria | 執行遭拒／失敗 | Database error (ER_SPECIFIC_ACCESS_DENIED_ERROR): Access denied; you need (at least one of) the BINLOG MONITOR privilege(s) for this operation | O036, O037 |
| Q019 | mysql | 執行成功 | rowCount=1 | O038 |
| Q020 | mysql | 執行成功 | rowCount=1 | O039 |
| Q021 | maria | 執行成功 | rowCount=1 | O040 |
| Q022 | mysql | 切換 schema context 後成功 | rowCount=0 | O006, O103, O104 |
| Q023 | maria | 切換 schema context 後成功 | rowCount=0 | O009, O105, O106 |
| Q024 | mysql | 執行遭拒／失敗 | Unrecognised SQL statement (current level: query-only). Security policy requires admin for unknown statements. If this is a legitimate read-only statement, please open an issue at https://github.com/CarlLee1983/dbcli/issues. | O041, O042 |
| Q025 | maria | 執行遭拒／失敗 | Unrecognised SQL statement (current level: query-only). Security policy requires admin for unknown statements. If this is a legitimate read-only statement, please open an issue at https://github.com/CarlLee1983/dbcli/issues. | O043, O044 |
| Q030 | mysql | 執行遭拒／失敗 | Database error (ER_SPECIFIC_ACCESS_DENIED_ERROR): Access denied; you need (at least one of) the SUPER, REPLICATION CLIENT privilege(s) for this operation | O045, O046 |
| Q031 | maria | 執行遭拒／失敗 | Database error (ER_SPECIFIC_ACCESS_DENIED_ERROR): Access denied; you need (at least one of) the SLAVE MONITOR privilege(s) for this operation | O047, O048 |
| Q032 | pg | 未執行 | placeholder-or-incomplete-example | — |
| Q033 | mysql | 未執行 | placeholder-or-incomplete-example | — |
| Q034 | maria | 未執行 | placeholder-or-incomplete-example | — |
| Q035 | mysql | 未執行 | placeholder-or-incomplete-example | — |
| Q036 | maria | 未執行 | placeholder-or-incomplete-example | — |
| Q037 | pg | 未執行 | placeholder-or-incomplete-example | — |
| Q038 | pg | 執行成功 | rowCount=1 | O049 |
| Q039 | pg | schema 前置檢查受阻 | Table 'public.pg_stat_replication' not found in database 'dbcli_test' | O050 |
| Q040 | pg | schema 前置檢查受阻 | Table 'public.pg_stat_wal_receiver' not found in database 'dbcli_test' | O051 |
| Q041 | pg | schema 前置檢查受阻 | Table 'public.pg_stat_replication' not found in database 'dbcli_test' | O050 |
| Q042 | pg | 執行遭拒／失敗 | Database error (55000): recovery is not in progress | O052, O053 |
| Q043 | pg | schema 前置檢查受阻 | Table 'public.pg_replication_slots' not found in database 'dbcli_test' | O026 |
| Q044 | mysql | 執行遭拒／失敗 | Database error (ER_SPECIFIC_ACCESS_DENIED_ERROR): Access denied; you need (at least one of) the REPLICATION SLAVE privilege(s) for this operation | O054, O055 |
| Q045 | mysql | 執行成功 | rowCount=1 | O056 |
| Q046 | mysql | schema 前置檢查受阻 | Table 'performance_schema.replication_connection_status' not found in database 'dbcli_test' | O057, O107 |
| Q047 | mysql | schema 前置檢查受阻 | Table 'performance_schema.replication_applier_status_by_worker' not found in database 'dbcli_test' | O058, O108 |
| Q048 | mysql | 執行成功 | rowCount=1 | O059 |
| Q049 | mysql | 未執行 | placeholder-or-incomplete-example | — |
| Q050 | mysql | 未執行 | placeholder-or-incomplete-example | — |
| Q051 | maria | 執行遭拒／失敗 | Database error (ER_SPECIFIC_ACCESS_DENIED_ERROR): Access denied; you need (at least one of) the SLAVE MONITOR privilege(s) for this operation | O060, O061 |
| Q052 | maria | 執行遭拒／失敗 | Database error (ER_SPECIFIC_ACCESS_DENIED_ERROR): Access denied; you need (at least one of) the BINLOG MONITOR privilege(s) for this operation | O062, O063 |
| Q053 | maria | 執行成功 | rowCount=1 | O064 |
| Q055 | mysql | 執行遭拒／失敗 | SQL syntax error: You have an error in your SQL syntax; check the manual that corresponds to your MySQL server version for the right syntax to use near 'MASTER STATUS' at line 1 | O065, O066 |
| Q056 | mysql | 執行成功 | rowCount=0 | O067 |
| Q057 | maria | 執行遭拒／失敗 | Database error (ER_SPECIFIC_ACCESS_DENIED_ERROR): Access denied; you need (at least one of) the SLAVE MONITOR privilege(s) for this operation | O068, O069 |
| Q058 | maria | 執行遭拒／失敗 | Database error (ER_SPECIFIC_ACCESS_DENIED_ERROR): Access denied; you need (at least one of) the REPLICATION MASTER ADMIN privilege(s) for this operation | O070, O071 |
| Q059 | pg | schema 前置檢查受阻 | Table 'public.pg_roles' not found in database 'dbcli_test' | O003 |
| Q060 | pg | schema 前置檢查受阻 | Table 'public.pg_roles' not found in database 'dbcli_test' | O072, O003 |
| Q061 | pg | schema 前置檢查受阻 | Table 'public.pg_roles' not found in database 'dbcli_test' | O003 |
| Q062 | pg | schema 前置檢查受阻 | Table 'public.pg_roles' not found in database 'dbcli_test' | O003 |
| Q063 | pg | schema 前置檢查受阻 | Table 'public.pg_roles' not found in database 'dbcli_test' | O003 |
| Q064 | pg | schema 前置檢查受阻 | Table 'public.pg_roles' not found in database 'dbcli_test' | O003 |
| Q065 | pg | schema 前置檢查受阻 | Table 'public.pg_namespace' not found in database 'dbcli_test' | O073, O074 |
| Q066 | pg | schema 前置檢查受阻 | Table 'public.pg_namespace' not found in database 'dbcli_test' | O074 |
| Q067 | pg | schema 前置檢查受阻 | Table 'public.pg_database' not found in database 'dbcli_test' | O075 |
| Q068 | pg | schema 前置檢查受阻 | Table 'public.pg_namespace' not found in database 'dbcli_test' | O076, O074 |
| Q069 | pg | schema 前置檢查受阻 | Table 'public.pg_stat_ssl' not found in database 'dbcli_test' | O077 |
| Q070 | pg | schema 前置檢查受阻 | Table 'public.pg_stat_activity' not found in database 'dbcli_test' | O077, O078 |
| Q071 | pg | schema 前置檢查受阻 | Table 'public.pg_settings' not found in database 'dbcli_test' | O079 |
| Q072 | mysql | schema 前置檢查受阻 | Table 'mysql.user' not found in database 'dbcli_test' | O080, O109 |
| Q073 | mysql | schema 前置檢查受阻 | Table 'mysql.role_edges' not found in database 'dbcli_test' | O081, O110 |
| Q074 | mysql | schema 前置檢查受阻 | Table 'mysql.default_roles' not found in database 'dbcli_test' | O082, O111 |
| Q075 | mysql | 切換 schema context 後成功 | rowCount=1 | O083, O112, O113 |
| Q076 | mysql | 切換 schema context 後成功 | rowCount=18 | O084, O114, O115 |
| Q077 | mysql | 切換 schema context 後成功 | rowCount=0 | O085, O116, O117 |
| Q078 | mysql | 切換 schema context 後成功 | rowCount=0 | O086, O118, O119 |
| Q079 | mysql | schema 前置檢查受阻 | Table 'mysql.global_grants' not found in database 'dbcli_test' | O087, O120 |
| Q080 | mysql | 執行成功 | rowCount=2 | O088 |
| Q081 | mysql | schema 前置檢查受阻 | Table 'information_schema.processlist' not found in database 'dbcli_test' | O089, O090, O121, O122 |
| Q082 | mysql | 執行成功 | rowCount=2 | O091 |
| Q083 | mysql | schema 前置檢查受阻 | Table 'mysql.user' not found in database 'dbcli_test' | O080, O109 |
| Q084 | maria | schema 前置檢查受阻 | Table 'mysql.user' not found in database 'dbcli_test' | O092, O123 |
| Q085 | maria | 未執行 | sensitive-source-protected | — |
| Q086 | maria | schema 前置檢查受阻 | Table 'mysql.roles_mapping' not found in database 'dbcli_test' | O093, O124 |
| Q087 | maria | 執行成功 | rowCount=2 | O094 |
| Q088 | maria | 執行成功 | rowCount=2 | O095 |
| Q089 | maria | schema 前置檢查受阻 | Table 'mysql.user' not found in database 'dbcli_test' | O092, O123 |
| Q091 | pg | 執行成功 | rowCount=1 | O096 |
| Q092 | pg | 未執行 | requires-rds-or-extension | — |
| Q093 | pg | 未執行 | requires-rds-or-extension | — |
| Q094 | pg | 未執行 | sensitive-source-protected | — |
| Q095 | pg | 未執行 | requires-rds-or-extension | — |
| Q096 | mysql | 未執行 | placeholder-or-incomplete-example | — |
| Q097 | mysql | 未執行 | sensitive-source-protected | — |
| Q098 | mysql | 執行成功 | rowCount=2 | O097 |
| Q099 | mysql | 未執行 | requires-rds-or-extension | — |
| Q102 | pg | 未執行 | requires-rds-or-extension | — |
| Q103 | mysql | 執行成功 | rowCount=1 | O125 |

## Issue #240 回填草稿（尚未發布）

本機實測已整理於 `docs/research/dba-system-view-probes.md` 與同名目錄的去敏證據／重現程式，
目前狀態 **partial**，不建議關閉 #240。固定 query-only、agent mode 與非空 blacklist，
94 筆實質研究項目為 30 成功、15 查詢失敗、32 schema 前置檢查受阻、17 未執行。
139 個命令觀察已重播，exit code 全部一致；本地 `make verify` 22 步通過，7240 tests pass。

工具缺口：系統 schema introspection 受限；系統資料庫的存取拒絕被映射成 AUTH_FAILED；
MariaDB SHOW GRANTS 的授權文字含測試密碼雜湊，欄名 blacklist 未遮蔽內文（保存證據已另行去敏）。
RDS 唯讀 CALL 在本機已確認被 query-only 拒絕，供 #241 決策使用。

未驗證 RDS、replica／還原演練、最小原生監控權限及缺少目標的範例；
不修改 dbcli 權限邊界、不提高 DB grant，也不把 schema 受阻寫成 query.read 已拒絕。
建議下一張 Warrant Story 先處理系統 schema 的正確前置確認，其餘缺口分開規格化。
