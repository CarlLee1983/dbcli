# MongoDB 逐欄連線設定

**狀態**：Ready for implementation
**決策依據**：`docs/adr/0002-mongodb-connection-field-first-config.md`
**基準版本**：v1.45.1

讓 MongoDB 的連線設定能像 SQL 一樣逐欄填寫，並把 `dbcli init` 的互動預設
從「貼 URI」翻轉為「逐欄詢問」。

## 範圍

含 A（補齊欄位與拼接）與 B（翻轉 init 預設）。C（`upsertConnection` /
`migrateV1ToV2` / `env-parser` 支援 mongo、密碼自動抽進 envFile）不在本次範圍，
於文末列為後續。

---

## A. 補齊欄位與拼接

### A1. schema 新增欄位

`src/utils/validation.ts` 的 `MongoDBConnectionConfigSchema` 新增四個 optional 欄位：

| 欄位 | 型別 | 預設 | 說明 |
| --- | --- | --- | --- |
| `authSource` | `string \| EnvRef` | `undefined` | 認證資料庫；未填且有帳密時，拼接階段套用 `admin` |
| `replicaSet` | `string \| EnvRef` | `undefined` | 複本集名稱 |
| `tls` | `boolean` | `undefined` | 明示開關；`srv: true` 時預設視為 `true` |
| `srv` | `boolean` | `false` | 走 `mongodb+srv://`，啟用 DNS SRV 展開 |

`srv: true` 時 `port` 無意義（SRV 記錄自帶埠），驗證階段若同時明示 `port`
且非預設值 27017 則發出警告，不阻擋。

### A2. `buildUri()` 改寫

`src/adapters/mongodb-adapter.ts`。現況三個缺陷：只 `encodeURIComponent(password)`、
`user` / `database` / `host` 未跳脫、`if (user && password)` 在只填 user 時
靜默丟棄整段認證。

改為以 `URL` 物件組裝，並回傳「標準形式 URI」而非最終 URI：

- scheme 依 `srv` 決定為 `mongodb+srv://` 或 `mongodb://`；`srv` 時不附 port。
- `username` / `password` 經 `encodeURIComponent`；`database` 作為 pathname
  同樣跳脫。`host` 不做 encode（合法 hostname 不需要），但驗證其不含 `/@?#`，
  含則拋 `ConnectionError`。
- `user` 有值而 `password` 為空 → 拋 `ConnectionError`，訊息明確指出
  「已指定 user 但未提供 password；若確定要無認證連線請一併清空 user」。
  這取代原本的靜默降級。
- query 參數依序帶入 `authSource`（有帳密時預設 `admin`）、`replicaSet`、`tls`。

### A3. SRV 展開統一

現況 `buildResolvedUri()` 僅在 `this.options.uri` 存在且開頭為 `mongodb+srv://`
時展開，逐欄路徑直接 `return this.buildUri()`，`srv: true` 不會生效。

改為：先取得標準形式 URI（`this.options.uri ?? this.buildUri()`），再一律檢查
開頭是否為 `mongodb+srv://`，是則走既有的 `resolveSrvHosts()` / `resolveTxtOptions()`
/ 預設 `tls=true` / 預設 `authSource=admin` 流程。兩條來源共用同一段解析。

`uri` 與逐欄欄位同時存在時 `uri` 優先（維持現況），但在設定驗證階段發出警告。

### A4. 連線錯誤分類

`connect()` 現只分 `ECONNREFUSED` / `ETIMEDOUT` / `UNKNOWN`，hints 為兩條泛用訊息。
新增分類與對應 hints：

- 認證失敗（`Authentication failed` / code 18）→ 提示檢查 `authSource`，並說明
  Atlas 使用者通常為 `admin`。
- SRV / DNS 解析失敗 → 提示確認 `srv` 設定與網路 DNS。
- TLS 握手失敗 → 提示 `tls` 欄位與自簽憑證情境。

---

## B. 翻轉 init 預設

`src/commands/init.ts` 的 `handleMongoDBInit()`（現 731-855）。

### B1. 互動順序

改為先問連線方式，預設選項為逐欄：

1. 「連線設定方式」單選 —「逐欄填寫（建議）」/「貼上完整連線字串（進階）」。
2. 逐欄分支依序詢問：`host`、`port`（`srv` 時略過）、`user`、`password`、
   `database`、`authSource`（預設 `admin`，可留空）、進階選項（`srv`、`tls`、
   `replicaSet`，收合在一個「設定進階選項？」的 yes/no 之後）。
3. URI 分支維持現況：問 URI 與 database。

`--uri` flag 存在時直接走 URI 分支、不提問，維持現有非互動行為不變。
`--auth-source` flag 此後真正生效（A1 已讓它能落盤）。

### B2. 接上 env-ref 精靈

mongo 目前在 `init.ts:440-449` early-return，繞過 `462-520` 的 env-ref 分支。
改為讓逐欄分支也支援 `--use-env-refs`，把 `password`（以及有指定時的 `user`）
寫成 `{"$env": ...}` 並產生對應 env 檔項目。URI 分支不套用（URI 整條走 env-ref
是既有的手改路徑，不在本次擴充）。

### B3. 佔位值

逐欄分支不再寫入 `host: ''` / `user: ''` 這類佔位值。URI 分支維持現況佔位，
`src/commands/use.ts:81-88` 的 null 顯示特判不動。

---

## 測試（TDD，先 RED）

`tests/` 下新增與擴充：

- schema：四個新欄位的 parse / 預設 / env-ref 形式；`authSource` 不再被 strip
  （這是現況的迴歸點，必須有一條明確斷言）。
