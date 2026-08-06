# WrenAI 功能分析（供 dbcli 評估）

> 範圍：僅查閱 Canner/WrenAI 原始碼、其 GitHub README，以及官方文件 `docs.getwren.ai`。文中「觀察」是來源直接陳述；「建議」是針對本地安全優先 CLI 的推論，並非 WrenAI 承諾。

## 產品能力

- **觀察：** WrenAI 是開源 GenBI 引擎，提供受治理的 text-to-SQL、圖表與可分享儀表板；以 MDL（Modeling Definition Language）語意層保存模型、欄位、關係、視圖、cube/metric，並以 `instructions.md`、`queries.yml` 補充業務語意。[GitHub README](https://github.com/Canner/WrenAI/blob/main/README.md#what-wrenai-is) · [Semantic layer](https://github.com/Canner/WrenAI/blob/main/README.md#semantic-layer-mdl)
- **觀察：** CLI 可初始化專案、將 YAML 編譯為 `target/mdl.json`、執行 SQL/cube 查詢；可選 memory（LanceDB）索引 schema 與 NL→SQL 歷史，亦可提供 MCP（stdio 或 HTTP）服務。[core/wren README](https://github.com/Canner/WrenAI/blob/main/core/wren/README.md#quick-start)
- **觀察：** GenBI 流程會產生瀏覽器端 app（`wren-core-wasm`），可預覽並部署至 Vercel 或 Cloudflare Pages；部署指令預設 preview，`--prod` 才是正式部署。[GenBI guide](https://docs.getwren.ai/oss/guides/genbi) · [CLI skills](https://docs.getwren.ai/oss/reference/skills)

## 核心架構與依賴

- **觀察：** 架構把「context」與「execution」分離：專案檔定義 MDL/指令/記憶，context build 驗證並編譯 MDL；memory index/fetch/recall/store 提供語意檢索與已確認範例；planner 與 Rust 引擎把模型化 SQL 轉為可執行 SQL，再交由 connector 執行。[官方架構](https://docs.getwren.ai/oss/reference/architecture)
- **觀察：** Rust 引擎以 Apache DataFusion 53 為核心，並提供 Python（PyO3）與 WASM binding；Python CLI/SDK 依賴 `wren-core-py`、`sqlglot`、DuckDB、PyArrow、Pydantic 等。[Repository map](https://github.com/Canner/WrenAI#repository-map) · [Cargo workspace](https://github.com/Canner/WrenAI/blob/main/core/wren-core/Cargo.toml) · [pyproject.toml](https://github.com/Canner/WrenAI/blob/main/core/wren/pyproject.toml)
- **觀察：** Python 套件要求 Python 3.11+；資料源 connector 以 optional extras 安裝（PostgreSQL、MySQL、BigQuery、Snowflake、ClickHouse、Trino、MSSQL、Databricks、Redshift、Spark、Athena、Oracle 等），memory/MCP/UI 也各自是 optional extras。[core/wren README](https://github.com/Canner/WrenAI/blob/main/core/wren/README.md#installation) · [pyproject dependencies](https://github.com/Canner/WrenAI/blob/main/core/wren/pyproject.toml)

## 功能成熟度與營運要求

- **觀察：** `pyproject.toml` 將 `wrenai` 分類為 `Development Status :: 4 - Beta`；README 同時標示引擎於 2026-05-07 合併至本 repo，舊 Docker chat-first 產品保留在 `legacy/v1`，表示目前主線與舊產品有明確代際差異。[pyproject.toml](https://github.com/Canner/WrenAI/blob/main/core/wren/pyproject.toml) · [README migration note](https://github.com/Canner/WrenAI#what-wrenai-is)
- **觀察：** 安全選項包含 `strict_mode`（拒絕 MDL 未宣告的 table）與 `denied_functions`；GenBI 部署 token 從環境/.env 讀取而非 CLI 旗標，Cloudflare 另要求 `wrangler`。[core/wren README](https://github.com/Canner/WrenAI/blob/main/core/wren/README.md#5-optional-configure-security-policy) · [GenBI guide](https://docs.getwren.ai/oss/guides/genbi)
- **建議：** 引入 Wren 功能須把 Python 3.11、Rust/DataFusion、optional connector、向量模型下載、Vercel/Cloudflare token 與可能的 MCP HTTP 服務視為額外部署面；本地 CLI 應預設離線/唯讀，將 memory、GenBI、HTTP MCP 視為明確 opt-in，而非核心依賴。

## 與本地安全優先 dbcli 的相容性對照

| WrenAI 能力 | 相容性判定 | 理由（dbcli 邊界） |
|---|---|---|
| MDL/語意模型、版本化 context 檔 | **相容（建議只讀匯入）** | 可作為 schema/業務語意的額外檢索來源；dbcli 仍以實際 `schema`、blacklist 與權限檢查為準。 |
| DataFusion/sqlglot SQL 轉換與 dry-plan | **部分相容** | 可借鑑解析/預檢；不可繞過 dbcli 既有 `--dry-run`、row limit、permission tier 與 recovery gates。 |
| Wren connector（20+ 資料源） | **部分相容** | dbcli 已有多資料庫/非 SQL 介面，但直接嵌入 Python connector 會破壞 Bun/TypeScript 單一 CLI 與既有連線設定，宜以外部橋接或匯出 SQL。 |
| memory（LanceDB + sentence-transformers） | **部分相容、預設關閉** | 可提供歷史查詢檢索；向量索引與模型下載增加本地資料留存、資源與敏感資訊風險，需受 blacklist/retention 管控。 |
| MCP server（stdio/HTTP） | **stdio 相容；HTTP 有風險** | stdio 子程序符合本地 agent 工作流；HTTP 會新增網路暴露面，必須另設認證、bind/防火牆與唯讀策略。 |
| GenBI 產生/部署公開 URL | **不相容於核心安全邊界** | 會複製查詢結果至瀏覽器 app/第三方 hosting；不應由安全優先 CLI 默認啟用，且需獨立同意與 secret scan。 |

## 未解問題

- Wren strict mode/denied functions 與 dbcli blacklist（尤其欄位輸出遮罩）如何在同一查詢鏈中保持一致，官方目前未提供 dbcli 整合規格。
- 官方文件列出 connector 能力，但各資料源的完整讀寫、交易與權限差異仍需逐 connector 驗證；本分析未連線或操作任何資料庫。
