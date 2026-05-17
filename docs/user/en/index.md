# dbcli Comprehensive Documentation

<!-- doc-key: overview -->
`dbcli` is a high-performance, security-first Database CLI specifically designed for both human developers and AI agents. It provides a unified interface for SQL (PostgreSQL, MySQL), NoSQL (MongoDB), Key-Value (Redis), and Search (Elasticsearch) databases, featuring permission-based access control, sensitive data blacklisting, and automated diagnostic workflows.

---

## Table of Contents

1.  [Core Philosophy & Security](#core-philosophy--security)
2.  [Getting Started](#getting-started)
3.  [Connection Management](#connection-management)
4.  [Command Reference](#command-reference)
    *   [Discovery & Exploration](#discovery--exploration)
    *   [Querying & Data Operations](#querying--data-operations)
    *   [Snippet Management (Saved Queries)](#snippet-management)
    *   [Health, Diagnostics & Recovery](#health-diagnostics--recovery)
    *   [Advanced Tools (DDL, Shell, AI Skills)](#advanced-tools)
5.  [Interactive HTML Dashboards](#interactive-html-dashboards)
6.  [Database Engine Support Matrix](#database-engine-support-matrix)
7.  [AI Agent Integration & Antigravity Protocol](#ai-agent-integration)
8.  [Documentation Maintenance & Coverage](#documentation-maintenance--coverage)

---

<!-- doc-key: core-philosophy -->
## Core Philosophy & Security

`dbcli` is built with a "Security-First" mindset, particularly focused on preventing AI agents from accidentally leaking or corrupting sensitive data.

*   **Permission Guard**: Four tiers of access control (`query-only`, `read-write`, `data-admin`, `admin`).
*   **Blacklist Manager**: Redacts sensitive tables and columns from all query results.
*   **Query Risk Analyzer (`plan`)**: Analyzes SQL risk without connecting to the database.
*   **Antigravity Protocol**: A workflow separation between **Architect** (Planning) and **Builder** (Execution) to ensure strategy precedes action.

---

<!-- doc-key: getting-started -->
## Getting Started

### Installation
```bash
npm install -g @gravito/dbcli
# or using Bun
bun install -g @gravito/dbcli
```

### Initializing a Connection
The `init` command guides you through setting up your first connection. It can automatically parse existing `.env` files.

```bash
dbcli init
```

**Pro Tip:** Use `--use-env-refs` to keep secrets out of your configuration file and read them from environment variables instead.

---

<!-- doc-key: connection-management -->
## Connection Management

`dbcli` supports multi-connection configurations (v2), allowing you to switch between environments (Staging, Production, Local) seamlessly.

*   **List all connections**: `dbcli use --list`
*   **Switch default connection**: `dbcli use <name>`
*   **One-shot override**: Use the `--use <name>` flag with any command.
    ```bash
    dbcli query --use staging "SELECT 1"
    ```

---

<!-- doc-key: command-reference -->
## Command Reference

<!-- doc-key: discovery-exploration -->
### Discovery & Exploration

| Command | Description |
| :--- | :--- |
| `list` | Lists tables, collections, keys, or indices. |
| `schema [table]` | Displays schema details for a specific object or scans the entire database. |
| `inspect` | Provides a read-only snapshot for AI agents (objects, permissions, suggestions). |
| `status` | Shows a safe summary of the current configuration (no credentials). |

<!-- doc-key: query-data-operations -->
### Querying & Data Operations

| Command | Description |
| :--- | :--- |
| `query "<cmd>"` | Executes raw SQL, MongoDB JSON, Redis commands, or ES DSL. |
| `q @snippet` | Runs a parameterised saved query. |
| `export` | Exports results to JSON, CSV, JSONL, or Interactive HTML. |
| `insert` | Inserts data from JSON (SQL & MongoDB). Accepts `--plan` for risk preflight (SQL, MongoDB, Redis, Elasticsearch). |
| `update` | Updates rows/documents with mandatory `--where` clause. Accepts `--plan` for risk preflight (SQL, MongoDB, Redis, Elasticsearch). |
| `delete` | Deletes data with mandatory `--where` clause. Accepts `--plan` for risk preflight (SQL, MongoDB, Redis, Elasticsearch). |
| `blacklist` | Manages the sensitive data redirection rules. |
| `plan "<sql>"` | **Static analyzer**: Classifies SQL risk and gives recommendations. |

#### DML `--plan` preflight

`insert`, `update`, and `delete` accept `--plan` to run a static risk analyzer against the planned write, **without connecting to the database**. The planner now supports SQL (`postgresql`, `mysql`, `mariadb`), MongoDB, Redis, and Elasticsearch.

*   The planner is static and planner-only: it never instantiates an adapter, never connects, and never refreshes schema.
*   It honors the connection's `permission`, `blacklist` rules, and the cached `schema` for the selected engine.
*   `--format text` (default) prints a human-readable verdict; `--format json` prints the full `QueryRiskResult`.
*   Analyzer `BLOCK` decisions still exit `0` — the verdict is what the agent reads, not the exit code. Configuration / engine / invalid-DSL errors exit `1`.
*   `--plan` is mutually exclusive with `--dry-run`.

Conservative MVP restrictions per engine:

| Engine | BLOCK examples | WARN examples |
| :--- | :--- | :--- |
| SQL | UPDATE/DELETE without WHERE, DDL, blacklisted table | Schema cache missing, blacklisted column referenced |
| MongoDB | Empty filter `{}`, update operator outside `$set`/`$unset`, `$where` | Filter without `_id`, broad `$in`/`$regex`/`$gte`, missing schema |
| Redis | Wildcard `*` target, blacklisted key/field | Pattern target (e.g. `user:*`), missing field info on update |
| Elasticsearch | update/delete without `_id`, blacklisted index/field | Insert without `_id`, missing schema |

`BLOCK` means the planner found an unsafe intent. Still run `--dry-run` on the real command before executing the write.

Examples:

```bash
dbcli insert users --data '{"name":"Alice","email":"a@b.com"}' --plan --format json
dbcli update users --where '{"_id":"abc"}' --set '{"status":"inactive"}' --plan
dbcli delete products --where '{"_id":"abc"}' --plan --format json
dbcli delete 'user:42' --where '' --plan --format json
```

<!-- doc-key: snippet-management -->
### Snippet Management

Saved queries (Snippets) allow you to store complex SQL in your repository. They resolve from three layers: **Local > Shared > Builtin**.

*   **List snippets**: `dbcli queries list`
*   **Search by keywords**: `dbcli queries search <text>`
*   **Suggest by intent**: `dbcli queries suggest perf`
*   **Create new local snippet**: `dbcli queries new @my/query --local`

<!-- doc-key: diagnostics-recovery -->
### Health, Diagnostics & Recovery

| Command | Description |
| :--- | :--- |
| `doctor` | Runs system and connection diagnostics. |
| `check [table]` | Analyzes data health (orphans, nulls, duplicates). |
| `diff` | Compares schema snapshots to detect changes. |
| `report` | Generates a comprehensive health/perf report. |
| `guide <goal>` | Generates a step-by-step troubleshooting plan (e.g., `slow-query`). |
| `recover --apply` | **Automated Recovery**: Applies the last suggested recovery plan. |
| `audit tail` | **Audit Log**: Tails `.dbcli/audit/<conn>.jsonl` (agent-facing JSONL). Use `--for-agent --n 10` for session-handoff JSON. |

<!-- doc-key: advanced-tools -->
### Advanced Tools

| Command | Description |
| :--- | :--- |
| `shell` | Launches an interactive REPL with auto-completion and SQL highlighting. |
| `migrate <action>` | **DDL Engine**: CREATE/ALTER/DROP tables and indexes. |
| `skill --install` | Installs `SKILL.md` instructions for AI agents (Claude, Gemini, etc.). |
| `skill tasks` | Manages "Task Packs" — repeatable expert database workflows. |
| `completion` | Installs shell auto-completion for bash/zsh/fish. |

---

<!-- doc-key: html-dashboards -->
## Interactive HTML Dashboards

Use the `--ui` flag to open query results in a beautiful, interactive React-based dashboard in your browser.

```bash
dbcli query "SELECT * FROM daily_metrics" --ui
```

**KPIs & Charts**: Add a `visual:` block to your snippet's frontmatter to render custom charts (line, bar, pie, etc.) and KPIs directly in the dashboard.

---

<!-- doc-key: engine-support -->
## Database Engine Support Matrix

| Feature | PostgreSQL/MySQL | MongoDB | Redis | Elasticsearch |
| :--- | :---: | :---: | :---: | :---: |
| Basic Querying | ✅ | ✅ | ✅ | ✅ |
| Schema Caching | ✅ | ⚠️ (Sampled) | ❌ | ✅ |
| Saved Snippets | ✅ | ❌ | ✅ | ✅ |
| DML (Insert/Update) | ✅ | ✅ | ✅ (via query) | ❌ |
| DDL (Migrate) | ✅ | ❌ | ❌ | ❌ |
| Interactive UI | ✅ | ✅ | ✅ | ✅ |

---

<!-- doc-key: ai-agent-integration -->
## AI Agent Integration

`dbcli` is designed to be the "DB driver" for AI agents.

1.  **SKILL.md**: Provide the agent with the `SKILL.md` (via `dbcli skill`) so it knows the safe command paths.
2.  **Recovery Envelopes**: When a command fails, use `--recovery` to get a machine-readable JSON error with a suggested fix.
3.  **Risk Gating**: Agents use `dbcli plan`, the per-command `--plan` preflight on `insert`/`update`/`delete`, and `--dry-run` to verify their actions before committing changes.
4.  **Context Efficiency**: `inspect --for-agent` provides exactly the metadata the agent needs to orient itself without bloating its context window.
5.  **Audit Log**: see [`SKILL.md`](../../../assets/SKILL.md) / [`README §Audit Log`](../../../README.md#audit-log).

---

<!-- doc-key: documentation-maintenance -->
## Documentation Maintenance & Coverage

The Markdown (`index.md`) and polished HTML (`index.html`) versions are two presentations of the same user guide. Treat them as a single documentation contract.

### Parity Rules

1.  **Update both files in the same change**: Any new command, flag, workflow, warning, example, or support-matrix entry must appear in both `docs/user/en/index.md` and `docs/user/en/index.html`.
2.  **Keep topic order aligned**: Each shared topic is marked with `<!-- doc-key: ... -->`. Do not add a topic to only one format.
3.  **Match semantics, not styling**: The HTML version may use cards, grids, icons, or short labels, but it must communicate the same required usage, safety notes, examples, and limitations as the Markdown version.
4.  **Mirror supported languages**: When English user docs change, apply the same update to `docs/user/zh-TW/index.md` and `docs/user/zh-TW/index.html`.
5.  **Verify before merging**: Run `bun run docs:check` to confirm Markdown/HTML topic parity for every supported language.

### Coverage Checklist

Use this checklist whenever a feature or command behavior changes:

| Area | Required documentation |
| :--- | :--- |
| Installation & setup | Package install commands, first-run initialization, environment-variable guidance, and safe secret handling. |
| Connections | Multi-connection layout, listing, switching, one-shot `--use`, and environment-specific examples. |
| Discovery | `list`, `schema`, `inspect`, `status`, output formats, and when AI agents should inspect before querying. |
| Reads & writes | `query`, `q`, `export`, `insert`, `update`, `delete`, `--dry-run`, write guards, and examples with expected safety constraints. |
| Snippets | `queries list/search/suggest/new`, resolution order, parameters, and visualization frontmatter. |
| Diagnostics & recovery | `doctor`, `check`, `diff`, `report`, `guide`, `recover`, `--recovery`, and safe remediation boundaries. |
| Advanced tooling | `shell`, `migrate`, `skill --install`, `skill tasks`, `completion`, and supported permission levels. |
| Engines | PostgreSQL/MySQL/MariaDB, MongoDB, Redis, Elasticsearch support differences and known limitations. |
| AI usage | Required workflow order: blacklist check, schema confirmation, dry-run/risk planning, then execution. |
| HTML dashboards | `--ui`, export behavior, chart/KPI configuration, and browser/report expectations. |

### Maintenance Workflow

```bash
# 1. Edit both Markdown and HTML for each supported language.
$EDITOR docs/user/en/index.md docs/user/en/index.html
$EDITOR docs/user/zh-TW/index.md docs/user/zh-TW/index.html

# 2. Verify topic parity.
bun run docs:check

# 3. For command behavior changes, run the relevant CLI tests too.
bun test
```

If a topic intentionally exists in only one format, do not bypass the check silently. Either add the matching `doc-key` block with equivalent content or document why the topic is not user-facing.

---

*Generated by Dbcli Documentation Engine.*
