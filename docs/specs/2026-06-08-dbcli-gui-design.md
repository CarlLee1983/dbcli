# dbcli-gui 設計文件

- **日期**：2026-06-08
- **狀態**：設計核准，待實作計畫
- **工作代號**：`dbcli-gui`（獨立 repo，名稱可後續調整）

## 1. 目標與定位

打造一個**原生桌面資料庫客戶端**，最終目標對標 DBeaver / Sequel Ace，但走自己的 UI/UX 方向，且**比 DBeaver 更省資源**。底層直接 import 現有 `dbcli` 的 core 當引擎，最大化重用既有資產（六種引擎 adapter、permission、blacklist、schema 載入），不重寫資料庫邏輯。

### v1 定位

「輕量查詢工作台」：連線 → 瀏覽 schema → 寫 SQL → 看結果表格 → 匯出。資料編輯、ER 圖、連線管理 UI 等留待後續版本。

## 2. 兩 Repo、兩階段

| Repo | 角色 | 改動 |
|------|------|------|
| 現有 `dbcli`（本 repo） | 底層引擎來源 | 只新增 `./core` subpath export，CLI 行為完全不變 |
| 新 `dbcli-gui` | 桌面 App 本體 | Tauri 殼 + Bun sidecar + React 前端 |

**實作順序**：
1. **階段一（本 repo）**：開好 `./core` 出口並發版到 npm（開發期先用 `bun link`）。
2. **階段二（新 repo）**：建 `dbcli-gui`，`bun add @carllee1983/dbcli` 後 import core，蓋 GUI。

## 3. 整體架構（三層）

```
┌─────────────────────────────────────────────┐
│  Tauri 外殼 (Rust，極薄)                       │
│  • 開系統 webview 視窗（無 Chromium）          │
│  • 啟動/監看/關閉 sidecar 生命週期             │
│  • 原生選單、視窗狀態、未來自動更新/簽章         │
└───────────────┬─────────────────────────────┘
                │ spawn + 健康檢查
                ▼
┌─────────────────────────────────────────────┐
│  Bun sidecar 引擎 (long-lived)               │
│  • import '@carllee1983/dbcli/core'          │
│  • 連線池：connectionId → 已連線 adapter      │
│  • 暴露 local HTTP (127.0.0.1:隨機埠) JSON    │
│  • permission + blacklist 全程沿用 core        │
└───────────────▲─────────────────────────────┘
                │ fetch (localhost, 帶 token)
┌───────────────┴─────────────────────────────┐
│  React webview 前端                           │
│  • 重用現有 ui-template 元件 (recharts/lucide)│
│  • 連線清單 / schema 樹 / SQL 編輯器 / 結果表  │
└─────────────────────────────────────────────┘
```

**切分理由**：Tauri 完全不碰 DB 邏輯（Rust 本來也碰不到 TS core）；DB 能力集中於 Bun sidecar 直接 import core，零重寫；前端純畫面，透過 localhost HTTP 與 sidecar 溝通。三層可獨立測試。

**資源效率**：相比 Electron 每個 app 帶一份 Chromium（~150MB+ 記憶體基線），本方案用系統 webview + 單一 Bun 進程，基線顯著更小。

**通訊方式**：local HTTP（非 stdio JSON-RPC）。

## 4. 元件與介面

### 4.1 Bun sidecar 內部模組

| 模組 | 職責 | 依賴 |
|------|------|------|
| `server.ts` | `Bun.serve()` 起 HTTP、路由、token 驗證、JSON 錯誤封裝 | — |
| `connection-pool.ts` | 管 `connectionId → { adapter, meta }`；建立/重用/釋放連線 | `AdapterFactory` |
| `auth.ts` | 啟動時產生隨機 bearer token，只接受帶對 token 的 localhost 請求 | — |
| `routes/connections.ts` | 列出/測試/開/關連線 | `config-v2`, pool |
| `routes/schema.ts` | 載 schema 樹、單表欄位 | `SchemaLayeredLoader` |
| `routes/query.ts` | 執行 SQL、回傳 rows + meta | `QueryExecutor` |
| `routes/export.ts` | 結果轉 CSV/JSON 串流回前端 | 既有 formatters |

連線池是「持久連線」的關鍵：開一次連線後 adapter 常駐，後續查詢零重連成本——這是 import core 相對 CLI sidecar 模式的核心價值。

### 4.2 Local HTTP API（v1 最小集合）

```
POST /connections/list      → 讀 .dbcli，列出可用連線（不含密碼）
POST /connections/open      { connectionId } → 建池、回 { ok, system }
POST /connections/close     { connectionId }
POST /schema/tree           { connectionId } → [{ table, type, columns? }]
POST /schema/table          { connectionId, table } → 完整欄位/索引
POST /query                 { connectionId, sql, limit? } → { rows, fields, rowCount, ms }
POST /export                { connectionId, sql, format } → 串流 csv/json
GET  /health                → { ok, version }
```

全部走 `127.0.0.1`、`Authorization: Bearer <啟動時 token>`。token 由 Tauri 殼產生後同時注入 sidecar（env）與前端（啟動參數）。外部進程無 token 即被拒。

### 4.3 前端模組