- `buildUri()`：帳密含 `@:/` 特殊字元的跳脫；`database` 含特殊字元；
  只填 user 無 password 拋錯；`srv: true` 產出 `mongodb+srv://` 且不含 port；
  `authSource` / `replicaSet` / `tls` 進 query。
- `buildResolvedUri()`：逐欄 `srv: true` 會觸發 SRV 展開（既有 SRV mock 沿用）；
  `uri` 與逐欄並存時 `uri` 優先。
- `connect()` 錯誤分類三種新 hints。
- init：逐欄分支的提問順序與產出設定；`--uri` 非互動行為不變（迴歸點）。

---

## 文件

依 AGENTS.md 的 Documentation Mandate 與 Multi-language Parity：

- `docs/user/en/index.md` 與 `docs/user/zh-TW/index.md`，`index.md` 與
  `index.html` 皆須同步。
- `docs/feature-matrix.md:16`（「MongoDB accepts URI or host/port」）與
  84-88 的 limitations 一節。
- `skills/dbcli/SKILL.md:232-234` 與 `skills/dbcli/reference.md`（36 / 2028 /
  2603 / 2627）現皆只教貼 URI，改以逐欄為主要範例。
- `CHANGELOG.md` 標註 init 互動順序為 **BREAKING**。

## 實作偏離

實作過程中對本規格的兩處刻意偏離：

- **警告放在 `doctor` 而非設定載入層。** A3 與 A1 原寫「驗證階段發出警告」，但設定載入是所有指令共用的靜默路徑，在那裡印警告會污染每一次執行。`uri` 與逐欄並存、以及 `srv` 搭配非預設 `port` 這兩個警告改實作在 `collectMongoDoctorResults()`（`src/commands/doctor.ts`）—— 使用者發現「改了欄位卻沒生效」時本來就會去跑 `doctor`。
- **`srv` 不在「進階選項」收合之內。** B1 原把 `srv` 與 `tls` / `replicaSet` 一起收在進階提問後面，但 `srv` 決定要不要問 `port`，必須先問。實作改為 `Host` 之後立刻問「這是 SRV 網域嗎」，`tls` 與 `replicaSet` 留在進階收合中。
- **B3「不寫入佔位值」只對 URI 模式成立。** 逐欄分支仍會寫出 `user: ''` / `password: ''`。這與 URI 模式的 `host: ''` 性質不同：空字串是 mongo schema 對「無認證」的既有表示法（`src/types/index.ts` 的註解說明 Redis 也沿用同一模式），省略它反而讓「沒有帳號」與「忘了設定」無法區分。URI 模式的假 `host` / `port` 佔位值維持現況未動，`src/commands/use.ts:81-88` 的 null 顯示特判因此仍然必要。
- **env-ref 的欄位規則比 SQL 寬鬆。** SQL 路徑要求非互動時提供全部五個 `--env-*`；MongoDB 只要求 `--env-host`，其餘留空即寫入字面值而不產生 `$env`。理由是 `src/agent-core/env-ref.ts` 對未定義變數是硬拋 `ConfigError`，若為無認證連線強制寫出 `user`/`password` 的 `$env`，之後每一個指令都會失敗在使用者根本不需要設定的變數上。env-ref 模式同樣跳過連線測試（參照此時還沒有值），與 SQL 路徑一致。

## 已知未處理

- **init 的 MongoDB 提問字串硬編中文，未走 `t()`。** 同檔 SQL 路徑用 `t('init.prompt_host')`，mongo 分支（含改動前的原始碼）一律硬編。模式判斷已改為比對 `SETUP_MODES` 常數而非字面值，字串進 i18n 時不會壞掉，但字串本身尚未 i18n 化。
- **密碼提問使用 `promptUser.text`，輸入會明文回顯**，`src/utils/prompts.ts` 沒有 masked 版本。屬既有問題，但逐欄成為主路徑後被觸及的頻率會上升。
- **URI 模式不驗證貼入字串的 scheme**，`postgres://…` 也會被收下。
- **mongo 分支不使用 `ctx.shouldPrompt`。** SQL 路徑在「`--use-env-refs` 且五個 `--env-*` 齊全」時會自動轉為非互動；mongo 只看 TTY，因此同樣的旗標組合在 TTY 上仍會問「連線設定方式」與「這是 SRV 網域嗎」。非 TTY（CI）不受影響。同理互動時即使給了 `--host` / `--user`，mongo 仍會再問一次，SQL 則是旗標優先。這兩處不一致是既有結構造成，統一它需要動 SQL 路徑，不在本次範圍。
- **非互動 `--port abc` 的錯誤訊息是 zod union dump**，會列出 postgres 的 enum，對 mongo 使用者難以理解。NaN 本身不會落盤（寫檔前的 schema 驗證擋下，fail closed），只是訊息品質差。
- **`authSource` 在無帳號時被丟棄**，env-ref 分支即使有 `userRef` 也不會補預設 `admin`。runtime 兩條路徑都會退回 `admin`，行為無誤，但設定檔內容不一致。

## 後續（不在本次範圍）

- `upsertConnection` / `migrateV1ToV2`（`src/core/config-v2-mutations.ts:60-96`）
  型別上只吃 `SqlSystem`，mongo 無法走「secret 自動寫入 envFile」路徑。
- `src/core/env-parser.ts` 對 `DATABASE_URL=mongodb://...` 拋 `Unsupported protocol`。
- URI 模式帳密明文落盤（`src/core/config.ts:493-522` 以 `password` 是否為
  env-ref 判斷）。逐欄成為主路徑後此問題的影響面縮小，但未消除。
