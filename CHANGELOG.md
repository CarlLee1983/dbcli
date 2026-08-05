# Changelog

All notable changes to dbcli are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

決策記錄：`docs/adr/0003-connection-timeout-override-resolved-at-adapter-construction.md`。

### Added

- **新的 root-level 全域旗標 `--timeout <ms>`。** 覆寫連線設定中的 `timeout`；兩者都沒有時沿用各 adapter 內建的 5000ms。合法值為 100～600000 的整數，須放在子指令之前（和 `--global` / `--use` 一樣是 root-level flag）。對所有引擎有效，典型用途是 MongoDB 跨 VPN 或連 Atlas 時，預設 5 秒的 server selection timeout 太緊：`dbcli --timeout 20000 --use <conn> list`。這個覆寫只在建立連線時套用，不會寫回設定檔；要永久生效請在連線設定裡寫 `timeout` 欄位。
- **連線設定檔新增 `timeout` 欄位。** 四種連線 schema 皆支援，毫秒、100～600000 整數、可省略。

### Changed

- **設定檔驗證失敗的錯誤訊息改為可讀格式。** 過去會吐出整包 Zod `unionErrors` 巢狀 JSON；現在只列出與該連線 `system` 相符的分支問題，逐欄列出欄位路徑。
- **文件明確禁止 `2>&1`。** 診斷訊息走 stderr、結果走 stdout，合併兩者會讓 `--format json` 的輸出無法解析；SKILL 與 reference 都補上導管寫法。

## [1.46.0] - 2026-08-04 - MongoDB 逐欄連線設定

決策記錄：`docs/adr/0002-mongodb-connection-field-first-config.md`；規格：`docs/specs/2026-08-04-mongodb-field-first-connection.md`。

### Changed

- **⚠️ BREAKING（互動流程）：`dbcli init` 對 MongoDB 改為先問「連線設定方式」。** 過去第一個提問是 MongoDB URI，留空才退回逐欄詢問 —— 於是逐欄路徑事實上沒人走，所有文件也只教「整條 URI 貼進去」。現在預設是「逐欄填寫」，貼 URI 降為明示的進階選項。**設定檔格式向下相容**，既有含 `uri` 的設定不需修改；`--uri`、`--no-interactive` 等非互動用法行為完全不變，只有互動提問的順序改變。
- **逐欄模式在有帳號時會明確寫出 `authSource`。** 過去只有帶 `--auth-source` 才會（而且寫了也會被 schema 丟掉），現在未指定時會寫入 `admin`。連線結果與過去等價（adapter 本來就以 `admin` 為預設），但設定檔內容會多這一行 —— 包含 `--no-interactive` 的既有腳本。
- **`uri` 與逐欄欄位仍是 `uri` 優先，但不再靜默。** 兩者同時存在時 `dbcli doctor` 會發出 warning 指出逐欄值被忽略；`srv: true` 又指定非預設 `port` 也會 warning。這兩種設定過去都是「改了欄位卻沒生效」而無從診斷。

### Added

- **MongoDB 連線設定新增 `authSource` / `replicaSet` / `tls` / `srv` 四個欄位。** 過去這些選項只能塞進 `uri` 的 query string —— 這正是逐欄路徑不堪用的根因。其中 `authSource` 更微妙：runtime 型別與 `init --auth-source` flag 都存在，但 zod schema 沒有此鍵，`z.object` 會 strip 掉未知欄位，於是它落盤即遺失，只有 init 當下那次連線測試吃得到，等同一個死 flag。`srv: true` 會組出 `mongodb+srv://` 並沿用既有的 DNS SRV 展開（含 DoH fallback），讓 Atlas 這類最常見的雲端場景也能逐欄設定。`authSource` 與 `replicaSet` 支援 `{"$env": "..."}` 參照。
- **MongoDB 逐欄分支支援 `--use-env-refs`。** 過去 mongo 在 init 的 early-return 發生在 env-ref 分支之前，想用環境變數參照只能手改 `config.json`。現在五個 `--env-*` 旗標對 mongo 全部生效，密碼不必明文落盤。與 SQL 路徑的差異：mongo 只要求 `--env-host`，其餘留空即寫入字面值而不產生 `$env` —— 因為未定義的 `$env` 會讓之後每一個指令 fail closed，對無認證連線而言那是壞掉的設定。env-ref 模式同樣跳過連線測試（參照此時還沒有值可連），與 SQL 路徑一致。
- **連線失敗訊息按成因分類。** 認證失敗提示檢查 `authSource`（並說明 Atlas 與多數自架環境為 `admin`）、DNS/SRV 解析失敗提示 `srv` 設定與網路 DNS、TLS 握手失敗提示 `tls` 欄位與自簽憑證情境。原本三種情況共用同兩條泛用訊息。

### Fixed

- **逐欄模式的連線字串跳脫不完整。** `buildUri()` 原本只對 `password` 做 `encodeURIComponent`，`user` 與 `database` 直接字串拼接 —— 帳號含 `@`、資料庫名含 `/` 都會讓 driver 把 authority 切在錯的位置。現在三者一致跳脫，`host` 則改為驗證不含 `/@?#` 並在違反時明確報錯。
- **`host` 為空字串或含埠號、空白時會產出壞掉的連線字串。** `mongodb://:27017/db` 與 `mongodb://h:1234:27017/db` 過去都會被送進 driver，換來一個難懂的錯誤。現在在組字串前就擋下並說明埠號該填在 `port` 欄位。IPv6 位址需加方括號（`[::1]`），與 driver 的要求一致 —— 未加方括號的 `::1` 過去會組出 `mongodb://::1:27017/db`。同理 `authSource` 為空字串時會退回 `admin`，不再送出 `authSource=`。
- **連線失敗分類會被連線字串本身誤導。** driver 的錯誤訊息經常回吐原始 URI，而 `mongodb+srv://` 與這次新增的 `?tls=true` 正好含有 `SRV` 與 `TLS` 字樣 —— 用裸字串比對會讓一個單純的連線被拒歸類成 DNS 或 TLS 問題。改為優先讀 driver 的結構化 error code，訊息比對則收斂成 driver 實際會產生的片語。
- **只填 `user` 沒填 `password` 會靜默降級成無認證連線。** 原本的 `if (user && password)` 在密碼缺漏時直接落到無認證分支，錯誤會延後到伺服器端才浮現、且看起來像是權限問題。現在直接拋 `ConnectionError`，訊息說明補上密碼或一併清空 `user`。

## [1.45.1] - 2026-08-04 - Windows 上的 agent mode 修復

### Fixed

- **agent mode 在 Windows 上拒讀自己寫出來的 config。** `assertAgentReadableFile` 以 `(mode & 0o022) !== 0` 判斷 group/world-writable，但 Windows 的 `stat()` 回的是合成 mode —— 一般可寫檔一律 `0o666`，設了 read-only 位元才 `0o444`，低位元沒有 group/world 語意，`chmod` 也只能切換 read-only。結果 `DBCLI_AGENT_MODE=1` 時，Windows 上連 dbcli 剛寫入的 config 都被拒絕，agent 模式實際不可用（1.45.0 已含此問題）。同檔的 `bestEffortSecureMode` 註解早已寫明「Windows 沒有 POSIX mode bits，靠 content hash 保護」，這次把 assert 端對齊該立場：mode 檢查抽成 `refusesGroupOrWorldWritable(mode, platform)`，win32 放行，POSIX 行為不變。竄改偵測比對的是寫入時記錄的 content hash，與 mode 無關，因此安全性不受影響。連帶修好 2 個 config-binding tampering 測試 —— 同一根因：binding 讀取前先過這道閘門，拋出的是 writable 錯誤而非預期的 tampering 錯誤。

### Changed

- **移除 schema loader 的牆鐘時間斷言。** `initialize` 的 `loadTime < 200ms` 跑在阻擋性的 `bun test` 裡，但共用 CI runner 不是量測儀器（Windows 冷啟動 270ms 就紅，程式本身無異常）。改為斷言合約（有量到並回報 loadTime），時間預算歸 `tests/perf/*.bench.ts` —— CI 對該套件本來就設 `continue-on-error`，正因為 timing 依環境而定。
- **`docs/security-threat-model.md` 補上平台差異。** POSIX 用 `0o700`/`0o600` 保護設定，Windows 沒有等價 mode bits，機密性靠 profile ACL；竄改偵測兩邊一致。
- 這兩項修復讓 `windows-latest` CI job 自 v1.40.0 以來首次通過（6 個 matrix job + docs-parity 全綠）。

## [1.45.0] - 2026-08-04 - root-level `--global`：跨專案共用的 user-global registry

### Added

- **root-level `--global` 旗標。** 原本每條連線都綁在專案上：`init` 會在 `./.dbcli/config.json` 寫 binding stub，真正的設定落在 `~/.config/dbcli/projects/<project-id>/`。要在多個專案共用同一條連線，只能在每個 repo 重跑一次 `init`，或手動複製設定。`--global` 讓 `~/.config/dbcli/config.json` 成為一個獨立的 v2 registry：`dbcli --global init --conn-name shared ...` 直接寫進去、不建立也不修改專案 binding，`dbcli --global use --list` / `--global query` 則在不依賴當前目錄的情況下操作它。scope 必須明確選取 —— 未帶 `--global` 時一切照舊走專案 binding，避免在不相關的專案裡誤用全域連線。全域檔案沿用與 home storage 專案設定相同的私有檔案權限與 integrity record。
- **`getDbcliConfigHome()` / `getGlobalConfigPath()` / `isGlobalConfigPath()` 加入 `public.ts`。** 前者把 per-user root 改為延遲解析並支援 `DBCLI_CONFIG_HOME` 覆寫，測試與 embedder 不必 reload module 就能隔離 config home。

### Changed

- **`migrate` 與 `queries` 子指令補上 Commander `command` 傳遞。** 這兩處原本以 `resolveConfigPath(undefined, opts)` 解析設定路徑，看不到 ancestor 的 root-level 旗標 —— 沒有 `--global` 時症狀被 `.dbcli` 預設值蓋掉，加上 `--global` 後就會靜默讀錯 registry。現在 36 個 `resolveConfigPath` 呼叫點全部傳入 command。
- **`resolveConfigPath` 的優先序明確化。** 顯式 `--config` 仍最優先（`--global --config <path>` 因此是確定的），其次是顯式 `--global`，最後才是 `.dbcli` 預設值。

## [1.44.1] - 2026-08-02 - `agent-core` 的 `loadEnvFile` 改用 node:fs，可在 Node 執行

### Fixed

- **`loadEnvFile` 不再依賴 `Bun.file`。** `./agent-core` 存在的理由是給下游 agent CLI 共用，而那些工具不一定跑在 Bun 上；`loadEnvFile` 內部呼叫 `Bun.file()`，在 Node 下直接 `ReferenceError: Bun is not defined`，使整個匯出對第一個 Node 消費者（logq）不可用。改以 `node:fs/promises` 讀檔，解析與「不覆寫既有 `process.env`」的行為完全不變；檔案不存在仍拋 `ConfigError`。其餘五個匯出本來就沒有 runtime 相依，不受影響。

### Added

- **Node runtime 契約測試。** 本 repo 的測試全部跑在 Bun 上，所以 agent-core 裡的 Bun-only 呼叫對它們是隱形的 —— 這正是這個 bug 得以發布的原因。新增的契約測試會 spawn 真正的 `node` 行程去 import 建置後的 `dist/agent-core.mjs`，逐一呼叫每個匯出。還原修正後此測試會失敗（已驗證），因此這個失敗模式不會再次出貨。

### Changed

- **同步跨平台發版 metadata。** npm package、Codex／Claude／Cursor plugin、packaged Codex plugin 與 Gemini extension 統一為 `1.44.1`。

## [1.44.0] - 2026-08-02 - agent-core 補上錯誤型別與 env reference 型別

### Added

- **`./agent-core` 匯出 `ConfigError` 與 `EnvReference`。** 下游工具原本無法用 `instanceof` 判別 env reference 解析失敗，只能比對錯誤訊息字串；也無法引用 `{ $env: string }` 的型別名稱，只能各自重複定義一個結構相同的介面。兩者都是既有模組早已匯出、只是沒有出現在 `public.ts` 的疏漏。runtime interface 因此從五項變六項，型別從三項變四項，皆為加法變更。

## [1.43.0] - 2026-08-02 - Agent Core、查詢完整性與跨平台修復

### Added

- **穩定的 `./agent-core` 子路徑匯出。** 以五個 runtime functions（env 載入、env reference、連線選取、名稱解析、lookahead 截斷）與三個型別形成 agent CLI 共用的 semver interface；`./core` 仍是 dbcli 專用介面。建置同時產出 ESM 與型別宣告，CI purity gate 禁止資料庫、adapter 或 CLI framework 相依滲入。
- **欄位投影 `--fields`。** SQL 與 MongoDB 通用；`--fields a,b` 取用、`--fields=-raw_response` 排除，兩種形式不可混用。MongoDB 會把 `projection`（find）或 `$project`（aggregate）下推給 driver，未明確指定時不回傳 `_id`。黑名單欄位不會因為被 `--fields` 點名而洩漏。
- **欄位值截斷 `--truncate`。** table 輸出預設在 120 個 Unicode code point 截斷並標記 `…(+N chars)`，以 code point 計數所以不會切壞中文與 emoji；`--no-truncate` 可關閉。`--format json` / `csv` 會拒絕此旗標而非靜默忽略。
- **從檔案或 stdin 讀查詢 `-f, --query-file`。** `-f -` 讀 stdin，可用 heredoc 傳含 `$regex`、巢狀日期物件的 MongoDB pipeline，完全避開 shell 引號問題。同時給檔案與位置參數會明確報錯。
- **單次連線指定。** 新增 `DBCLI_CONNECTION` 環境變數，`query` / `list` / `schema` / `export` / `check` 也接受子指令層級的 `--use`。優先序為 `--use` > `DBCLI_CONNECTION` > 儲存的預設值，兩者都不會改寫 `.dbcli/config.json`，因此平行執行不會互相污染。
- **唯讀多連線扇出 `--use a,b`。** 同一查詢對多個連線執行，JSON 回傳 `results` 陣列並逐一標示 `ok` / `error`，table 則分段標註連線名。單一連線失敗不會取消其他連線。彙總 exit code：全成功 `0`、部分失敗 `2`、全失敗或執行前拒絕 `1`。寫入語句、`--recovery`、`--ui` 與 CSV/HTML 輸出在扇出下一律拒絕。

### Changed

