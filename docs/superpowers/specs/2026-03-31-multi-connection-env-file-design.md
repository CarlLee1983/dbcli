# 多連線與自訂 env 檔案設計

> 日期：2026-03-31
> 狀態：已核可
> 版本：dbcli v2 config format

## 摘要

擴充 dbcli 的連線管理能力：

1. **自訂 env 檔案** — init 時可指定 `.env.staging`、`.env.production` 等，不綁死 `.env`
2. **多連線設計** — 一個專案下可設定多組具名連線，支援預設切換與單次指定

## 設定檔結構（v2 格式）

```json
{
  "version": 2,
  "default": "local",
  "connections": {
    "local": {
      "system": "postgresql",
      "host": "localhost",
      "port": 5432,
      "user": "dev",
      "password": "secret",
      "database": "myapp",
      "permission": "read-write"
    },
    "staging": {
      "envFile": ".env.staging",
      "system": "postgresql",
      "host": { "$env": "DB_HOST" },
      "port": { "$env": "DB_PORT" },
      "user": { "$env": "DB_USER" },
      "password": { "$env": "DB_PASSWORD" },
      "database": { "$env": "DB_NAME" },
      "permission": "query-only"
    }
  },
  "schema": {},
  "blacklist": { "tables": [], "columns": {} },
  "metadata": { "version": "1.1.1", "createdAt": "2026-03-31T00:00:00Z" }
}
```

### 設計決策

- `version` 欄位區分新舊格式。無此欄位 → 舊格式，走原有邏輯
- `envFile` 放在每個連線內，`null` 或省略代表不額外載入（依賴 Bun 預設的 `.env`）
- `permission` 從全域移入每個連線，不同環境可有不同權限
- `schema`、`blacklist` 維持全域（專案級，不隨連線切換）
- 連線欄位直接攤平在連線物件內，保持與舊格式欄位名一致

## CLI 指令介面

### init 指令變更

```bash
# 基本用法（建立名為 default 的連線）
dbcli init

# 指定連線名稱（使用 --conn-name，因為 --name 已用於 Database name）
dbcli init --conn-name staging

# 指定 env 檔案
dbcli init --conn-name staging --env-file .env.staging

# 組合使用（非互動模式）
dbcli init --conn-name prod --env-file .env.production --system postgresql --use-env-refs --skip-test

# 移除連線
dbcli init --remove staging

# 重新命名（使用冒號分隔）
dbcli init --rename staging:production
```

- 不帶 `--conn-name` 時，連線名稱為 `default`
- 如果 config 已存在且是 v2 格式，新增連線進 `connections`（同名則提示覆蓋）
- 如果 config 不存在，建立全新的 v2 格式
- `--env-file` 指定的路徑存入該連線的 `envFile` 欄位，init 過程中也從該檔案載入變數

### 新增 use 指令

```bash
# 切換預設連線
dbcli use staging

# 查看目前預設
dbcli use

# 列出所有連線
dbcli use --list
```

輸出範例：

```
  default   postgresql  localhost:5432/myapp
* staging   postgresql  staging.example.com:5432/myapp
```

### 全域 --use 選項

```bash
# 單次指定連線（不改變 default）
dbcli query --use staging "SELECT * FROM users LIMIT 10"
dbcli list --use prod
dbcli schema users --use staging
dbcli export --use prod "SELECT * FROM orders" --format csv
```

優先順序：`--use` 參數 > `default` 設定

## env 檔案載入機制

### 載入優先順序

```
1. 當前連線的 envFile 設定值
2. Bun 預設行為（自動載入 .env）
```

### 載入邏輯

- `envFile` 路徑相對於專案根目錄（`.dbcli` 所在處）
- 載入時不覆蓋已存在的環境變數（與 dotenv 慣例一致）
- 指定的檔案若不存在，直接報錯而非靜默忽略
- 載入發生在 `$env` 參照解析之前，確保變數可用
- 不引入 dotenv 套件，用 Bun 內建能力（`Bun.file` 讀取 + 手動 parse）

### 時序

```
CLI 啟動
  → Bun 自動載入 .env
  → 讀取 .dbcli/config.json
  → 確定使用的連線（--use 或 default）
  → 載入該連線的 envFile（如有）
  → 解析 $env 參照
  → 建立資料庫連線
```

## 向後相容

### 格式偵測

- 有 `version: 2` 且有 `connections` → 新格式
- 否則 → 舊格式（含 `connection` 單數欄位）

### 舊格式處理

- 偵測到舊格式 → 完全走原有邏輯，不做任何轉換
- 所有現有行為不受影響，包括 `.dbcli` 單檔模式和 `.dbcli/` 目錄模式
- `--use`、`dbcli use` 等新指令在舊格式下不可用，給出提示

### 新舊轉換

- 不自動遷移，使用者重新 `dbcli init` 時才產生 v2 格式
- 舊格式專案若執行 `dbcli init`（不帶新參數），行為不變，產生舊格式
- 使用 `--name` 或 `--env-file` 等新參數時，才產生 v2 格式
- 已存在舊格式設定 + 使用新參數 init → 提示使用者將現有連線匯入為 `default`

### config 模組

- 讀取時統一轉為內部表示，對外 API 不變
- 所有指令拿到的仍是解析後的單一連線 + permission + schema + blacklist
- 多連線複雜度封裝在 config 模組內部

## 錯誤處理

| 情境 | 處理方式 |
|------|----------|
| `--use foo` 但 `foo` 不存在 | 報錯：「連線 'foo' 不存在。可用連線：default, staging」 |
| `--env-file .env.staging` 但檔案不存在 | 報錯：「找不到 env 檔案：.env.staging」 |
| `envFile` 設定了但檔案被刪除 | 報錯並建議重新設定 |
| `$env` 參照的變數不存在 | 報錯：「環境變數 DB_HOST 未定義（連線 'staging'，來源：.env.staging）」 |
| `dbcli init --remove default` 且只剩一個連線 | 報錯：「無法移除最後一個連線」 |
| `dbcli init --remove` 的連線是當前 default | 移除後自動指向第一個剩餘連線，並提示 |
| `dbcli use` 在舊格式下 | 報錯並建議使用 `dbcli init --name <名稱>` 建立新格式 |

## doctor 指令擴充

v2 格式下額外檢查：

- 所有連線的 `envFile` 是否存在
- 所有 `$env` 參照是否可解析
- `default` 指向的連線是否存在
