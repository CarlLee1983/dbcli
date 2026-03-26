# .dbcli 配置目錄

dbcli 的配置目錄。包含資料庫連接設定、schema 定義等。

## 檔案說明

### config.json
主配置檔案，包含：
- `connection`: 資料庫連接信息（主機、埠、用戶等）
- `permission`: 權限級別 (query-only, read-write, admin)
- `metadata`: 元數據（版本、建立時間）

**注意**: 密碼存儲在 `.env.local` 中，不在此檔案中。

### .env.local ⚠️ (Git 已排除)
敏感信息檔案，包含：
- `DBCLI_PASSWORD`: 資料庫密碼

**重要**: 此檔案包含敏感信息，已在 .gitignore 中排除，絕不應該提交到 git。

### .env.example
`.env.local` 的範本檔案。新開發者可以複製此檔案為 `.env.local` 並填入自己的密碼。

```bash
cp .env.example .env.local
# 編輯 .env.local 並填入密碼
```

### schema.json
資料庫 schema 定義（透過 `dbcli schema --refresh` 命令自動生成）。

包含表格結構、列信息、主鍵、外鍵等。

## 設置步驟

1. **第一次設置**:
   ```bash
   bun run dev init
   ```
   此命令會以互動方式創建或更新 config.json 和 .env.local。

2. **在新環境中設置**:
   ```bash
   cp .dbcli/.env.example .dbcli/.env.local
   # 編輯 .env.local，填入你的資料庫密碼
   ```

3. **更新 schema**:
   ```bash
   bun run dev schema --refresh --force
   ```

## 權限級別

- `query-only`: 只能執行 SELECT 查詢
- `read-write`: 可執行 SELECT、INSERT、UPDATE
- `admin`: 可執行所有操作包括 DELETE、DROP

## 敏感信息安全

- ✅ 密碼存儲在 `.env.local`（.gitignore 中已排除）
- ✅ config.json 不含密碼，可安全提交
- ✅ 新開發者複製 .env.example 建立自己的 .env.local
- ✅ CI/CD 透過環境變數注入密碼