- **HTML dashboard 明示不完整與遮蔽結果。** `query`、`q` 與 HTML export 會把既有的截斷與 security metadata 傳入 dashboard；在 KPI、圖表與 raw table 之前顯示醒目提示，避免使用不完整資料得出結論。
- **截斷改為出現在結果本身。** dbcli 擁有的 row cap 會多取一列前瞻，因此能區分「剛好 N 筆」與「被砍到 N 筆」：table footer 顯示 `Rows: N (truncated; limit N)`、`--format json` 帶 `metadata.truncated` 與 `metadata.limit_applied`、CSV 附加 `# truncated; limit N` 註解行。`dbcli q` 的 snippet size guard 同樣依此回報，不再讓整數列數被誤讀為全集。
- **`dbcli export` 撞到 auto-limit 改為 fail closed。** 匯出檔沒有地方記錄資料被丟掉（jsonl 是一行一筆、MongoDB `--format json` 是裸陣列），stderr 警告又會在重導向後消失，因此改為 exit `1` 且不寫檔，要求以 `--no-limit` 或 `--limit N` 明確表態。Elasticsearch 匯出的 1000 筆上限同此處理。
- **CLI 錯誤輸出收斂。** 連線類錯誤在所有指令路徑都會被頂層 handler 攔截並格式化，stderr 首行即為人類可讀訊息，不再由 Bun 印出打包後的 code frame 與未解碼的中文跳脫序列。stack 改掛在 `-v` / `-vv` 之下，預設不輸出。

### Fixed

- **MySQL 8 schema introspection 相容預設 `ONLY_FULL_GROUP_BY`。** 外鍵查詢現在完整分組 referenced table，不再讓 `dbcli schema <table>` 在原廠預設設定下失敗。
- **已分類的連線錯誤不再被巢狀 adapter catch 重包。** `mapError` 直接保留既有 `ConnectionError` 的 identity、code、message 與 hints，消除 `Connection failed: Connection failed:` 重複前綴與分類退化。
- **stdout 管線與 Windows CI 修復。** redirected stdout 以完整同步寫入避免 64KB 截斷；測試 filesystem 與換行處理改為跨平台實作，Windows matrix 恢復全綠。
- **發布依賴安全更新。** 將 PostCSS 鎖定至 `8.5.25`、`brace-expansion` 鎖定至 `5.0.9`，清除 release gate 回報的 3 個 high-severity advisories；並統一 Prettier 格式，讓完整 9 階段發布檢查恢復全綠。
- **`--no-limit` 過去被靜默忽略。** Commander 會把 `--no-limit` 折進 `limit` 屬性（設為 `false`）而不會產生 `noLimit`，但 `query` / `q` / `export` 都讀 `options.noLimit`，導致這個旗標自始無效——`query` 仍套用 1000 筆上限，`q` 仍包 size guard。CLI 邊界現在會把 Commander 的否定形式轉回指令實際讀取的形狀。
- **`dbcli export` 的 SQL 路徑忽略 `--limit` 與 `--no-limit`。** 該分支未把選項傳給 QueryExecutor，任何 `--limit N` 都不生效。
- **`-v` / `-vv` 的 stack 開關過去對 `q` / `insert` / `update` / `delete` 無效。** 這四個指令自行輸出在地化訊息、繞過共用的錯誤呈現層，因此 verbose 對它們不會多印任何東西。改為共用同一個呈現函式：措辭維持不變，但 verbose 下會補上 stack。
- **Redis 的 size-guard warning 在 `query` 被丟棄。** adapter 早已算出 `REDIS_SIZE_TRUNCATE` / `REDIS_SIZE_REWRITE` / `REDIS_BLACKLIST_FILTERED`，但 `query` 分支完全沒讀 `result.warnings`——文件卻聲稱結果會帶 `warnings[]`。現在每則 warning 都會印到 stderr，且被裁切的回覆會回報 `truncated` / `limit_applied`，與其他引擎一致。
- **`--query-file -` 在互動式終端會無提示空等。** 改為立即拒絕並說明需要 piped input，與 repo 中其他 stdin 消費端（`insert`、`shell`、`audit`）既有的 TTY 檢查一致。
- **單一連線 (v1) 設定會靜默忽略 `--use` / `DBCLI_CONNECTION`。** v1 沒有具名連線可選，過去卻照樣執行那唯一的連線，讓使用者以為切換成功——正是 issue #7 要避免的情境。現在會明確報錯並指出升級為 v2 的方式。
- **skill assets 與 reference 補齊。** `assets/SKILL.md`、`SKILL.zh-TW.md` 與 `reference.md` 新增查詢工作流程旗標章節；`reference.md` 原本記載「MongoDB 不套用 auto-limit」與實際行為不符，已更正為套用於 filter 與未自帶 `$limit` 的 pipeline。

## [1.42.0] - 2026-07-20 - Drizzle Snapshot 與 ORM DDL 工作流擴充

### Added

- **Drizzle Kit snapshot 可直接用於 ORM drift 比對。** `dbcli diff --against-orm` 新增 Drizzle snapshot 格式偵測與 `NormalizedSchema` adapter，支援 PostgreSQL v7 snapshot 的 table、column、primary key、unique constraint、index 與 foreign key metadata。
- **TypeORM／Sequelize DDL alias。** `--orm-format typeorm`、`typeorm-ddl`、`sequelize` 與 `sequelize-ddl` 可直接走既有 DDL adapter；自動忽略 `typeorm_metadata` 與 `SequelizeMeta` bookkeeping table，並補上 source-file 使用者的可執行匯出／比對指引。

### Changed

- **ORM drift 文件完整同步。** 英文／繁體中文的 Markdown 與 HTML 使用者文件、skill assets、各平台 plugin 副本及 reference 已補上 Drizzle snapshot、TypeORM／Sequelize DDL 的格式、限制與操作範例。
- **跨平台發版 metadata 對齊。** npm package、Codex／Claude／Cursor plugin、packaged Codex plugin 與 Gemini extension 統一為 `1.42.0`。

### Fixed

- **不支援的 ORM 輸入改為 fail closed。** Drizzle snapshot 會拒絕不支援的版本／dialect、generated／identity／enum／composite primary key 等結構，以及無法無損轉換的 column default；TypeORM／Sequelize source file 則回報完整的匯出 DDL recipe，不再被 JSON／DDL fallback 誤解析。
- **Qualified ignore identity 保留完整。** ORM drift 的 ignore 比對不再把 schema-qualified identity 降成 bare table name，避免同名 table 跨 schema 時被錯誤忽略；ORM DDL alias 也會正確沿用 DDL 輸入處理與 bookkeeping ignore。

## [1.41.0] - 2026-07-19 - ORM Drift 比對與無損 Schema Identity

### Added

- **`dbcli diff --against-orm` ORM drift 比對。** 可將 Prisma schema、DDL／migration SQL 或 normalized JSON 與既有 SQL schema cache 比對；支援多檔 DDL、filesystem glob、格式自動偵測、大小寫敏感的 `--ignore` pattern，以及 JSON、table、Markdown 輸出。比對只讀本地 cache，不連線、不更新 cache，也不執行提案。
- **結構化 drift 分類與安全提案。** 報告區分 `missing_in_db`、`missing_in_orm`、`mismatch`、`unmanaged` 與 `unparsed`；只有計分後的 error 會使 drift exit code 為 `1`。可無損表達的缺漏欄位／index 會產生 shell-safe、預設 dry-run 的 `migrate` 提案，其餘情況升級至 `migration-review`。
- **`orm-drift-review` agent task pack。** 工作流依序執行 blacklist 檢查、schema cache 更新與 ORM drift JSON 比對，並要求將 dry-run DDL 與精確目標交給獨立 migration review。

### Changed

- **Schema identity 改為精確保存。** PostgreSQL schema／table 名稱不再正規化為小寫；quoted 與 unquoted identifier 依 SQL 規則解析，qualified name、ignore pattern、foreign key 與 drift output 都保留大小寫與 schema identity。
- **ORM drift 文件完整同步。** 英文／繁體中文的 Markdown 與 HTML 使用者文件、skill assets、各平台 plugin 副本及 reference 已補上格式、exit code、安全邊界與操作流程。
- **跨平台發版 metadata 對齊。** npm package、Codex／Claude／Cursor plugin、packaged Codex plugin 與 Gemini extension 統一為 `1.41.0`。

### Fixed

- **Lossy ORM drift proposal 改為 fail closed。** Schema-qualified target、dash-leading positional、無法無損表達的 index column、identity collision 與不支援語法不再輸出可能損壞的指令，而是阻擋或升級人工審查。
- **DDL／Prisma adapter identity 與語意硬化。** 多檔 DDL 共用 deterministic context，foreign key pairing、default schema resolution、table option／partition 阻擋、重複 index 去重與 Unicode code-point 穩定排序皆保留來源語意。

## [1.40.0] - 2026-07-19 - SQL Lint、安全強化與 Agent 工作流擴充

### Added

- **新增唯讀 `dbcli lint` 靜態 SQL 顧問。** 支援 inline SQL、saved query、SQL 檔案與 glob／混合批次輸入，提供 text、JSON、Markdown 輸出、最低嚴重度篩選、`--no-schema` 與 `--recovery`；指令不連線、不執行 SQL，也不會自動套用 rewrite。
- **九條結構與 schema-aware lint 規則。** 涵蓋 `SELECT *`、未錨定 `LIKE`、深度 `OFFSET`、non-sargable predicate、`OR`／subquery 改寫機會、重複 `DISTINCT` + `GROUP BY`、implicit cast，以及 `NOT IN` 右側 NULL 風險；finding 可附 confidence 標籤的草稿與 shell-safe 驗證指令。
- **MongoDB agent task packs。** 新增 `mongo-safe-backfill` 與 `mongo-schema-drift-review`，補上 MongoDB 安全回填與 schema drift 檢視工作流。

### Changed

- **Slow-query guide 納入 lint。** `guide slow-query` 現在會先安排本機靜態分析，再銜接 explain 與診斷 snippets，brief plan 也保留執行 metadata。
- **Agent 與使用者文件完整同步。** `lint` 已寫入 skill assets、platform plugin 副本及英文／繁體中文 Markdown 與 HTML 文件；GitHub Pages 產品介紹頁同步完成雙語、可及性與行動裝置導覽重構。
- **跨平台發版 metadata 對齊。** npm package、Codex／Claude／Cursor plugin、packaged Codex plugin 與 Gemini extension 統一為 `1.40.0`。

### Fixed

- **Lint 採 fail-closed 安全邊界。** 解析失敗、schema binding 不明、identifier 大小寫碰撞、CTE／derived／qualified relation 與不安全 rewrite proof 會阻擋對應建議，不再借用不可靠的 cache facts。
- **`NOT IN` NULL 分析補齊 scope 與 provenance。** 遞迴處理巢狀 SELECT、CTE、derived statement、JOIN `ON`、`WHERE`、`HAVING`、outer-join null extension、nullable 投影與 CASE／cast／aggregate，並保留正確 traversal order。
- **Lint audit／recovery 遮蔽與驗證指令硬化。** positional、global、bulk 與 `--` 後的 SQL 都會遮蔽；只有結構上已證明唯讀的 SQL 才建議 `explain --analyze`，session assignment 與 function-bearing statement 會保守退回 plain explain。

## [1.39.2] - 2026-07-03 - Windows 跨平台、skill 安裝安全與 plugin 版本對齊

> npm `1.39.1` 已於 2026-06-30 發布；本批修復在其後累積於同一版號下（npm 版本不可覆蓋），故獨立為 1.39.2 以便日後發布。

### Fixed

- **Windows 跨平台修復（Windows CI 首次全綠）。** filesystem 操作與 path 檢查改為跨平台實作、修正 `emit` 子行程 import 與殘留的 path assertion，並以 portable `node:fs` 取代僅限 unix 的 coreutils spawns。此前 Windows job 從未通過（fail-fast 總是先取消它）。
- **Skill 安裝安全強化。** 修正 output / install 旗標衝突、強化安裝安全檢查與 task 過濾條件。
- **zh-TW skill 安裝不再被誤判為永遠過期。**
- **Skill 參考修正。** 移除文件中不存在的 `blacklist add`、補回缺漏的 reference flags。

### Changed

- **文件補齊。** 明示 `--where` 僅支援等值比較、補上 Redis / Elasticsearch 寫入模型說明、記錄 home-storage 綁定並重新同步 md/html parity、對齊 config-location-policy 與實作綁定模型。
- **Plugin manifest 版本對齊。** `.claude-plugin` / `.cursor-plugin` / `.codex-plugin` 及 `plugins/dbcli-agent` 的 `plugin.json` 版本更新為 1.39.2（先前漂移在 1.37.1 / 1.31.0，未跟上主版本；`plugin:sync` / `plugin:check` 只同步 skill 內容不同步版本）。

### Internal

- CI 加入 doc / skill drift guards 並修正 release-gate 說明；新增 `reference.md` 指令覆蓋契約測試；移除失效的 `validate-skill.sh`（testing doc 改指向 `bun test`）；稽核冗餘測試改用 collision-proof token sentinel；zsh 不存在時跳過 rc-eval 測試；每檔還原 leaked spies 以修正順序相依的 CI 失敗；prettier 對齊 `q` / audit `logger` 測試。

## [1.39.1] - 2026-06-30 - Skill report dashboard routing

### Fixed

- **Dashboard 請求不再落入通用 query 路由。** 先前 dashboard / report 意圖的請求會 fall through 到一般 query 路徑；現已正確導向 dashboard 專用流程。

### Changed

- **Skill 路由補上 DB report / dashboard / HTML UI 意圖。** `assets/SKILL.md` / `assets/SKILL.zh-TW.md` 的 metadata、任務路由表、開發者速查與 HTML dashboard 範例現在明確導向 `queries search|suggest` → `queries show` → `q @<name> --ui` / `--format html`，並保留 raw SQL `export --format html` 的檔案輸出路徑。已透過 `plugin:sync` 同步到所有受管理平台副本。純文件 / skill 變更。

## [1.39.0] - 2026-06-24 - Dashboard chart type 解析時邊界驗證

### Changed

- **`--ui` dashboard chart type 改為解析時驗證。** Saved query 的 `visual.charts[].type` 現以單一合法集合 `line` / `bar` / `area` / `pie` 驗證；指定未支援的類型（含打錯字）會在解析時拋出 `SavedQueryError`（`PARSE_ERROR`），訊息列出合法清單。先前的行為是把任何未知類型**靜默畫成圓餅圖**。型別宣告中從未被渲染的 `scatter` 一併移除。

### Fixed

- **未知 chart type 不再靜默偽裝成圓餅圖。** dashboard 渲染端對非可渲染類型顯示明確的「Unsupported chart type」佔位，而非 fallthrough 成 `PieChart`。

## [1.38.1] - 2026-06-23 - Redis delete 能力對齊 & SKILL.md 任務路由重構