- `api/client.ts` — 包一層 fetch，自動帶 token、統一錯誤處理
- `views/Sidebar` — 連線清單 + schema 樹
- `views/Editor` — SQL 編輯器（v1 輕量 textarea + 語法高亮，不上 Monaco）
- `views/ResultGrid` — 結果表格（虛擬捲動，承接大結果）
- `views/ExportButton` — 重用既有匯出邏輯

**權限預設**：v1 sidecar 預設 dbcli 的 `query-only` permission（自動 LIMIT、擋寫入），與「輕量查詢工作台」定位一致。

## 5. 資料流

### 5.1 一次查詢

```
使用者按「執行」
  → 前端 api/client POST /query { connectionId, sql }（帶 token）
  → sidecar server 驗 token → route/query
      → connection-pool 取出常駐 adapter（已連線，免重連）
      → new QueryExecutor(adapter, 'query-only', blacklistValidator, config)
      → executor.execute(sql)   // permission → auto-LIMIT → blacklist → adapter.execute
      → 回 { rows, fields, rowCount, ms }
  → 前端 ResultGrid 虛擬捲動渲染
```

### 5.2 啟動／關閉

```
Tauri 殼啟動
  → 產生隨機 token + 選空閒埠
  → spawn Bun sidecar（token/埠走 env）
  → 輪詢 GET /health 直到 ok（逾時顯示錯誤頁）
  → 載入 webview，把 token/埠當 query string 傳給前端
關閉視窗 → Tauri 送關閉訊號 → sidecar 釋放所有連線池 → 退出
```

## 6. 本 repo 的改動（階段一，唯一動到 dbcli 的部分）

最小、向下相容，不影響現有 CLI：

1. `package.json` 加 `exports`：
   ```jsonc
   "exports": {
     ".": "./dist/cli.mjs",        // 既有 bin 行為不變
     "./core": "./dist/core.mjs"   // 新增
   }
   ```
2. `scripts/build.ts` 加 entry：把 `src/core/index.ts` + `src/adapters/index.ts` 打包成 `dist/core.mjs`（沿用既有 `@/` alias 處理與 externals）。
3. 補 `src/core/index.ts` 的 re-export，確保 GUI 需要的對外可見：`AdapterFactory`、`QueryExecutor`、`SchemaLayeredLoader`、`config-v2` 的 `resolveConnection`/`listConnections`、`BlacklistManager`/`BlacklistValidator`（目前 adapters 與 config-v2 尚未從 core index 匯出，需補）。
4. `files` 已含 `dist/`，發布自動帶上 `dist/core.mjs`。

外部使用：`bun add @carllee1983/dbcli` → `import { AdapterFactory, QueryExecutor } from '@carllee1983/dbcli/core'`，版本以 semver 鎖。

## 7. v1 範圍（YAGNI 切線）

**v1 做**：
- 讀現有 `.dbcli` 連線設定（不自做連線管理 UI）
- schema 樹瀏覽（table/view 清單 + 單表欄位/索引）
- SQL 編輯器（輕量高亮）+ 執行
- 結果表格（虛擬捲動）+ 排序
- 匯出 CSV/JSON
- query-only 權限、blacklist 保護全程生效
- macOS Apple Silicon 打包（.app + .dmg）

**v1 不做（後續）**：
- 資料 inline 編輯／insert／update／delete（v2）
- 連線管理 UI（寫回 `.dbcli`）（v2）
- ER 圖、視覺化儀表板、多分頁查詢、查詢歷史
- Monaco 編輯器、自動完成
- Windows/Linux、Intel Mac、自動更新、Apple 公證

## 8. 錯誤處理

- **邊界驗證**：所有 route 入口用 zod 驗 body（前後端共用 schema）
- **統一錯誤封裝**：sidecar 回 `{ error: { code, message } }`；core 的 `PermissionError`/`BlacklistError`/`ConnectionError` 對應語意化 code，前端顯示友善訊息（例如 blacklist → 「此表受保護」）
- **sidecar 崩潰**：Tauri 殼偵測 health 失敗 → 顯示「引擎已停止，重啟」按鈕，前端不卡死
- **不吞錯**：原始錯誤進 stderr log，回前端的是使用者安全訊息

## 9. 測試策略

- **sidecar 單元/整合**：`bun test` 直接打 HTTP route，DB 用既有 `docker-compose.test.yml` 測試容器
- **前端元件**：`@testing-library/react`（dbcli devDeps 已具備）接 mock api client
- **E2E**：Playwright 驅動 Tauri webview，跑「開連線 → 查詢 → 看結果 → 匯出」關鍵流程
- 目標 80% 覆蓋率

## 10. 新 repo 專案結構

```
dbcli-gui/
├── src-tauri/          # Rust 殼（薄）：spawn sidecar、視窗、選單
├── sidecar/            # Bun 引擎
│   ├── server.ts
│   ├── connection-pool.ts
│   ├── auth.ts
│   └── routes/{connections,schema,query,export}.ts
├── src/                # React 前端
│   ├── api/client.ts
│   ├── views/{Sidebar,Editor,ResultGrid}.tsx
│   └── components/      # 從 dbcli ui-template 移植 recharts/lucide 元件
├── shared/schemas.ts   # zod，前後端共用
└── tests/{sidecar,frontend,e2e}/
```
