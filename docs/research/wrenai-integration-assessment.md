## WrenAI 官方功能基線

本節只記錄 WrenAI 官方一手資料（官方 GitHub README、同一 repo 的原始碼結構，以及 `docs.getwren.ai` 官方文件）所明確宣告、可與其他資料工具合理比對的能力；不對 Dbcli 作實作評價。查閱日期：2026-08-07。

- **產品定位與核心使用流程（OSS）**：WrenAI 定位為開源 GenBI／AI context layer；代理人可把自然語言問題轉為受治理的 Text-to-SQL 與圖表，並以「Generate → Deploy → Know」流程產出答案、瀏覽器端 dashboard，及以 Git 可審查的 MDL、`instructions.md`、記憶保存上下文。[README「What WrenAI is／GenBI in three beats」](https://github.com/Canner/WrenAI#what-wrenai-is)
- **語意層（OSS）**：Modeling Definition Language (MDL) 定義 models、columns、relationships、views、cubes、metrics；模型與業務規則以可讀、可版本控制的檔案保存，SQL 規劃以 MDL 為契約。[README「Semantic layer (MDL)」](https://github.com/Canner/WrenAI#semantic-layer-mdl)；[MDL 官方概念文件](https://docs.getwren.ai/oss/concepts/what_is_mdl)
- **AI context／記憶（OSS）**：除 schema/MDL 外，官方 context layer 包含業務定義、核准 join、範例、過往 NL→SQL、instructions、skills 與記憶；LanceDB hybrid retrieval 儲存 schema 與 query history。[README「What's Included」](https://github.com/Canner/WrenAI#whats-included)；[Context 官方概念](https://docs.getwren.ai/oss/concepts/what_is_context)
- **Text-to-SQL 正確性原語（OSS）**：官方列出 schema retrieval/linking、value profiling、dry-plan／dry-run、row limits、structured errors、retry/repair 與 golden NL-SQL eval runner；代理人負責編排這些可見原語。[README「Why agent builders pick WrenAI」](https://github.com/Canner/WrenAI#why-agent-builders-pick-wrenai)；[Architecture—Correctness is a system](https://docs.getwren.ai/oss/reference/architecture#correctness-is-a-system)
- **查詢引擎與架構（OSS）**：Rust `wren-core` 以 Apache DataFusion 為基礎，將 MDL modeled SQL 展開、轉譯至目標 dialect 並執行；Python SDK/CLI、PyO3 bindings 與 WASM build 均在公開 repo。官方架構分為 agent workflow、project context、planning engine、execution connectors。[README「Project structure／What's Included」](https://github.com/Canner/WrenAI#project-structure-click-to-expand)；[Architecture](https://docs.getwren.ai/oss/reference/architecture)
- **資料來源（OSS）**：README 宣告 22+ connectors，例包括 BigQuery、Snowflake、PostgreSQL、ClickHouse、Amazon Redshift、Databricks、DuckDB；官方架構文件另列 MySQL、Trino、SQL Server、Oracle、Athena、Apache Spark 等，並指向 connector API 取得最新 schema。[README「Which data sources」](https://github.com/Canner/WrenAI#which-data-sources-does-wren-ai-support)；[Architecture—Connectors](https://docs.getwren.ai/oss/reference/architecture#connectors)
- **代理整合（OSS）**：提供 MCP-native context layer、CLI workflow skills（onboarding、generate-mdl、enrich-context、genbi），以及 `wren-langchain`／`wren-pydantic` SDK；可接 Claude Code、Cursor、Codex 等代理。[README Quickstart](https://github.com/Canner/WrenAI#quickstart)；[SDKs & Integrations](https://docs.getwren.ai/oss/sdk/overview)；[CLI Reference（MCP tools/resources）](https://docs.getwren.ai/oss/reference/cli)
- **Dashboard／部署界線**：開源 core 可產生 browser-side GenBI app（`wren-core-wasm`）並部署至自己的 Vercel 或 Cloudflare Pages；但 GenBI UI、dashboards、embedded/API surface、GenBI Apps 與 agentic mode 被官方列為 Wren AI Cloud／self-hosted Enterprise Plus 商業項目。[README「GenBI dashboards」](https://github.com/Canner/WrenAI#whats-included)；[README「Open core: OSS vs. Cloud / self-hosted」](https://github.com/Canner/WrenAI#open-core-oss-vs-cloud--self-hosted)
- **治理與安全界線**：OSS engine 提供 governed execution primitives（dry-plan、row limits、structured errors）且可自託管 Apache-2.0；RLS/CLS、users/groups access control、advanced audit/security、cloud/VPC/air-gapped deployment、support/SLAs 為 Cloud 或 Enterprise Plus。[README「Open core」](https://github.com/Canner/WrenAI#open-core-oss-vs-cloud--self-hosted)
- **授權與版本脈絡**：README 將 `core/**`、`sdk/**`、`skills/**`、`examples/**` 與 root-level files 標為 Apache-2.0；舊 Docker chat-first GenBI app 已移至 `legacy/v1`（Wren GenBI Classic，無新功能/安全修補），因此比較時需區分現行 OSS engine 與 legacy/商業產品。[README「A note on the GenBI name／License」](https://github.com/Canner/WrenAI#a-note-on-the-genbi-name)

### 未決／需再核實

- README 的「22+」是總數；不同官方文件頁面顯示「17+」或列出不同 connector 子集，精確版本與每個 connector 的能力矩陣應以安裝版本的 connector API/schema 為準。
- Cloud MCP 文件標示 OAuth、organization-level endpoint、RLS/CLS，且 Plan 為 Enterprise Cloud；這些不應推論為 OSS 本地 MCP 的同等身份驗證或多租戶能力。[Wren AI MCP](https://docs.getwren.ai/cp/guide/integrations/wrenai-mcp)

## Dbcli 對照結論（2026-08-07）

**結論：未全部完成。** 本專案已完成的，是刻意縮小為本機、離線、唯讀的 Wren-inspired semantic context 與外部 agent 草稿驗證工作流；WrenAI 的原生 Text-to-SQL 生成、memory、MDL 執行引擎、MCP server、22+ connector runtime、GenBI 部署等能力，並未整合。這是已記錄的產品邊界，不是單純遺漏。

| WrenAI 可比能力 | Dbcli 可驗證狀態 | 證據與邊界 |
| --- | --- | --- |
| 版本化語意模型、欄位、relationships、metrics | **已完成（有意縮小的子集）** | `semantic validate/context/drift/migrate` 實作 `dbcli.semantic.json` v1/v2；relationship 只可引用可見、非 blacklist 的 model field，且不產生 join SQL。見 [`wren-inspired semantic roadmap`](../specs/2026-08-06-wren-inspired-semantic-roadmap.md)。未涵蓋 Wren MDL 的 views、cubes、instructions。 |
| 語意 catalog／retrieval | **已完成（字串搜尋子集）** | `semantic search` 對已驗證的模型、欄位、relationship、metric 做 deterministic 本機搜尋；沒有 embeddings 或 semantic similarity。 |
| 代理產生的 SQL 草稿安全檢查 | **已完成（驗證，不含生成）** | `semantic draft validate --input <file|->` 離線驗證 untrusted `QueryDraft`，不連線、不執行、不回顯 SQL candidate；外部 agent 持有 provider 與 credentials。 |
| dbcli 直接以自然語言／provider 生成 query draft | **未完成；明確 deferred** | `semantic draft generate`、provider SDK、credentials 與 outbound transport 均未獲批准；[`ADR-0005`](../adr/0005-provider-driven-query-drafts-remain-deferred.md) 要求先有產品與安全決策。 |
| 以 MDL 編譯／規劃並執行 SQL | **未整合** | dbcli 維持既有 adapter/query execution gate；semantic module 明確不產生 join SQL 或改變 `query`／`explain` 的權威 gate。 |
| context memory、query history、embedding／LanceDB retrieval | **未整合；不在目前 backlog** | roadmap 明列 embedding/history memory 為不在 backlog 的 WrenAI 能力，因資料保留、模型下載與敏感資訊風險需另立規格。 |
| Wren connector runtime（22+ sources） | **未整合** | dbcli 自有 PostgreSQL、MySQL、MariaDB、MongoDB、Redis、Elasticsearch adapters；未嵌入 Wren 的 Rust/Python/DataFusion runtime 或其 connector 生態。 |
| MCP server | **未整合；明確禁止於目前架構** | roadmap 的 non-negotiable constraint 5：不新增 MCP server；需先修訂 CLI-surface ADR 才能重新考慮。 |
| GenBI dashboard、分享 URL、Vercel／Cloudflare deploy | **未整合（僅有靜態結果 UI）** | dbcli 可用 `query --ui` / HTML export 產生本機 standalone dashboard，但沒有 agent-built GenBI app、hosting deploy 或 share URL；roadmap 將此列為非 backlog。 |
| 多租戶 RLS/CLS、users/groups 存取治理 | **未整合為 Wren 等價能力** | dbcli 有連線 permission、table/column blacklist 與 audit，屬本地 CLI 的防護；沒有 Wren Cloud/Enterprise 的身份、群組與 row/column-level access-control 面。 |

### 對完成度的正確解讀

- 若「借鑑」的範圍是本專案既定 roadmap 的 Slices 1、2、3a，則**已完成**：語意 context v2／drift、catalog search、以及 agent-driven draft validation 都標示為 implemented。
- 若「借鑑」指的是 WrenAI 所呈現的端到端 GenBI 能力，則**尚未完成，且目前不應宣稱要完成**；至少 provider-driven generation 尚被 ADR 封鎖，其餘多項能力也被刻意排除在 backlog 外。

### 本次驗證

- `bun run src/cli.ts semantic --help`：只列出 `validate`、`draft`、`search`、`context`、`drift`、`migrate`，沒有 `generate` 或 MCP command。
- `bun test tests/unit/core/semantic tests/unit/commands/semantic.test.ts tests/integration/semantic-draft-validate.test.ts`：42 pass、0 fail；覆蓋 relationships、drift、catalog search、draft validation 的離線與不執行邊界。
- `git diff --check`：通過。