### Fixed

- **Redis `delete` 能力宣告由 `unsupported` 修正為 `limited` / `db-write`。** `delete.ts` 早已具備完整的 Redis 刪除分支（`DEL` / `HDEL` / `LREM` / `SREM` / `ZREM`、data-admin 權限閘、`--dry-run`、黑名單、稽核），但 `capabilities.ts` 仍宣告為 `unsupported`，與實作矛盾，導致能力表低報 Redis 刪除支援。改宣告為 `limited`（`db-write`，標註「基本刪除，需 data-admin、支援 `--dry-run`」）以對齊實作。於 SKILL.md 的 src 驗證期間發現。

### Changed

- **`assets/SKILL.md` 重構為任務路由決策樹。** 由原先結構改寫為以任務為導向的決策樹（task-routing decision tree），讓安裝 skill 的 agent 能依任務類型快速定位對應的指令工作流。純文件結構調整，無程式行為更動。

## [1.38.0] - 2026-06-22 - verify constraint Scenario

### Added

- **`dbcli verify constraint` 情境執行器（第四個內建 verify 情境）。** 以 preflight / after-write 兩種模式驗證「資料完整性不變式是否成立」，且**永遠不執行寫入或 DDL** — 只執行唯讀 `COUNT(*)` 違規查詢。以 `--check <kind>` 選擇四種限制類型：`fk`（孤兒列，需 `--column` + `--references <table.column>`）、`not-null`（NULL 值統計，`--column` 可重複）、`unique`（重複值統計，`--column` 可重複）、`custom`（呼叫端自訂的唯讀 `--violation-query <sql>`）。預設 threshold 為 `0`（嚴格：零違規即通過）；啟用 `--allow-preexisting` + `--baseline <n>` 可改為無回退模式（after-write 筆數 ≤ preflight baseline 即通過）。文物沿用 `subject.kind = 'table'`、`subject.command = 'verify constraint'`，artifact schema 與版本不變。MVP 僅限 SQL 引擎，FK 僅支援單一子欄位。

## [1.37.1] - 2026-06-22 - Skill Documentation Parity for verify rollback

### Fixed

- **Skill 文件補上 `verify rollback`。** v1.37.0 出貨的 `dbcli verify rollback` 先前未寫進可安裝的 skill 文件，導致安裝 skill 的 agent 不知道此指令存在。於 `assets/SKILL.md` / `assets/SKILL.zh-TW.md` 加入工作流速覽行，並於 `assets/reference.md` 新增完整 `#### verify rollback` 區段（`--kind ddl|dml`、`--statement`、preflight / after-write 雙範例、MVP 限制與 artifact subject 對應）。透過 `plugin:sync` 將內容傳播到所有受管理的平台副本（`skills/`、`.github/skills/`、`.cursor/`、`.windsurf/`、`plugins/`）。純文件變更，無程式行為更動。

## [1.37.0] - 2026-06-22 - Rollback Scenario & Nested Shell Completions

### Added

- **`dbcli verify rollback` 情境執行器(第三個內建 verify 情境)。** 透過已穩定的 scenario registry 註冊,以 preflight / after-write 兩種模式驗證「還原變更後資料庫是否回到預期的先前狀態」,且**永遠不執行**還原寫入 / DDL——只分析 `--statement` 並執行回讀斷言。以必填的 `--kind <ddl|dml>` 選擇還原語句文法:`ddl` 複用 `migration` 的單語句 `ALTER TABLE` 契約,`dml` 複用 `safe-backfill` 的 `UPDATE` plan 契約。安全邏輯完全複用兩個 sibling 情境的 classifier,無重複實作。artifact 沿用既有 subject kind(`ddl→migration`、`dml→backfill`)並以 `subject.command = 'verify rollback'` 記錄出處,因此 artifact schema 與版本不變。
- **巢狀 bash / zsh / fish shell 補全。** 以遞迴 command-tree metadata model 從指令樹生成巢狀子指令與旗標補全,並由共用 registry 驅動 REPL 的補全與分派;補全會排除 denylisted 指令。

### Changed

- **REPL 補全 / 分派改由共用 registry 驅動。** 補全與指令分派統一從同一份 command registry 取得,降低 CLI 與 REPL 之間補全行為漂移的風險;`buildProgram` 抽成可重用 factory 並消除補全啟動噪音。

## [1.36.0] - 2026-06-22 - Verification Scenario Runner Suite

### Added

- **`dbcli verify safe-backfill` 情境執行器。** 以 preflight / after-write 兩種模式驗證安全回填工作流，並**永遠不執行回填寫入**：preflight 依序跑黑名單、schema、目標表與唯讀 verify-query 防護後回傳 `ready` / `blocked` 並印出精確的 after-write 指令；after-write 重跑防護、執行回讀斷言，並寫入 v1 `VerificationArtifact`（狀態對應 `verified` / `not_verified` / `indeterminate`，防護失敗為 `blocked`）。
- **`dbcli verify migration` 情境執行器。** 對 schema migration 做 preflight / after-write 驗證，且**永遠不執行 DDL**：分析提案的 `ALTER TABLE`、跑唯讀防護、要求 DDL 目標與 `--table` 相符（schema-aware），after-write 後記錄 `migration` 主體的證據。MVP 僅接受單語句 `ALTER TABLE`，並阻擋 `CREATE TABLE` / `DROP TABLE` / `CREATE INDEX` 及多語句 DDL。
- **`ALTER TABLE` 目標識別字契約。** `verify migration` 的目標擷取改用 quote-aware tokenizer：支援 `table` / `schema.table` / `catalog.schema.table`，每區段可為未加引號名稱或雙引號 / 反引號 / 方括號識別字（含 `""`、`]]` 跳脫），因此 `"user accounts"`、`"tenant-1"."orders"` 等含空白或連字號的名稱皆可接受。無法完整解析的目標（未封閉引號、不支援的跳脫、超過三段）會 fail closed 並以「目標無法解析」為由阻擋，與 `must match --table` 的不符原因明確區分。
- **`verification summary --latest-only` 交接選項。** 於既有 summary 輸出之上額外回傳最新一筆有效 artifact，方便 agent 在交接時直接引用最新證據；無 artifact 時回傳 `latest: null` 並維持 exit 0，無效檔案不會被升入 `latest`。

### Changed

- **抽取共用情境原語至 `src/core/verify/scenario.ts`。** 防護排序、all-guards-passed 判定、有界原因、狀態對應、shell-quote 與證據遮蔽等共用邏輯集中於此，`safe-backfill` 重構為消費這些原語且**對外行為零變更**，降低後續情境的重複實作風險。

## [1.35.0] - 2026-06-19 - Verification Inspect & Prune Surface

### Added

- **`dbcli assert --write-verification-artifact` 橋接（opt-in）。** `assert` 的判定結果（verdict）現在可選擇性地寫成一份結果型 `VerificationArtifact`：透過 subject 解析器將斷言主體對應到 artifact 的 `subject`、依 pass/fail 對應驗證狀態，並以既有的原子寫入器落地於 `.dbcli/verification/`。省略旗標時行為完全不變、不寫入任何檔案；`safe-backfill-verify` 仍維持 plan-only。artifact 路徑一律相對於 cwd，與 `--config` 無關。
- **唯讀 `verification` 指令介面（inspect + 生命週期）。** 新增核心 artifact 讀取器（含 schema 驗證、filter / summarize / find 輔助函式），並以此建構出 `verification list`（表格輸出，支援 subject-kind 篩選）、`verification show`、`verification summary` 等唯讀檢視指令，讓 agent 能直接讀取與彙整既有驗證證據，而非自行解析檔案。
- **`verification prune` 保留期清理。** 依保留期（duration 解析）與全域 `--keep-latest` 規則挑選清理候選，全域 keep-latest 優先於各項篩選；具刪除安全防護（缺少 mtime 的檔案排除在外、預設 dry-run 預覽、`--execute` 才實際刪除），並在 execute 模式輸出 deleted / skipped 明細表。
- **完整 v1 證據驗證。** 對 `subject` / `evidence` / 選用欄位進行完整驗證，並加入執行期 evidence-kind 防護，確保讀取與寫入兩端對 schema v1 的解讀一致。

## [1.34.0] - 2026-06-18 - Verification Artifact Writer

### Added

- **驗證證據建構器（`buildVerificationArtifact`）。** 純函式，產生 schema v1 的 `VerificationArtifact`：可注入 `now` / `idFactory` 以利測試確定性、證據文字欄位上限 2000 字元（超過截斷並標註）、證據筆數上限 20（超過保留前 19 筆並補一筆 `manual` 截斷標記）；拒絕非法狀態、空白 summary、空證據。集中化證據裁切,讓後續寫入器與指令介面不必各自重複截斷決策。
- **`safe-backfill-verify` 計畫的「已規劃」驗證中繼資料。** `dbcli skill tasks plan safe-backfill-verify --format json` 現在輸出一個 `verification` 區塊（`status: "planned"`,取計畫中最後一個 `assert` 步驟作為證據)。此為**已規劃**證據,**不代表**驗證已執行或通過,與結果型 `VerificationArtifact` 明確區隔。其他 task pack 不受影響。
- **驗證證據寫入器（`writeVerificationArtifact`）。** 將建構出的 artifact 以原子方式寫入 `.dbcli/verification/verification-<YYYYMMDD-HHMMSS>-<short-id>.json`：檔名完全由 artifact 內部產生（UTC 時間戳 + `[a-z0-9]` 淨化短 id,杜絕路徑穿越)、缺少目錄時自動建立、以 `link()` 獨佔建立確保不會靜默覆寫既有檔案、回傳寫入路徑。
- **`recover --apply --write-verification-artifact`（opt-in)。** 僅在 verify 步驟實際執行時,將 recovery 驗證結果寫成一份 `recovery-verify` artifact（狀態取合約 `verificationStatus`,附 `recoveryRef`)。省略旗標時行為完全不變、不寫入任何檔案;寫入失敗只記到 stderr,不影響結束碼。保留既有 `verifyStatus`、不嵌入任何指令輸出或機密。

## [1.33.0] - 2026-06-18 - Workflow Pack Expansion

### Added

- **4 個新的 plan-only Agent Task Pack（皆唯讀)。** `pr-database-review`（PR 變更持久化路徑、查詢、migration 的資料庫風險審查)、`migration-review`（在套用 DDL 前擷取變更前 schema 證據並預覽 migration)、`safe-backfill-verify`（規劃安全 backfill 並產生 read-back `assert` 驗證指令)、`slow-endpoint-investigation`（串接 proxy / explain / missing-index 證據調查慢端點)。每個 pack 都以 `safety.mode: plan-only`、`risk: readonly` 步驟組成,只產生計畫、永不寫入;SQL 類 pack 先支援 `postgres` 與 `mysql`。
- **Skill 路由更新（en / zh-TW)。** 在 `SKILL.md` 與 `SKILL.zh-TW.md` 的 Agent Task Packs 段落各加入一段精簡導引,讓 agent 在自行組合手動的審查、migration、backfill、效能流程前,先選擇對應的 workflow pack;已重新同步所有 plugin / platform skill 副本。

## [1.32.0] - 2026-06-18 - Agent Task Packs Expansion & Skill Parity Guards

### Added

- **4 個新的內建 Agent Task Pack（皆 `plan-only` 唯讀）。** `audit-permissions`（權限等級與 blacklist 覆蓋稽核）、`safe-backfill`（在寫入前做 blacklist + schema + 風險檢查的回填計畫）、`schema-drift-review`（快取/committed schema 與線上 schema 的漂移比對）、`connection-health`（連線可達性 / 設定 / 容量分級三步診斷）。皆走確定存在的唯讀指令;用 `dbcli skill tasks list` 瀏覽完整清單。
- **平台清單 parity 檢查（`scripts/check-platform-parity.ts`，`bun run platform:check`）。** 以 `SUPPORTED_PLATFORMS` 為單一真實來源，驗證 README、SKILL.md、SKILL.zh-TW.md、reference.md 與 CLI `--install` 選項描述的平台列舉完全一致（缺項或多項皆報錯），並掛進 `release-check.sh`。
- **語意 parity 守門。** `scripts/check-skill-parity.ts` 在結構比對外，新增 14 個語言不變的安全/命令 token（`query`/`insert`/`update`/`delete`/`export`/`schema`、`blacklist`、`--dry-run`/`--no-limit`/`--recovery`、`LIMIT 1000`、三個權限等級）在 EN 與 zh-TW 皆須對稱出現的檢查。
- **安裝與 context CLI 測試覆蓋。** 新增 `skill --install` 對 7 個平台寫入 temp HOME/cwd 的 smoke 測試（含 cursor/windsurf 的 root-rule + reference 雙檔結構），以及 `skill context` 的 xml/json/markdown、預設格式、無效格式與 blacklist 不外洩的 CLI 入口測試。

### Fixed

- **`codex` / `windsurf` 安裝目標文件漂移。** 兩者已存在於 `SUPPORTED_PLATFORMS`（`--install` 實際可用），卻在 `SKILL.md` / `SKILL.zh-TW.md` 缺漏、`windsurf` 在 README 缺漏。已補齊並重新同步所有 plugin/skill 副本;新的 `platform:check` 會防止再次漂移。

## [1.31.0] - 2026-06-10 - Data Editing Surface & Agent Plugin Packaging

### Added

- **`@carllee1983/dbcli/core` 公開匯出 `DataExecutor` 與資料執行型別。** 在 `./core` barrel 開出資料編輯介面（insert/update/delete 執行面），讓外部消費者（如 `dbcli-gui` sidecar）能重用與 CLI 同源的資料寫入能力，不必重寫 adapter 邏輯。CLI 行為不變。
- **Agent plugin 打包與 marketplace 安裝。** 將 dbcli 打包為 agent plugin（Ponytail 風格 marketplace install），新增 GitHub Copilot CLI plugin 支援與 Cursor plugin 安裝（add-plugin metadata、marketplace 提交路徑），並依各 agent 拆分安裝指令與文件。
- **開發者工作流 skill 指引（en/zh-TW）。** 在 dbcli skill 新增「Developer workflows」段落，把資料庫影響隱含於開發任務時的最小安全路徑（DB-backed 功能、資料錯誤排查、ORM/migration、PR 審查、慢查詢、回填、環境驗證）寫入 SKILL en/zh-TW 與各平台副本，並以可執行的指令錨點取代不可執行的 migrate 範例。

## [1.30.0] - 2026-06-09 - Connection Writer API

### Added

- **`@carllee1983/dbcli/core` 新增連線寫入 API。** 在 `./core` barrel 公開純函式 mutation：`upsertConnection`、`removeConnection`（含預設連線重指派與 last-connection 防護）、`setDefaultConnection`、`migrateV1ToV2`（保留 legacy `.env.local` 密碼）、`writeConnectionSecret` + `envVarNameFor`（per-connection env 命名空間）。讓外部消費者（如 `dbcli-gui` sidecar）能程式化管理 `.dbcli` v2 連線，與 CLI 同源。CLI 行為不變。

### Fixed

- **`writeV2Config` 改為 atomic temp+rename 寫入**，避免寫入中斷時破壞設定庫。
- **`migrateV1ToV2` 對非 SQL 的 v1 連線 fail-loud 拒絕**，防止把不相容連線寫進 v2 設定庫。

## [1.29.0] - 2026-06-08 - Core Config-Read Entrypoint

### Added

- **`@carllee1983/dbcli/core` 新增設定載入入口。** 在 `./core` 子路徑公開 `readConfig(path, connectionName?)`（binding-aware、v1/v2、`{$env}` 展開的統一設定讀取，與 CLI 指令同源）、`resolveConfigStoragePath(path)`（project-binding 解參）與型別 `DbcliConfigV2`、`SqlConnectionOptions`／`QueryableConnectionOptions`（SQL adapter 連線型別收窄）。讓外部消費者（如 `dbcli-gui` sidecar）能從 `.dbcli` 專案路徑解出含真實連線資訊的 `DbcliConfig`，不必重寫內部 binding／env 邏輯。CLI 行為不變。

## [1.28.0] - 2026-06-08 - Core Subpath Export

### Added

- **`@carllee1983/dbcli/core` 子路徑匯出。** 新增穩定對外 API barrel（`src/core/public.ts`），透過 `package.json` 的 `exports` map 開出 `./core` 子路徑，並隨套件發布 `dist/core.mjs` 與扁平型別宣告 `dist/core.d.ts`。外部專案（如 `dbcli-gui` 桌面客戶端的 Bun sidecar）可 `import { AdapterFactory, QueryExecutor, SchemaLayeredLoader, listConnections, BlacklistManager } from '@carllee1983/dbcli/core'` 直接重用引擎能力。CLI（`bin`）行為完全不變。

## [1.27.0] - 2026-06-05 - Proxy Analyze

### Added

- **`dbcli proxy analyze` — 離線分析 proxy 事件日誌。** 讀取 `.dbcli/proxy/events.jsonl`(預設含 rotation `.1` 段),聚合成 agent-facing JSON 報告(`summary`、`byFingerprint`、`slowest`、`errors`、`hotTables`、`repetition`)或人類版 text。重用 `redactLiterals` 做 SQL 指紋正規化;對最吃總時間的 SELECT 指紋附上可執行的 `suggestedCommands`(`explain` / `guide missing-index-for`),僅輸出建議指令字串、不自動執行。旗標:`--events`、`--format json|text`、`--top`、`--slow-ms`、`--n-plus-one`、`--no-include-rotated`。不連資料庫。

### Changed

- **`dbcli proxy` — 事件日誌寫入序列化 + 自動輪替。** `EventWriter` 現在將所有寫入(根事件 + 全部 session)序列化到單一 in-process promise 鏈,避免多連線併發時 JSONL 行交錯或 rotation 計數競態;單一寫入失敗只影響該呼叫端(維持 fail-loud),不會卡住後續寫入。新增自動輪替(重用抽出的中性工具 `src/utils/jsonl-rotation.ts`,audit logger 亦改用同一份):當下一行將達 ~50 MiB 或 200,000 筆時,目前檔案改名為 `<events>.1`(覆寫舊段),保留單一滾動段,最壞磁碟用量約為位元組上限的 2 倍。先前 `events.jsonl` 會無限制成長。

### Fixed

- **`dbcli proxy` — `--slow-ms` 現在會在事件中標記 `slow`。** `query_completed` 事件新增 `slow: boolean` 欄位（`durationMs >= --slow-ms` 時為 `true`），與既有的終端警告一致。先前 `--slow-ms` 僅印出終端警告，但 CHANGELOG／使用者文件／reference 卻宣稱事件帶有 `slow` 旗標——此落差已修正。同步修正 `reference.md` 的 JSONL 事件範例(欄位名與實際 `query_completed` 結構對齊)，並更新 en／zh-TW 使用者文件(md + html)中對 `--slow-ms` 的描述。

## [1.26.0] - 2026-06-04 - Observability Proxy

### Added

- **`dbcli proxy` — 本地端開發觀測代理。** 支援 `mysql`、`mariadb`、`postgresql` 子指令。在現有應用程式與真實資料庫之間插入一個中繼層:dbcli 監聽 `--listen` 埠,轉送流量至 `--target`(或 `--use` / config 目標推斷),並把每個查詢的查詢文字、延遲、傳輸位元組、錯誤等事件以 JSONL 格式附加到 `.dbcli/proxy/events.jsonl`(可用 `--events` 覆寫)。僅作觀測使用,不執行任何改寫或封鎖。旗標:`--listen <addr:port>`、`--target <addr:port>`、`--events <path>`(預設 `.dbcli/proxy/events.jsonl`)、`--slow-ms <ms>`(預設 `1000`,超過即在事件中標記 `slow: true`)、`--redact none|literals`(預設 `none`;`literals` 會從事件裡剔除 SQL 字面值)、`--format text|json`(預設 `text`)。TLS 在 v1 僅轉送不解密;prepared / extended 協定為盡力標記。

## [1.25.0] - 2026-05-29 - Data-Layer Verification

### Added

- **`dbcli snapshot <query>` — 結果指紋。** 將任一查詢結果轉成確定性、黑名單安全的 `ResultSnapshot`(`rowCount` + 每欄聚合:null/distinct 計數、min/max/sum、順序無關的 checksum)。預設落檔至 `.dbcli/snapshots/snap-<timestamp>.json`,亦支援 `--out`、`--stdout`、`--rows`(連同遮罩後的列一併存檔)、`--format`、`--no-limit`。
- **`dbcli assert <query>` — 行內不變量檢查。** 三種模式:`--expect`(`rows > 0`、`value == 5000`、`col:email not null`、`col:id unique`、`col:amount between 0 and 100`、`col:age >= 18`)、`--vs <query> --compare rows|value`(跨查詢對帳)、`--against <snapshot> --tolerance <pct>`(對既有快照基準比對)。預設失敗時 `exit 1`,可用 `--no-fail` 僅報告不改變 exit code。
- 兩個指令均沿用既有 adapter / QueryExecutor / blacklist / audit 堆疊,黑名單欄位由 QueryExecutor 在源頭遮罩,指紋天生安全。目前支援 SQL 引擎(PostgreSQL / MySQL / MariaDB)。

## [1.24.0] - 2026-05-29 - Antigravity CLI Skill Target

### Added

- **`dbcli skill --install antigravity` 新增 Antigravity CLI 安裝目標。** Antigravity CLI 是 Google Gemini CLI 的後繼者;skill 會寫入 CLI 範疇的全域路徑 `~/.gemini/antigravity-cli/skills/dbcli/SKILL.md`(同目錄附帶 `reference.md`)。`SUPPORTED_PLATFORMS` 一併納入 `antigravity`,故 `dbcli upgrade` 的 skill 過期檢查也會涵蓋此平台。

### Changed

- `gemini`(Gemini CLI)安裝目標暫予保留,但已標示為即將淘汰,建議改用 `antigravity`。README(en/zh-TW)、`assets/SKILL.md`、`assets/SKILL.zh-TW.md`、`assets/reference.md` 與 `docs/user` 的平台清單同步更新。

## [1.23.1] - 2026-05-29 - Skill Docs Sync

### Changed

- 補齊 `assets/SKILL.md` 與 `assets/reference.md`,涵蓋 v1.22(Redis `redis.mask` 遮罩、Elasticsearch export/shell)與 v1.23(`explain`、`guide missing-index-for`、`inspect` 情境感知 `suggestedCommands` + `hints`、內建 task pack `analyze-table-perf`)的指令與旗標說明,使 `dbcli skill --install` 產出的文件與實際行為一致

## [1.23.0] - 2026-05-29 - Source-Driven Performance Review Tooling

### Added

- **`dbcli explain` 一級指令。** 把 `EXPLAIN` / `ANALYZE SELECT` / `EXPLAIN (ANALYZE, BUFFERS) SELECT` 包成統一介面,單條 query、`@saved-query`、`@file.sql`、`@glob/*` 通吃。輸出統一的 `ExplainRow` schema,附 5 條 actionable annotations(`full-scan` / `temp-table` / `filesort` / `cost-estimate-skew` / `nested-loop-large`)。輸出格式 markdown(預設)/ json / table。支援 `--bulk` 多筆批次。MariaDB + MySQL + PostgreSQL。(v1.23 P2)
- **`dbcli guide missing-index-for` 單條 query 複合索引顧問。** 解析一條 `SELECT`,結合真實 `EXPLAIN` 計畫與既有索引,輸出帶 `confidence`(high/medium/low)與 `reason` 的索引候選;偵測既有索引碰撞(single-col 可擴成 composite),並把函式/運算式欄位與無法解析的 SQL 列為 `warnings`。輸出格式 yaml(預設)/ json / markdown,支援 `--min-confidence` 過濾。唯讀(僅 EXPLAIN + 索引內省)。(v1.23 P3)
- **`dbcli inspect` 情境感知 `suggestedCommands` 與新的 `hints` 欄位。** `suggestedCommands` 改為三層加權(bootstrap / context-aware / discovery):collector 讀近 10 條 audit 找出最熱門資料表,有 task pack 時自動建議 `skill tasks plan analyze-table-perf --param table=<table>` 與 `skill tasks list`。新增與 `suggestedCommands` 平行的 `hints` 欄位(JSON 機器可讀 + markdown `## Hints`),提示最熱門資料表、可用 task pack 數量與 schema 快取概況。新增內建 task pack `analyze-table-perf`(唯讀 `plan-only`,吃必填 `table` 參數)。audit 讀取唯讀且永不 throw。(v1.23 P4)

### Fixed

- query-only 模式不再對 `SHOW`/`DESCRIBE`/`EXPLAIN`/`ANALYZE SELECT` 注入 `LIMIT`,避免 server 拒絕(v1.23 P1, issue #1)
- MariaDB `ANALYZE SELECT` 與 PostgreSQL `EXPLAIN (ANALYZE, BUFFERS) SELECT` 視為 read-only,query-only 模式可執行(v1.23 P1, issue #2)
- driver 在 execute 階段丟出的 SQL 錯誤(語法錯、table 不存在、column 不存在)不再被誤包成 `Connection failed`;訊息附 actionable hints 與 fuzzy table 候選(v1.23 P1, issue #3)
- `dbcli schema --refresh` 首次 bootstrap 不再要求 `--force`(v1.23 P1, issue #7)
- query-only 模式拒絕未知 SQL 時的訊息明確化:加入當前 permission level 與 issue 連結

### Changed

- `ConnectionError.code` union 新增 `SQL_SYNTAX_ERROR` / `TABLE_NOT_FOUND` / `COLUMN_NOT_FOUND`(向後相容;既有 consumer 只匹配 `UNKNOWN` 仍 fallback)

## [1.22.0] - 2026-05-21 - Elasticsearch Shell/Export + Redis Masking

### Added

- **Elasticsearch interactive shell.** `dbcli shell` 對 ES 連線開啟 Kibana Dev Tools 風格 REPL:輸入請求行 `<METHOD> /<path>` 加上可選的多行 JSON body,以空白行送出整個區塊,回應以美化 JSON 呈現。以讀取為主 — index 層級黑名單於前端直接拒絕受保護 index;`_search` 若 body 未指定 `size` 自動上限 1000 筆。(P1)
- **Elasticsearch export.** `dbcli export` 對 ES 連線支援兩種形式:傳入 search DSL 並以 `--index` 指定索引以匯出命中結果,或直接以 index 名稱當作查詢、透過 `match_all` + scroll 匯出整個索引。輸出 JSON / JSONL / CSV,預設上限 1000 筆(`--no-limit` 匯出全索引,以 scroll 分批串流)。匯出前套用索引層級黑名單檢查,並寫入稽核紀錄。(P2)
- **Redis value / hash-field 遮罩。** 新增 `.dbcli` `redis.mask` 設定區塊:key 命中 `keyPattern` glob 者,其值(或指定的 hash `fields`)於讀取時(`GET`、`GETRANGE`、`HGETALL`、`HGET`、`HMGET`、`HVALS`)回傳 `[REDACTED]`。遮罩與既有 key-glob 拒絕黑名單並存,且**拒絕一律優先於遮罩**。(P3)

### Fixed

- **Redis shell 單行指令路由。** 在 `dbcli shell` 對 Redis 連線輸入不帶結尾 `;` 的單行指令(`GET mykey`、`SCAN 0`、`HGETALL h`)現可正確執行,修正先前被誤判為未知 dbcli 指令的路由瑕疵。SQL 的分號 / 多行語意不變。(P4)

### Changed

- `src/adapters/capabilities.ts`:ES `export` 由 unsupported 改為 limited(readonly);Redis `blacklist` note 補上 value/hash-field 遮罩;Redis `shell` 單行說明修正。

### Docs

- 雙語 user docs(`docs/user/en` / `docs/user/zh-TW`,md + html)新增 ES shell、ES export、Redis 遮罩段落;`docs/feature-matrix.md` 同步 ES export 與 Redis blacklist 儲存格。

## [1.21.0] - 2026-05-20 - Redis-Parity Pack

### Added

- **Redis shell.** `dbcli shell` 現對 Redis 連線開啟互動式 REPL,具備歷史、readline、tab 補全(指令 + key 前綴)與 `.no-limit on/off` meta 指令。單行語意。
- **Redis size guard.** `SCAN` / `HSCAN` / `SSCAN` / `ZSCAN` 在缺少時補上 `COUNT 1000`;`LRANGE` / `ZRANGE` / `ZREVRANGE` 夾限 `stop`;`ZRANGEBYSCORE` 補上 `LIMIT 0 1000`。`HGETALL` / `HKEYS` / `HVALS` / `SMEMBERS` / `KEYS` 的無上限回覆在 client 端截斷至 1000 並帶 `REDIS_SIZE_TRUNCATE` 警告。`--no-limit` 略過所有防護。
- **Redis blacklist 強制。** `dbcli blacklist add 'pattern'` 現會封鎖 key 命中的 Redis 讀寫。採 Redis 原生 glob(`*`、`?`、`[abc]`、`[a-z]`)。與黑名單重疊的 `KEYS` / `SCAN MATCH` 會被拒絕;未重疊的掃描則濾掉黑名單 keys 並帶 `REDIS_BLACKLIST_FILTERED` 警告。稽核記錄含 `metadata.rejection_reason: 'blacklist'` 與 `matched_pattern`。

### Changed

- `ExecutionResult.warnings` 現為公開型別的一部分(optional),目前僅由 Redis 發出。
- `src/adapters/capabilities.ts` Redis row 更新:`shell` → `interactive`、`query auto-limit` → `limited`、`blacklist` → `limited`。

### Out of scope

- Elasticsearch shell、Redis/ES export、Redis value/hash-field 遮罩 — 延後至 v1.22 或之後。

## [1.20.2] - 2026-05-19

### Added

- **MongoDB MVP 全套支援。** `q` 指令現以 limited-supported 等級納入 MongoDB（`find` / `aggregate` 兩種 snippet body），路由經過專屬分支與 field-masker；`schema` 採 `$sample` + 遞迴 path 偵測（含 BSON 型別），新增 `--sample-method` 旗標；`query` / `export` 套用 `maskMongoRows` 對巢狀結構遞迴遮罩。
- **MongoDB blacklist 強化。** 新增 path-matcher（exact / dotted / suffix-wildcard）、field-masker 遞迴遮罩、insert / update 在寫入前強制套用 nested-path blacklist；`blacklist list` 對 collection 上的 middle-`*` pattern 發出警告。
- **MongoDB 安全模型升級。** update operator 從硬性 allowlist 改為分級安全（tiered operator safety）；schema 對 blacklist 欄位直接 redact；`cache` / `doctor` 暴露 `sampleMethod`。
- **MongoDB snippets 一級公民化。** 內建 reference snippets（find + aggregate）、`queries list/search/suggest` 將 MongoDB snippets 與 SQL 引擎並列；`mongoStrategy` 驗證 body 與 params 並支援 map 形式插值。
- **Recovery — per-code branching for connection codes (MVP)。** `recover --next` 對 connection 類錯誤碼支援多 branch 派發：新增 `buildConnectionBranches` factory（4 個 connection branch）、`matchConnectionBranch` resolver、`classify` emit `branches` / `branchFork`，並提供 `--branch <id>` 旗標讓 agent 顯式選擇 branch。輸出 `NextResult.branchId` 與 markdown 中的 branchId/description 一併呈現。

### Changed

- **MongoDB `q` 文件升級。** `docs/feature-matrix.md` / 雙語 user docs 將 MongoDB `q` 從 unsupported 改為 limited supported（記載目前支援的 body 形式與限制）。
- **Recovery schema 新增 `branches` / `branchFork`。** 行為向下相容（無 branch 時與舊版一致）；`GuideStep` / `NextResult` / `NextStepOutput` 全鏈打通 `branchId`；`shellQuote` 抽離為共用模組。

### Security

- **Pin `brace-expansion ^5.0.6`** 修補 GHSA-jxxr-4gwj-5jf2 ReDoS。

### Tests

- `tests/integration/` — MongoDB tier、blacklist、sampling、snippet 整合覆蓋。
- 新增 mongo plan + schema envelope shape 的 contract test。
- Recovery: doctor↔resolver keyword coupling contract test、connection envelope 6 變體 snapshot、`recover` E2E branching（fork / walk / fallback / `--apply` 不變）覆蓋。

### Docs

- 雙語 user docs 新增 Agent 修復工作流段落（精簡 walkthrough）與 Recovery Cookbook。
- `assets/SKILL.md` / `assets/reference.md` 補 `--branch` 旗標與 `NextResult.branchId` 說明、MongoDB tier / operator / blacklist / sampling 行為。
- 統一 npm 套件名為 `@carllee1983/dbcli`；關閉 v1.20.0 Phase 23-04 已知限制段落。
- `.planning/PROJECT.md` 同步：`bun test`、已 ship 項目移出 OOS。

### Internal

- `style: [recovery] format with prettier (printWidth 100)` / `style: [mongo] format with prettier (printWidth 100)` — 全面套用 prettier `printWidth 100`。
- `fix: [test] remove this alias in mongo sampling mock` — 修正 eslint `no-this-alias`。
- `refactor: [snippets] register mongo as a first-class engine family` / `refactor: [recovery] extract shellQuote to a shared module`。

## [1.20.1] - 2026-05-18

### Changed

- **Phase 23-04 follow-up closure — full DML/DDL audit coverage.** `insert / update / delete / export / q / schema` now invoke `writeAuditEntry` on every happy / failure / rejection branch (BlacklistError / PermissionError / ConnectionError / validation all flow through the wired catch block). This closes the v1.20.0 INTEGRATE-01 / INTEGRATE-04 partial gap noted in v1.20.0's Known limitation paragraph.
- **Bi-directional `audit_ref` ⇄ `recovery_ref` linkage on every `--recovery`-capable command.** When any of the 6 newly-wired commands fails with `--recovery`, the audit entry's `recovery_ref` and the recovery envelope's `audit_ref` carry matching UUIDs — identical in shape to the Phase 25 `query` / `inspect` round-trip wiring. Agents can pivot from `.dbcli/last-recovery.json` to the audit entry via `dbcli audit tail --recovery-ref <id>`.
- **AI-agent skill docs (`assets/SKILL.md`, `assets/SKILL.zh-TW.md`, `assets/reference.md`)** updated to advertise full 8-command bi-directional coverage; bilingual user docs (`docs/user/en/index.{md,html}`, `docs/user/zh-TW/index.{md,html}`) gained a `--recovery` row noting the cross-command linkage.

### Tests

- `tests/integration/recovery-audit-link.test.ts` — the legacy "J1 asymmetry guard" `describe` block (which asserted `'audit_ref' in envelope === false` for the 6 deferred commands) is replaced with a consolidated **6-command positive bi-directional round-trip** block. For each of `schema / q / export / insert / update / delete`, the test asserts `envelope.audit_ref === audit.id` AND `audit.recovery_ref === envelope.id`, with both refs matching `/^[0-9a-f-]{36}$/`.

### Internal

- `src/commands/{insert,update,delete,export,q,schema}.ts` — adopt the D-J catch-block template from Phase 25: pre-generate `envelopeId = crypto.randomUUID()` only when `options.recovery === true`, call `writeAuditEntry({ success: false, error, recovery_ref: envelopeId })` and capture the returned `auditId`, then call `emitRecoveryEnvelope(err, ctx, { envelopeId, auditRef: auditId ?? undefined })`. Success branches add `await writeAuditEntry(config, '<cmd>', options, { success: true, ... })`.
- `src/commands/q.ts` — `handleQError` refactored to accept `config` so audit + envelope can be written together inside the same try/catch.
- `src/adapters/capabilities.ts` — narrow `ExportOptions` / `QCommandOptions` shapes opened so the shared audit helper can read `--recovery` and `--config` without per-command type casts.
- `.planning/phases/25-recovery-envelope-bi-directional-linkage/25-J1-COVERAGE-MATRIX.md` — coverage table refreshed; all 6 previously-deferred rows flipped to `YES (Phase 23-04 wired)`; Round-Trip Contract section replaces the old Asymmetry Guard section.

## [1.20.0] - 2026-05-17

### Added

- **Agent-facing Audit Log**: every db-touching command writes a structured JSONL entry to `.dbcli/audit/<connection>.jsonl`. Entry shape locked as a contract test (`tests/integration/audit-contract.test.ts`) covering `ts` / `session_id` / `engine` / `command` / `side_effect_tier` / `target` / `success` / `recovery_ref` / `redacted_sql`. Redaction sourced from `tests/helpers/sensitive-output.ts` (single source of truth).
- `dbcli audit tail` / `audit show` / `audit clear` / `audit health` subcommands with `--n`, `--all`, `--for-agent`, `--brief`, `--recovery-ref <id>`, `--format table|json`, `--yes` flags. JSON output is a flat array suitable for agent direct consumption (CLI-01..06).
- `dbcli audit tail --all` cross-connection merged view; `audit show --recovery-ref <id>` bi-directional lookup; `audit health` reports writer state, lock state, rotation cap usage.
- Recovery envelope bi-directional linkage: audit entry `recovery_ref` points at `.dbcli/last-recovery.json`; envelope's new `audit_ref` points back at the audit entry id.
- `inspect` / `guide` / `recover` / `recover --apply` `--for-agent` JSON output embeds `audit_recent: AuditEntryBrief[]` (last 5 entries) for immediate cross-session context.
- `dbcli skill --install <platform> --lang en|zh-TW` (default `en`) to install Traditional Chinese SKILL.md content on agent platforms; target filename remains `SKILL.md` regardless of source.
- New `assets/SKILL.zh-TW.md` — full Traditional Chinese translation of `assets/SKILL.md`, including the new `## Audit Log 使用` section.
- New `## Audit Log usage` section in `assets/SKILL.md` (session handoff + forensics scenarios).
- New `### audit` subcommand block in `assets/reference.md` documenting all 4 subcommands with flag tables.
- `docs/feature-matrix.md` gains an `audit` row (engine-independent, N/A across all 6 engines) and the Side-effect tiers table examples now include `audit tail` / `audit show` / `audit health` (`readonly`) and `audit clear` (`local-write`).
- `scripts/release-check.sh` step `8/8 doc-presence` — release-blocking shell-grep check that the feature-matrix `audit` row and the matching `CHANGELOG.md ## [<version>]` heading both exist.

### Changed

- **Default-on, upgrade impact:** `audit.enabled = true` by default. Existing projects will begin creating `.dbcli/audit/<connection>.jsonl` on first command after upgrading. Set `audit.enabled = false` in `.dbcli` to opt out. The audit directory is gitignored by default; entries are metadata-only (D3) — never raw SQL bodies, `--param` values, or result cell contents. (D1)
- `inspect` / `guide` / `recover` / `recover --apply` agent JSON output adds an `audit_recent` field (additive; shape stable; not a breaking change). v1.19.x consumers ignore the field.
- _Known limitation (Phase 23-04 follow-up):_ Audit log captures `query`, `inspect`, and diagnostic-surface commands in v1.20.0; coverage for `insert / update / delete / export / q / schema` failure paths is tracked as Phase 23-04 follow-up (see `.planning/phases/25-recovery-envelope-bi-directional-linkage/25-J1-COVERAGE-MATRIX.md`). Recovery envelope linkage from the envelope side is unaffected — those commands continue to emit `.dbcli/last-recovery.json` envelopes; only the `audit_ref` back-pointer is missing in v1.20.0. (Closed in v1.20.1 — see entry above.)

### Internal

- New modules under `src/core/audit/`: `logger.ts`, `lock.ts`, `rotation.ts`, `reader.ts`, `recent.ts`, `session-id.ts`, `types.ts`, `integration-helper.ts`.
- New contract / integration tests: `tests/integration/audit-contract.test.ts`, `tests/integration/audit-envelope.test.ts`, `tests/integration/recovery-audit-link.test.ts` (J1 asymmetry guard).
- `scripts/release-check.sh` is now 8 steps (was 7); CONTRIBUTING.md §Release Process and `docs/feature-matrix.md` §Required CI validation block updated to match.
- `src/commands/skill.ts` adds a `resolveSkillSource(lang)` selector and `--lang en|zh-TW` commander option via `new Option(...).choices(['en','zh-TW']).default('en')`. `getInstallPath()` is unchanged (target filename stays `SKILL.md`).

## [1.19.1] - 2026-05-14

### Changed

- Stabilized agent-facing command contracts after v1.19.0 with typed engine capability boundaries and safer guide/inspect/report/recovery JSON shapes.
- Kept generated UI assets deterministic by pinning the UI bundle build to production mode and preserving release formatting gates.
- Refactored the HTML dashboard React template to extract pure formatting, KPI, and table-column helpers for easier unit coverage.

### Fixed

- Aligned adapter creation and command capability checks with the documented feature matrix to avoid unsupported engine paths leaking into agent guidance.
- Tightened saved recovery command redaction and strict envelope validation so recovery artifacts do not expose raw SQL or sensitive flag values.
- Ensured UI report output and browser-opening paths remain covered by smoke tests without shipping stale bundled assets.

### Tests

- Added contract tests for inspect, report, guide, recovery envelopes, engine capabilities, and sensitive-output redaction.
- Added UI helper unit tests and React render smoke coverage for dashboard payload rendering.

## [1.19.0] - 2026-05-11

### Added

- **Expanded Antigravity Protocol**: Added Phase 0 (Scout) for research and Phase 3 (Auditor) for validation to the core agentic workflow.
- **Enhanced Agent Support**: `dbcli skill --install` now supports **Codex (OMX)** and **Windsurf**.
- **Cursor Rules Update**: `dbcli skill --install cursor` now uses the modern `.cursor/rules/*.mdc` project-local format.
- New `GEMINI.md` project-level instruction file with full Antigravity lifecycle guidance.

## [1.18.0] - 2026-05-11

### Added

- **Interactive HTML Dashboards**: `query`, `q`, and `export` can now render results as fully interactive, standalone HTML reports.
- New `--ui` flag to open dashboards directly in the system browser.
- New `html` format for `stdout` and file-based report generation.
- Snippet `visual:` block in frontmatter for KPI and chart configuration (Line, Bar, Area, Pie, Scatter).
- Secure payload injection with automatic HTML escaping and blacklist redaction.
- Bundled React + Recharts + Tailwind UI template for zero-dependency portability.

## [1.17.0] - 2026-05-10

### Added

- `dbcli recover` top-level command. Without `--apply`, prints the auto-saved last envelope (Markdown by default, JSON with `--format json`); with `--apply`, executes the recovery plan under risk gating.
- `--apply` runs `tier=readonly` and `tier=dry-run` steps by default (tier is determined by the code-owned allowlist, not the envelope). Open the gate one tier with `--allow-write=readonly-cmd` (local-side writes) or `--allow-write=write-cmd` (database writes).
- `--from <path>` overrides the auto-saved envelope and accepts either a raw `RecoveryEnvelope` or a `SavedRecoveryEnvelope` wrapper.
- Auto-write `.dbcli/last-recovery.json` on every `--recovery` failure across `query`, `q`, `insert`, `update`, `delete`, `export`, `schema`, and `inspect`. Atomic write; SQL text and sensitive flag values are redacted in the saved `command` summary.
- New optional `GuideStep` fields: `interactive`, `dbWrite`, `placeholders` (additive — no `schemaVersion` bump).
- Per-`error.code` argv allowlist enforced before any child-process execution; hand-authored envelopes cannot escalate beyond the steps dbcli already knows how to run.
- Strict zod-based schema validation for envelopes from `--from <file>` and `.dbcli/last-recovery.json`. Missing `recovery`, missing `error.code`, malformed step shape, or wrong `schemaVersion` all surface as exit code 2 with a structured reason instead of crashing.
- Exit-code matrix for `dbcli recover --apply`: `0` ok, `1` failed, `2` envelope missing/malformed, `3` skipped-only.
- `RecoveryEnvelope.verify?: GuideStep` — optional read-only verifier appended by `classifyError()` per recovery code (additive, no `schemaVersion` bump).
- `dbcli recover --apply` now runs the verifier after the main plan when `finalStatus === 'ok'`. Output gains `verifyResult` and `verifyStatus` (`passed | failed | indeterminate`). `--no-verify` opts out.
- `--no-verify` flag on `dbcli recover --apply`.
- `BLACKLIST_COLUMN_WRITE` allowlist now permits `dbcli inspect --for-agent` (used as the verifier).
- `dbcli recover --next --after-step <n> --result <json|@file>` — multi-turn protocol that returns one deterministic step at a time, given the result of the previous step. Output is a `NextResult` envelope with `kind: 'step' | 'done'`, `cursor`, `totalSteps`, and (when stepping) the next `GuideStep`.
- `--next` is mutually exclusive with `--apply`; `--result` accepts inline JSON or `@<path>` (file ≤ 64 KB; `stdoutSummary`/`stderrSummary` ≤ 4 KB each).
- New `nextStepFromEnvelope` pure function and `StepResultSummary` / `NextResult` types in `src/core/recovery/next-step.ts` + `next-types.ts`. v1 walks the plan linearly; the function signature reserves `prevResult` for future per-code branching without breaking callers.

### Changed

- `dbcli recover --apply` defaults to `--format json` for machine-readability; `dbcli recover` (no `--apply`) keeps `--format markdown` as the default. Either default can be overridden explicitly.
- `dbcli init` and `dbcli init --force` recovery steps are now marked `interactive: true`; `--apply` skips them with `skipped:interactive`.
- Recovery steps that fall back to placeholder tokens (`<table>`, `<hint>`, `<snippet>`, `<name>`, `<value>`) now declare those tokens in `placeholders`; `--apply` skips them with `skipped:placeholder`.
- `dbcli use <connection>` recovery step is now `risk: 'write'` with `dbWrite: false` — selecting a connection rewrites the active-connection field in config.

### Security

- **Trust boundary on `--apply`**: envelope `risk`, `dbWrite`, and `interactive` fields are no longer authoritative for execution decisions. The gate derives the canonical execution tier (`readonly` / `dry-run` / `local-write` / `db-write` / `interactive`) from the per-`error.code` allowlist. A hand-crafted envelope claiming `risk: 'readonly'` for `dbcli delete users --where id=1` is still classified as `db-write` and skipped under the default tier. Falsified `interactive: false` on `dbcli init` is still skipped because the allowlist marks it `interactive`.
- `insert` / `update` / `delete` / `q` are tier `dry-run` only when argv contains `--dry-run`; otherwise they are tier `db-write`.
- Auto-saved envelope source now also rejects (exit 2) when `saved.cwd` no longer exists on disk, matching the existing `--from` saved-envelope behavior.

### Internal

- New modules under `src/core/recovery/`: `apply-types`, `apply-shell`, `apply-allowlist`, `apply-gate`, `apply-exec`, `apply`, `apply-render-json`, `apply-render-markdown`, `last-envelope`, `envelope-schema`.
- `apply-allowlist` exposes `classifyArgvForCode(argv, code)` returning `{ kind, tier }` so the gate can decide tier without trusting envelope hints. `isAllowedForCode` is preserved as a boolean wrapper.
- Test seam `__setExecutorForTests` allows unit tests to swap the child-process executor without spawning real processes.

## [1.16.0] - 2026-05-09

### Added

- `dbcli insert --recovery`, `dbcli update --recovery`, `dbcli delete --recovery`, `dbcli export --recovery`, `dbcli schema --recovery`, `dbcli inspect --recovery` — same opt-in envelope behavior as v1.15.0's `query --recovery` / `q --recovery`. On failure, a `RecoveryEnvelope` JSON is written to stdout, the human stderr message is suppressed, and the process exits non-zero. Without `--recovery`, the existing per-command error behavior is preserved byte-for-byte.
- `dbcli inspect --require-schema-cache` — flag that throws `SCHEMA_CACHE_MISSING` (recovery code) when the active SQL connection has no usable schema cache. Combine with `--recovery` to get a structured envelope. Together with the v1.15.0 `recovery` module this gives the `SCHEMA_CACHE_MISSING` classifier path end-to-end coverage from a real CLI surface.
- New `dry-run` recovery steps prepended to `BLACKLIST_COLUMN_WRITE` and `PERMISSION_DENIED` envelopes when the failing operation was a write (`INSERT` / `UPDATE` / `DELETE`). Agents now get a `dbcli <verb> <table> --dry-run` suggestion as the first step before the existing inventory / inspect / init steps.

### Notes

- `RecoveryEnvelope` shape, `RECOVERY_SCHEMA_VERSION`, and the 14 recovery codes are unchanged from v1.15.0. The new `RecoveryContext.writeOperation` field is optional and additive.
- Other commands (`q` was already covered in v1.15.0; `report`, `guide`, `recovery`, `doctor`, `migrate`, `init`, `use`, etc.) keep their existing error behavior.
- No new runtime dependencies. The classifier and step library remain pure functions.

## [1.15.0] - 2026-05-09

### Added

- `dbcli recovery` — machine-readable error envelope with deterministic recovery commands. Standalone lookup mode: `dbcli recovery --code <CODE>` synthesizes an envelope for any of 14 recovery codes (`CONFIG_MISSING`, `CONN_REFUSED`, `CONN_AUTH_FAILED`, `CONN_TIMEOUT`, `CONN_HOST_NOT_FOUND`, `CONN_UNKNOWN`, `PERMISSION_DENIED`, `BLACKLIST_TABLE`, `BLACKLIST_COLUMN_WRITE`, `SNIPPET_NOT_FOUND`, `SNIPPET_AMBIGUOUS`, `SNIPPET_PARAM_MISSING`, `SCHEMA_CACHE_MISSING`, `UNKNOWN`). Supports `--format json|markdown`, `--list`, `--brief`, `--for-agent`, plus placeholder bindings (`--hint`, `--snippet`, `--table`).
- `dbcli query --recovery` and `dbcli q --recovery` — opt-in flag that, on failure, emits a `RecoveryEnvelope` JSON to stdout (suppressing the usual human stderr message) and exits non-zero. Existing behavior without the flag is unchanged.
- `RecoveryEnvelope` schema (`schemaVersion: 1`) reuses the v1.14.0 `GuideStep` shape and is the first surface to emit `risk: 'dry-run'` and `risk: 'write'` recovery steps.

### Notes

- v1.15.0 wires `--recovery` into `query` and `q` only. Other commands (`insert`, `update`, `delete`, `export`) preserve their current error behavior; broader integration is planned for v1.16+.
- Recovery is reactive (responds to a thrown error) while `dbcli guide` is proactive (chooses next steps before any failure). They share the `GuideStep` contract via `src/core/guide/types.ts`.
- No new runtime dependencies. Classifier and step library are pure functions.

## [1.14.0] - 2026-05-09

### Added

- `dbcli guide <goal>` — deterministic next-command planner for a fixed list of database goals (`slow-query`, `capacity`, `health`, `index-usage`, `permissions`, `schema-overview`). Reuses `dbcli inspect` context cache-first; pass `--probe` to refresh via a live probe. Each step carries `risk: 'readonly'` (forward-compatible with v1.15.0 recovery) plus `rationale` and `expects` (trimmed by `--brief` / `--for-agent`). Supports `--format json|markdown`, `--list`.
- Goal-list view: `dbcli guide --list` returns all available goals with one-line descriptions.

### Notes

- Guide does not execute any commands; it only plans them. All v1.14.0 plans are read-only by construction.
- MongoDB connections still produce a useful plan (anchor + `queries suggest` + `doctor`) even though no built-in mongo diagnostic snippets exist yet.
- Coexists with `dbcli skill tasks plan` (template-driven). Guide is taxonomy-driven from the static goal map.

## [1.13.0] - 2026-05-09

### Added

- `dbcli report` — Markdown / JSON diagnostic report built on top of v1.12.0 inspect collectors. Reuses connection / permission / blacklist / snippet inventory context; runs curated read-only built-in `@diag/*` snippets grouped into `health` / `capacity` / `perf` sections; per-snippet timeout (default 3000 ms) and per-evidence row cap (default 50). Supports `--format json|markdown`, `--section <list>`, `--brief`, `--for-agent`, `--no-connect`.

### Notes

- MongoDB connections emit a context-only report (no built-in mongo snippets in v1.13.0).
- No new built-in snippets in this release; report uses the v1.11 `@diag/*` inventory.

## [1.12.0] - 2026-05-08

### Added

- `dbcli inspect` — read-only context snapshot for AI agents (`--format json|markdown`, `--brief`, `--for-agent`, `--no-connect`, `--probe-timeout`).
- `src/core/inspect/` collector layer (connection, permission, blacklist, objects, schema-cache, snippets, version, suggested commands) reused via the orchestrator.
- `release:check` script — sequences `bun audit`, format check, typecheck, lint, tests, build, and dist smoke.

### Changed

- `assets/SKILL.md` agent workflow now starts with `dbcli inspect --for-agent`.
- `README.md` quick-start documents the agent first-look command.

### Notes

- Snapshot output is locked at `schemaVersion: 1`. Non-SQL engines emit `objects` and `schemaCache` as `unavailable: true` until later milestones.
- No new runtime dependencies.

## [1.11.0] - 2026-05-08

### Added

- `dbcli queries search <keywords>` — fuzzy keyword search across saved queries.
- `dbcli queries suggest <intent>` — intent-prefix suggestion.
- Optional `intent` frontmatter field on snippets.
- 9 new diagnostic snippets: ES x4 (hot-threads, index-stats, unassigned-shards, pending-tasks); Redis x4 (slowlog, client-list, memory-usage, cluster-info); SQL x1 (blocking-queries.postgres).
- "When you don't know which query to run" section in SKILL.md.

### Changed

- All 18 existing built-in diagnostic snippets backfilled with `intent`.
- `foldVariants` extracted from `src/commands/queries.ts` to `src/core/saved-queries/fold.ts`.
- Redis read-only allowlist gained `CLIENT`, `INFO`, `CLUSTER`, `SLOWLOG` for diagnostic snippets.

## [1.10.1] - 2026-05-08

### Fixed

- **Packaged `dist/cli.mjs` 找不到 assets**：1.10.0 bundle 在 `task-paths.ts` / `snippet-paths.ts` 用 `import.meta.dir + ../../../` 解析 builtin 目錄，bundle 後三層往上會跳出 package root，npm 全域安裝的使用者執行 `dbcli queries list` / `dbcli skill tasks list` 讀不到資源。抽出 `src/utils/package-root.ts` 以 `package.json` 走訪定位 root，dev 與 bundle 都正確；`skill.ts` 內既有的 `findPackageRoot` 也收斂到同一處。
- **`dbcli q` 略過 blacklist 檢查（安全）**：`q.ts` 把空字串當作 `tableName` 傳給 `BlacklistValidator.filterColumns`，column-level redaction 永遠不命中；同時也沒呼叫 `checkTableBlacklist`，使用者可以透過 saved snippet 直接 SELECT 黑名單表/欄位繞開保護。改為從 `prepared.rewrittenSql` 抽出主表（SQL）或 `prepared.execHints.index`（ES），執行前先 `checkTableBlacklist('SELECT', target)`，並把真正的 `tableName` 餵給 `filterColumns`；Redis 維持原樣。

### Added

- **dist/ 整合 smoke 測試**：`tests/integration/dist-smoke.test.ts` 從 OS tmpdir 執行 `dist/cli.mjs`，覆蓋 `--version`、`skill --output`、`queries list`、`skill tasks list`，守住 packaged assets path 不再回退。
- **`q` blacklist 迴歸測試**：`tests/unit/commands/q-blacklist.test.ts` 覆蓋黑名單表阻擋、欄位 redact、未受影響 snippet 三種情境。

### Changed

- **Lint release-blocking**：`bun run lint` / `lint:fix` 加上 `--max-warnings=0`；同時清掉 45 個 `@typescript-eslint/no-explicit-any` warnings（以正型替代為主，`elasticsearch-adapter.ts` 因刻意不引入 `@elastic/elasticsearch` SDK 而以檔案層 `eslint-disable` 標註理由）。任何新 warning 從此會擋住 release。

## [1.10.0] - 2026-05-08

### Added

- **Saved Queries 擴展至 Elasticsearch 與 Redis**：`dbcli q @<name>` 與 `queries` 子命令現在能依 frontmatter `engine` 自動切換到對應引擎，並走各引擎專屬的安全管線。
  - **Engine strategy 重構**：runner 透過 `EngineStrategy` 介面分派到 SQL / Elasticsearch / Redis 三個獨立 strategy；既有 SQL 行為以 strategy 形式保留，無行為變更。
  - **Elasticsearch strategy**：
    - Frontmatter 接受 `engine: elasticsearch` 與 `index` 欄位；body 必須是合法 JSON，含 `script` 欄位的 query 直接拒絕。
    - JSON-aware 參數注入：`:name` 僅在 JSON 字串脈絡裡替換，避免破壞語法。
    - Size guard：自動補 `size` 上限；`aggs` 模式下放行但加註警告，分頁 (`from + size`) 過大時提示。
  - **Redis strategy**：
    - 命令白名單（read-only 為主）+ body validation；直接拒絕 unsupported 或寫入命令。
    - Raw 參數注入：`:name` 直接代入字面量並打印 foot-gun 警告，提醒使用者 saved query 內不可放使用者輸入。
    - Size guard：對 range / SCAN 命令的 `COUNT` / `LIMIT` 加上保險上限。
  - **`q` 命令分派**：根據 prepared execution 的 engine family 呼叫對應 adapter，`--dry-run` 依 engine 用對應格式輸出（SQL 維持 SQL、ES 印 JSON body、Redis 印 argv）。
  - **內建診斷 snippet**：
    - `assets/snippets/diag/es-cluster-health.elasticsearch.sql` — ES 叢集健康度摘要。
    - `assets/snippets/diag/redis-key-stats.redis.sql` — Redis key 數量 / type 分佈快照。
- **整合測試**：新增 ES / Redis end-to-end saved query 測試（依本機是否有 Docker 而 skip，與既有 PG / MySQL 測試一致）。

### Changed

- **Redis 驅動**：改用 Bun 內建 `RedisClient`，移除外部 `ioredis` 依賴。
- **Elasticsearch adapter**：refactor 並收斂錯誤訊息與 ExecutionResult 形狀，與 SQL / Mongo / Redis 對齊。
- **文件**：`assets/SKILL.md` 與 `assets/reference.md` 補上 ES / Redis snippet 工作流；`docs/feature-matrix.md` 更新 saved-queries 欄位。

### Fixed

- **`dbcli export`（Redis 分支）**：`result.rowCount` 在 Redis 上可能 undefined 時導致 `tsc --noEmit` 報 TS2322；改為 `result.rowCount ?? result.rows.length ?? 0`，release gate 中的 typecheck 回到 0 錯誤。

## [1.9.1] - 2026-05-07

### Changed

- **Skill 連線設定指引**：`assets/SKILL.md` 加入「Connection setup」章節，補齊 AI agent 協助使用者建立資料庫連線時所需的決策樹與各 engine essentials。
  - 決策樹：v1 vs v2、credentials 來源（`.env` / env-refs / 明文）、權限 tier、`status` + `doctor` 驗證。
  - Per-engine essentials：PostgreSQL / MySQL / MariaDB / MongoDB（含 `mongodb+srv://`）/ Redis（`--name` 為 logical DB index）/ Elasticsearch（basic / Cloud ID / API key）。
  - v2 multi-connection 範例（`--conn-name`、`--env-file`、`use --list`、`--rename`、`--remove`）與 per-connection schema cache 注意事項。
  - env-refs（`{ "$env": "..." }`）說明，以及「不要用 `--force` 把 env-refs 蓋成明文」的 guard。
  - 常見陷阱：SRV DNS、URL 中特殊字元編碼、Redis `--name` 限制、Elasticsearch TLS 設定需手動編輯 `.dbcli`。
  - 同步擴充 frontmatter `description`，加入 `init` / `.dbcli` / auth modes 觸發詞，提升 skill 觸發精準度。

## [1.9.0] - 2026-05-06

### Added

- **Agent Task Packs（plan-only 第一版）**：`dbcli skill tasks list/show/plan` 讓 AI agent 可探索團隊定義的資料庫任務範本並產生安全可審查的執行計畫。
  - 三層儲存：`assets/tasks/`（內建）< `.dbcli-shared/tasks/`（團隊共享）< `.dbcli/tasks/`（個人覆蓋）。
  - Task 檔為 `.md`：YAML frontmatter（name/description/tags/engines/params/safety/steps）＋ markdown agent notes。
  - 嚴格 schema：`safety.mode` 僅接受 `plan-only`、`step.type` 僅接受 `command`，未知欄位直接 fail 解析而非靜默忽略。
  - `plan` 輸出包含原始 `command`、`resolvedCommand`、`argv`（shell-aware 切分），方便 agent 直接消費。
  - 內建第一版 `diagnose-slow-query` 任務作為範例。
- 文件：`assets/SKILL.md` 與 `assets/reference.md` 同步加入 Agent Task Packs 章節；`docs/feature-matrix.md` 補充 `skill tasks` 子命令說明。

### Changed

- `src/core/saved-queries/yaml-mini.ts`：擴充支援 YAML block list 語法（`- scalar`、`- key: value` 起始的 sub-map），以承載 Agent Task Packs 的 frontmatter；既有 saved-queries 解析行為不變、66 個既有測試全綠。

## [1.8.0] - 2026-05-06

### Added

- **Redis 與 Elasticsearch 支援**：`init`、`list`、`schema`、`query`、`status`、`use`、`doctor`、`upgrade`、`completion` 在兩個系統皆真實可用。
  - Redis：`list` 透過 SCAN 取 keys；`schema <key>` 顯示 type/TTL/size/sample；`query` 執行白名單 Redis 指令並走原本權限與黑名單檢查。
  - Elasticsearch：`list` 顯示 indices 與文件數；`schema [index]` 攤平 mapping、揭露 `.fields` multi-fields；`query` 接受 DSL JSON 或 Lucene 字串。
- 文件：`assets/SKILL.md` 與 `assets/reference.md` 同步加入 Redis / Elasticsearch 章節。

### Fixed

- **`insert` / `update` / `delete` / `export` / `diff` 對 Redis / Elasticsearch 的早期錯誤訊息**：先前會落入 SQL DataExecutor 出現「Column ... not found in table」之類誤導訊息，現在直接回傳明確的「不支援」JSON，並指引正確替代路徑（Redis 改用 `query`、Elasticsearch 改用外部工具或 `query --index`）。
- **TypeScript 嚴格度**：`bun run typecheck` 從 43 個錯誤降為 0。
  - `ConnectionConfig` union 加入 `ElasticsearchConnectionConfig`。
  - `ResolvedConnection.connection.system`、`ReplContext.system` 涵蓋 `'elasticsearch'`。
  - `ExecutionResult` 補上 optional `rowCount` / `columnNames`。
  - `getDefaultsForSystem` 涵蓋 redis (6379) / elasticsearch (9200) 預設值。

## [1.7.0] - 2026-05-04

### Added

- `dbcli q @<name>` 執行已保存的參數化 SELECT 片段
- `dbcli queries list/show/new/edit/check` 管理片段
- 兩層片段儲存：`.dbcli-shared/queries/`（共享）+ `.dbcli/queries/`（個人覆蓋）
- 完整安全 invariants：拒絕非 SELECT/WITH、多語句、`${...}` / `{{...}}` 模板語法
- 子查詢式 size guard 包裹 (`SELECT * FROM (...) AS _dbcli_guard LIMIT 1000`)
- 內建 YAML 子集 frontmatter parser（無新增 npm 依賴）
- `queries list/show --format json` 為未來 MCP server 預留契約

## [1.6.0] - 2026-04-23

### Added

- **Full MongoDB Support**: Extended all core operations to support MongoDB.
  - Data operations: `query`, `insert`, `update`, `delete`.
  - Safeguards: Integrated `blacklist` protection and `query-size-guard` for MongoDB commands.
  - Discovery: Implemented schema inspection for MongoDB collections.
  - Diagnostics: Added comprehensive MongoDB environment and connection diagnostics to `dbcli doctor`.
- **Improved AI Skill Installation**: `dbcli skill --install` now deploys both `SKILL.md` (high-level workflow) and `reference.md` (full command syntax and examples) to target platforms (Claude Code, Gemini CLI, Copilot, Cursor).
- **Security model enhancement**: `dbcli init` now defaults to a more secure storage model, placing sensitive connection details in `~/.config/dbcli/` rather than the local project workspace.

### Changed

- **Documentation Refactor**: Updated and synchronized documentation (README, README.zh-TW, SKILL.md) to reflect full MongoDB capabilities and first-step walkthroughs.

## [1.5.2] - 2026-04-22

### Fixed

- **Doctor diagnostics for MongoDB SRV**: `dbcli doctor` now reports whether the current execution environment can resolve `mongodb+srv://` connections directly or only through the DNS-over-HTTPS fallback used by the MongoDB adapter.
- **Documentation**: Clarified the new MongoDB SRV environment diagnostic in README, README.zh-TW, and `assets/SKILL.md`.

## [1.5.1] - 2026-04-22

### Fixed

- **MongoDB SRV Connections**: `mongodb+srv://` URIs are now expanded and connected through the MongoDB adapter, and MongoDB operations consistently use the configured database.
- **MongoDB Documentation**: Clarified SRV URI support and configured-database behavior in README, README.zh-TW, and `assets/SKILL.md`.

## [1.5.0] - 2026-04-21

### Added

- **Layered Schema Cache (Wave 1)**: Integrated file-based persistence for database schemas.
  - New `SchemaWriter` for saving schema snapshots to `.dbcli/schemas/`.
  - Layered schema loading (Hot/Cold) integrated into `configModule`.
  - Per-connection isolation: Each connection now has its own schema directory (`.dbcli/schemas/<connection>/`).
- **Improved Migration UX**: Added proactive hints during schema migration to ensure data consistency.
- **Documentation Update**: Added per-connection schema isolation details to `SKILL.md` for AI agents.
  - Clarified schema storage layout in `.dbcli/schemas/`.
  - Added usage examples for `--use <connection>` with schema commands.

## [1.4.1] - 2026-04-21

## [1.3.0] - 2026-04-02

### Added

- **Skill Update Reminders**: Added automated reminders for updating AI agent skills (`SKILL.md`).
  - New `dbcli upgrade` check that notifies if installed skills are outdated compared to the project's `assets/SKILL.md`.
  - Background check in CLI that displays a one-line reminder to stderr after commands finish.
  - Support for checking skills in `.claude/`, `.local/share/gemini/`, etc.

## [1.2.1] - 2026-03-31

### Fixed

- **Config Loader**: Fixed variable naming in `loadConnectionEnv` call, ensuring correct env files are loaded during connection resolution.

## [1.2.0] - 2026-03-31

### Added

- **Multi-connection Support (v2)**: Support for multiple named database connections in a single project.
  - New `dbcli use` command to switch between connections.
  - Named connections with custom `.env` files via `init --conn-name` and `--env-file`.
  - Global `--use <name>` flag to execute commands against a specific connection.
- **Unified DDL Interface (`migrate`)**: Abstracted DDL operations that work across PostgreSQL, MySQL, and MariaDB.
  - 12 subcommands for managing tables, columns, indexes, and constraints.
  - Intelligent SQL generation per database dialect.
  - Default dry-run mode for safety.
- **Enhanced Data Health Checks**: Added `rowCount` and `size` checks to the `dbcli check` command.
- **Comprehensive Documentation**: Updated README (en/zh-TW) with Internals & Strategy sections and new command references.

### Changed

- **Schema Update Strategy**: Refined how and when the schema snapshot in `.dbcli` is updated.
  - Automatic snapshot refresh after successful `migrate` operations.
  - Real-time schema fetching for data modification commands without affecting the snapshot.

---

## [1.1.0] - 2026-03-30

### Changed

- **Adapter `execute()` 回傳型別重構**: 從 `T[]` 改為 `ExecutionResult<T>`，包含 `rows`、`affectedRows`、`lastInsertId` 欄位，DML 操作（INSERT/UPDATE/DELETE）現在回傳正確的 affected rows 計數
- **Export 覆寫確認**: `export --output` 寫入已存在檔案時會提示確認，可用 `--force` 跳過
- **`ExecutionResult<T>` 介面**: 新增統一的查詢結果型別定義於 `src/adapters/types.ts`

---

## [1.0.0] - 2026-03-28

### Stable Release

dbcli v1.0.0 is the first stable release. All three milestones are complete:

- **M1 (v0.6.0):** Smart REPL — interactive shell with SQL + dbcli commands
- **M2 (v0.8.0):** Schema DDL — CREATE/DROP/ALTER TABLE, INDEX, CONSTRAINT, ENUM
- **M3 (v1.0.0):** Stabilization — documentation, permission matrix, known limitations update

### Added

- **`dbcli migrate` command group** (12 subcommands): Full DDL operations with cross-database support
  - `migrate create <table>` — CREATE TABLE with `--column` spec format (`"id:serial:pk"`)
  - `migrate drop <table>` — DROP TABLE with double confirmation (`--execute --force`)
  - `migrate add-column` / `drop-column` / `alter-column` — Column management
  - `migrate add-index` / `drop-index` — Index management (MySQL `--table` option for DROP)
  - `migrate add-constraint` / `drop-constraint` — FK, UNIQUE, CHECK constraints
  - `migrate add-enum` / `alter-enum` / `drop-enum` — PostgreSQL native ENUM support
- **DDLGenerator interface** with PostgreSQL and MySQL/MariaDB dialect implementations
  - PostgreSQL: SERIAL, native ENUM types, ALTER COLUMN TYPE, double-quote identifiers
  - MySQL: AUTO_INCREMENT, inline ENUM, MODIFY COLUMN, backtick identifiers
- **DDLExecutor**: Unified execution pipeline — admin permission check → blacklist protection → SQL generation → dry-run/execute → schema cache auto-refresh
- **Default dry-run for DDL**: All `migrate` commands preview SQL without `--execute`. Destructive operations also require `--force`
- **142 new tests**: column-parser (17), PG DDL (35), MySQL DDL (25), factory (5), DDL executor (22), schema cache DDL (6), CLI migrate (26), live-db migrate lifecycle (6)

### Fixed

- **Schema comment encoding**: Fixed double-encoded UTF-8 comments from MySQL/MariaDB `information_schema` (e.g., `å¸³è™Ÿ` → `帳號`)
- **MySQL connection charset**: Added `charset: utf8mb4` and `SET NAMES utf8mb4`
- **DDL multi-line SQL execution**: Fixed statement splitting to use `;\n` instead of `\n`
- **MySQL DROP INDEX**: Added `--table` option (MariaDB requires `ON <table>`)

### Changed

- **Permission model**: 4 levels — query-only, read-write, data-admin, admin (DDL requires admin)
- **Known Limitations**: Removed "Read-only schema" and "CLI-only" (both resolved). Added "No migration version tracking" as post-v1.0 item
- **Test infrastructure**: `docker-compose.test.yml` for MySQL 8 + PostgreSQL 16 integration testing
- **Package scripts**: Added `test:unit`, `test:integration`, `test:docker`
- **SKILL.md**: Updated with full `migrate` command reference and AI agent guidelines

### Test Results (v1.0.0)

- Unit/Core: 1082 pass, 0 fail
- Live DB (MariaDB 10.11): 61 pass
- Docker Adapter (MySQL 8 + PG 16): 18 pass

---

## [0.6.1-beta] - 2026-03-28

### Encoding Fix & Test Infrastructure

### Fixed

- **Schema comment encoding**: Fixed double-encoded UTF-8 comments from MySQL/MariaDB `information_schema`. Comments stored through latin1 (cp1252) connections now correctly display CJK characters (e.g., `å¸³è™Ÿ` → `帳號`)
- **MySQL connection charset**: Added `charset: utf8mb4` and `SET NAMES utf8mb4` to MySQL adapter connections

### Added

- **`fixDoubleEncodedUtf8()` utility** (`src/utils/encoding.ts`): Detects and reverses cp1252-to-UTF-8 double encoding with full cp1252 reverse mapping table. Applied to schema comments in both MySQL and PostgreSQL adapters
- **`docker-compose.test.yml`**: MySQL 8.4 (port 3307) + PostgreSQL 16 (port 5433) for integration testing, with health checks and tmpfs for fast ephemeral storage
- **Environment-driven adapter tests**: `mysql.test.ts` and `postgresql.test.ts` now read connection from `MYSQL_*` / `PG_*` env vars, falling back to docker-compose defaults. Auto-skip when DB is unreachable
- **`live-db.test.ts`**: 55 comprehensive CLI-level integration tests covering all commands against live MariaDB — list, schema, query, blacklist CRUD, insert/update/delete lifecycle, export, check, diff, status, doctor, shell, format validation, SQL injection protection
- **New test scripts**: `test:unit`, `test:integration`, `test:docker` in package.json

### Test Results

- Unit/Core: 940 pass
- Live DB (MariaDB 10.11): 55 pass
- Adapter (Docker MySQL 8 + PG 16): 18 pass

---

## [0.6.0-beta] - 2026-03-28

### Interactive Shell — Smart REPL

### Added

- **`dbcli shell` command:** Interactive database shell with SQL execution and dbcli command dispatch
- **SQL-only mode:** `--sql` flag restricts to SQL statements only
- **Auto-completion (Tab):** Context-aware completion for SQL keywords, table names, column names, and dbcli commands
- **Multi-line SQL:** Accumulates input until `;` is found, with `...>` continuation prompt
- **SQL syntax highlighting:** Real-time colorization of keywords, strings, and numbers in verbose mode
- **Meta commands:** `.help`, `.quit`/`.exit`, `.clear`, `.format`, `.history`, `.timing`
- **Persistent history:** Stored in `~/.dbcli_history` (max 1000 entries), with up/down navigation and Ctrl+R search
- **Permission & blacklist integration:** Full enforcement within REPL session — SQL goes through PermissionGuard, query results go through blacklist filtering
- **Auto-reconnect:** Attempts to reconnect once on connection errors, then displays error without crashing the session
- **Error resilience:** SQL/permission/connection errors never crash the session
- **i18n support:** All shell messages available in English and Traditional Chinese
- **102 new tests:** input-classifier (25), multiline-buffer (10), meta-commands (15), completer (17), history-manager (8), command-dispatcher (12), repl-engine (12), shell-command (3)

---

## [0.5.2-beta] - 2026-03-27

### Fixed

- **`init --use-env-refs` permission bug**: Interactive env-ref mode now correctly offers all 4 permission levels (was missing `data-admin`)
- **`init` i18n completeness**: All 10 hardcoded English messages replaced with i18n keys (supports en/zh-TW)
- **`init` duplicate code**: Extracted shared `.dbcli exists` overwrite check into `checkOverwrite()` helper
- **`--use-env-refs` help text**: Improved option description to clarify CI/CD and multi-env use case
- **Documentation**: Added `--use-env-refs` to README (en/zh-TW), CHANGELOG, and SKILL.md with AI agent guidance

---

## [0.5.1-beta] - 2026-03-27

### Added

- **Database version check**: Warns on stderr when connected database version is below minimum supported (PostgreSQL 12+, MySQL 8.0+, MariaDB 10.5+). Non-blocking — connection proceeds normally.
- **`dbcli doctor` DB version check**: New "Database version" item in Connection & Data group.
- **`dbcli init --use-env-refs`**: Store environment variable references (`{"$env": "DB_HOST"}`) in config instead of actual values. Supports interactive and non-interactive modes with `--env-host`, `--env-port`, `--env-user`, `--env-password`, `--env-database` options. Suitable for CI/CD and multi-environment deployments.

### Fixed

- **`init` permission bug**: Interactive env-ref mode now correctly offers all 4 permission levels (was missing `data-admin`)
- **`init` i18n**: All hardcoded English messages in init command replaced with i18n keys (10 messages)
- **`init` duplicate code**: Extracted shared `.dbcli exists` overwrite check into `checkOverwrite()` helper

---

## [0.5.0-beta] - 2026-03-27

### UX & Developer Experience — Colors, Logging, Diagnostics, and Tooling

### Added

- **Color system** (`picocolors`): Semantic color helpers (`success`/`error`/`warn`/`info`/`dim`/`bold`) with automatic `NO_COLOR` support
- **SQL syntax highlighting**: Keywords (blue bold), strings (green), numbers (yellow) — applied in verbose mode and dry-run preview
- **Leveled logger**: Four levels — quiet (`-q`), normal (default), verbose (`-v`), debug (`-vv`) — all output to stderr to keep stdout clean for structured data
- **`--no-color` global flag**: Disable colored output; also respects `NO_COLOR` environment variable (<https://no-color.org/>)
- **`-v, --verbose` global flag**: Increase verbosity (`-v` = verbose, `-vv` = debug)
- **`-q, --quiet` global flag**: Suppress non-essential output
- **`dbcli doctor` command**: Full self-diagnostic — checks Bun version, dbcli version (npm registry), config validity, permission level, blacklist completeness (detects unprotected sensitive columns like `password`/`token`/`secret`), database connectivity, schema cache freshness, and large table warnings (> 1M rows). Supports `--format json` for AI agents. Exits with code 1 on errors.
- **`dbcli completion` command**: Shell auto-completion script generation for bash, zsh, and fish. `--install` flag auto-writes to the shell rc file using idempotent marker blocks.
- **`dbcli upgrade` command**: Self-update from npm registry. `--check` flag for check-only mode.
- **Background version check**: Every command silently checks the npm registry (at most once per 24 hours, cached in `.dbcli/version-check.json`). Shows a one-line hint to stderr after the command completes if a newer version is available. Suppressed by `--quiet`.
- **Table formatter colorization**: Table headers now display in bold
- **62 new tests**: colors (7), sql-highlight (6), logger (10), doctor (12), completion (8), upgrade/version-check (19)

### Dependencies

- Added `picocolors` (~0.4 KB) as production dependency

---

## [0.2.0-beta] - 2026-03-26

### Data Access Control — Blacklist System

Added table and column-level blacklisting to protect sensitive data from AI agent access.

### Added

- **`dbcli blacklist` command suite:** Manage blacklist rules via CLI
  - `blacklist list` — display current blacklist configuration
  - `blacklist table add/remove <table>` — manage table-level blacklist
  - `blacklist column add/remove <table>.<column>` — manage column-level blacklist
- **Table-level blacklisting:** Reject all operations (query, insert, update, delete) on blacklisted tables
- **Column-level blacklisting:** Automatically omit blacklisted columns from SELECT results
- **Security notifications:** Footer in table/CSV/JSON output when columns are filtered (e.g., "Security: 2 column(s) were omitted based on your blacklist")
- **Context-aware override:** `DBCLI_OVERRIDE_BLACKLIST=true` environment variable for temporary bypass with warning
- **i18n support:** Blacklist messages in English and Traditional Chinese
- **Performance:** < 1ms overhead per query (O(1) Set/Map lookups)
- **103 new tests:** 83 core + 12 CLI wiring + 8 formatter security tests
- **`dbcli schema --reset`:** Clear all existing schema data and re-fetch from database — solves stale schema after switching DB connections

### Configuration

Blacklist rules stored in `.dbcli`:

```json
{
  "blacklist": {
    "tables": ["audit_logs", "secrets_vault"],
    "columns": {
      "users": ["password_hash", "ssn"]
    }
  }
}
```

---

## [0.1.0-beta] - 2026-03-26

### Initial Release - AI-Ready Database CLI

dbcli v0.1.0-beta is a complete, production-ready CLI tool enabling AI agents and developers to safely interact with PostgreSQL, MySQL, and MariaDB databases through a permission-controlled interface.

**Key Achievement:** Single command-line tool bridging AI agents (Claude Code, Gemini, Copilot, Cursor) to database access without requiring multiple MPC integrations.

---

## Features by Phase

### Phase 1: Project Scaffold

- **Foundation established:** CLI framework with Commander.js v13.0+
- **Build process:** Bun bundler with native TypeScript support (1.1MB binary, <100ms startup)
- **Test infrastructure:** Vitest with 80%+ coverage target
- **Cross-platform CI:** GitHub Actions matrix testing (ubuntu, macos, windows)
- **Code quality:** ESLint + Prettier configured

**Status:** ✅ Complete

---

### Phase 2: Init & Config

- **`dbcli init` command:** Interactive configuration with `.env` parsing
- **Hybrid initialization:** Auto-fills from .env, prompts only for missing values
- **Config management:** `.dbcli` JSON file with immutable copy-on-write semantics
- **Database support preparation:** Multi-database adapter layer foundation
- **RFC 3986 percent-decoding:** Handles special characters in DATABASE_URL passwords
- **Validation:** Zod schemas for type-safe configuration

**Status:** ✅ Complete

**Commands added:** `dbcli init`

---

### Phase 3: DB Connection

- **Multi-database support:** PostgreSQL, MySQL, MariaDB via unified adapter interface
- **Bun.sql integration:** Native SQL API (zero npm dependencies for drivers)
- **Connection testing:** Validates credentials before saving config
- **Error mapping:** Categorized error messages with troubleshooting hints (5 categories: ECONNREFUSED, ETIMEDOUT, AUTH_FAILED, ENOTFOUND, UNKNOWN)
- **Adapter pattern:** Clean abstraction enabling driver swaps without CLI changes

**Status:** ✅ Complete

**Technical:** DatabaseAdapter interface with PostgreSQLAdapter, MySQLAdapter implementations

---

### Phase 4: Permission Model

- **Three-tier permission system:** Query-only, Read-Write, Admin
- **SQL classification:** Character state machine for robust SQL analysis (handles comments, strings, CTEs, subqueries)
- **Permission enforcement:** Coarse-grained checks (no per-table/column fine-grained control in V1)
- **Default-deny approach:** Uncertain operations require Admin mode
- **Zero external dependencies:** Pure TypeScript string processing

**Status:** ✅ Complete

**Technical:** PermissionGuard module with SQL classifier (120+ unit tests)

---

### Phase 5: Schema Discovery

- **`dbcli list` command:** Display all tables with metadata
- **`dbcli schema [table]` command:** Show single table structure or scan entire database
- **Foreign key extraction:** PostgreSQL FK metadata from pg_stat_user_tables; MySQL from REFERENTIAL_CONSTRAINTS
- **Output formatters:** Table (ASCII) and JSON (AI-parseable)
- **Schema storage:** Complete metadata in `.dbcli` for offline AI reference
- **Column details:** Type, constraints, nullable, defaults, primary keys, foreign keys

**Status:** ✅ Complete

**Commands added:** `dbcli list`, `dbcli schema`

**Output formats:** table, json

---

### Phase 6: Query Operations

- **`dbcli query "SQL"` command:** Direct SQL execution with permission enforcement
- **Output formatters:** Table (human-readable), JSON (AI-parseable), CSV (RFC 4180 compliant)
- **Auto-limiting:** Query-only mode limits to 1000 rows (with user notification)
- **Helpful errors:** Levenshtein distance table suggestions for typos
- **Structured results:** Metadata including row count, execution time, columns
- **Permission guarding:** Blocks write operations in Query-only/Read-Write modes

**Status:** ✅ Complete

**Commands added:** `dbcli query`

**Output formats:** table, json, csv

**Libraries:** Levenshtein distance (custom 30-line implementation, no deps)

---

### Phase 7: Data Modification

- **`dbcli insert [table]` command:** Insert rows with parameterized queries
- **`dbcli update [table]` command:** Update existing rows with WHERE clause and SET columns
- **`dbcli delete [table]` command:** Delete rows (Admin-only for safety)
- **Parameterized SQL:** Prevents SQL injection across all modification commands
- **Confirmation flows:** --force flag for bypass; default prompts user
- **Dry-run mode:** `--dry-run` shows SQL without executing
- **Permission enforcement:** Insert/Update require Read-Write+; Delete requires Admin

**Status:** ✅ Complete

**Commands added:** `dbcli insert`, `dbcli update`, `dbcli delete`

**Safety features:** Confirmation prompts, --dry-run, --force override

---

### Phase 8: Schema Refresh & Export

- **`dbcli schema --refresh` command:** Detect and apply schema changes incrementally
- **`dbcli export "SQL"` command:** Export query results as JSON or CSV
- **SchemaDiffEngine:** Two-phase diff algorithm (table-level, column-level)
- **Type normalization:** Case-insensitive comparison for column types
- **Immutable merge:** Preserves metadata.createdAt, updates schemaLastUpdated
- **Streaming output:** CSV generated line-by-line; JSON buffered for validity
- **File output:** `--output file` support for both export and schema refresh

**Status:** ✅ Complete

**Commands enhanced:** `dbcli schema` (added --refresh), new `dbcli export`

**Output:** JSON (standard), CSV (RFC 4180)

---

### Phase 9: AI Integration

- **`dbcli skill` command:** Generate AI-consumable skill documentation
- **SkillGenerator class:** Runtime CLI introspection (collects commands dynamically)
- **Permission-based filtering:** Query-only hides insert/update/delete; Read-Write hides delete
- **SKILL.md format:** YAML frontmatter + markdown (compatible with Claude Code, Gemini, Copilot, Cursor)
- **Platform installation:** `dbcli skill --install {claude|gemini|copilot|cursor}`
- **Cross-platform paths:** Installs to correct location per platform (.claude/, .local/share/gemini/, etc.)
- **Dynamic updates:** Skill regenerates as CLI evolves; no manual documentation maintenance

**Status:** ✅ Complete

**Commands added:** `dbcli skill`

**Installation targets:** Claude Code, Gemini CLI, GitHub Copilot, Cursor IDE

---

### Phase 10: Polish & Distribution

- **npm publication:** `files` whitelist, `engines` constraints, `prepublishOnly` hook
- **Cross-platform validation:** Windows CI matrix with .cmd wrapper verification
- **Comprehensive documentation:** API reference, permission model, AI guide, troubleshooting
- **Performance benchmarking:** CLI startup < 200ms, query overhead < 50ms
- **Release readiness:** v1.0.0 quality gates met, all requirements satisfied

**Status:** ✅ Complete

---

## Known Limitations

- **Single database per project:** Each directory uses one `.dbcli` config. For multi-database setups, use separate directories or `--config` flag. This is by design, not a technical limitation.
- **No audit logging:** WHO/WHAT/WHEN tracking deferred to post-v1.0
- **No migration version tracking:** `migrate` commands execute DDL directly without version history or rollback. The `migrate` namespace is reserved for future migration tracking support.

---

## Compatibility

### Databases

- PostgreSQL 12+
- MySQL 8.0+
- MariaDB 10.5+

### Runtime

- Node.js 18.0.0+
- Bun 1.3.3+

### Platforms

- macOS (Intel, Apple Silicon)
- Linux (x86_64)
- Windows 10+ (via npm .cmd wrapper)

### AI Agents

- Claude Code (Anthropic)
- Gemini CLI (Google)
- GitHub Copilot
- Cursor IDE

---

## Installation

```bash
npm install -g dbcli

# or use with npx (no installation)
npx dbcli init
```

---

## Quick Start

```bash
# Initialize project with database connection
dbcli init

# List tables
dbcli list

# Show table schema
dbcli schema users

# Query data
dbcli query "SELECT * FROM users"

# Generate AI agent skill
dbcli skill --install claude
```

---

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for development setup and release process.

---

## License

See LICENSE file for details.
