# dbcli Comprehensive Documentation

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

---

## Core Philosophy & Security

`dbcli` is built with a "Security-First" mindset, particularly focused on preventing AI agents from accidentally leaking or corrupting sensitive data.

*   **Permission Guard**: Four tiers of access control (`query-only`, `read-write`, `data-admin`, `admin`).
*   **Blacklist Manager**: Redacts sensitive tables and columns from all query results.
*   **Query Risk Analyzer (`plan`)**: Analyzes SQL risk without connecting to the database.
*   **Antigravity Protocol**: A workflow separation between **Architect** (Planning) and **Builder** (Execution) to ensure strategy precedes action.

---

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

## Connection Management

`dbcli` supports multi-connection configurations (v2), allowing you to switch between environments (Staging, Production, Local) seamlessly.

*   **List all connections**: `dbcli use --list`
*   **Switch default connection**: `dbcli use <name>`
*   **One-shot override**: Use the `--use <name>` flag with any command.
    ```bash
    dbcli query --use staging "SELECT 1"
    ```

---

## Command Reference

### Discovery & Exploration

| Command | Description |
| :--- | :--- |
| `list` | Lists tables, collections, keys, or indices. |
| `schema [table]` | Displays schema details for a specific object or scans the entire database. |
| `inspect` | Provides a read-only snapshot for AI agents (objects, permissions, suggestions). |
| `status` | Shows a safe summary of the current configuration (no credentials). |

### Querying & Data Operations

| Command | Description |
| :--- | :--- |
| `query "<cmd>"` | Executes raw SQL, MongoDB JSON, Redis commands, or ES DSL. |
| `q @snippet` | Runs a parameterised saved query. |
| `export` | Exports results to JSON, CSV, JSONL, or Interactive HTML. |
| `insert` | Inserts data from JSON (SQL & MongoDB). |
| `update` | Updates rows/documents with mandatory `--where` clause. |
| `delete` | Deletes data with mandatory `--where` clause. |
| `blacklist` | Manages the sensitive data redirection rules. |
| `plan "<sql>"` | **Static analyzer**: Classifies SQL risk and gives recommendations. |

### Snippet Management

Saved queries (Snippets) allow you to store complex SQL in your repository. They resolve from three layers: **Local > Shared > Builtin**.

*   **List snippets**: `dbcli queries list`
*   **Search by keywords**: `dbcli queries search <text>`
*   **Suggest by intent**: `dbcli queries suggest perf`
*   **Create new local snippet**: `dbcli queries new @my/query --local`

### Health, Diagnostics & Recovery

| Command | Description |
| :--- | :--- |
| `doctor` | Runs system and connection diagnostics. |
| `check [table]` | Analyzes data health (orphans, nulls, duplicates). |
| `diff` | Compares schema snapshots to detect changes. |
| `report` | Generates a comprehensive health/perf report. |
| `guide <goal>` | Generates a step-by-step troubleshooting plan (e.g., `slow-query`). |
| `recover --apply` | **Automated Recovery**: Applies the last suggested recovery plan. |

### Advanced Tools

| Command | Description |
| :--- | :--- |
| `shell` | Launches an interactive REPL with auto-completion and SQL highlighting. |
| `migrate <action>` | **DDL Engine**: CREATE/ALTER/DROP tables and indexes. |
| `skill --install` | Installs `SKILL.md` instructions for AI agents (Claude, Gemini, etc.). |
| `skill tasks` | Manages "Task Packs" — repeatable expert database workflows. |
| `completion` | Installs shell auto-completion for bash/zsh/fish. |

---

## Interactive HTML Dashboards

Use the `--ui` flag to open query results in a beautiful, interactive React-based dashboard in your browser.

```bash
dbcli query "SELECT * FROM daily_metrics" --ui
```

**KPIs & Charts**: Add a `visual:` block to your snippet's frontmatter to render custom charts (line, bar, pie, etc.) and KPIs directly in the dashboard.

---

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

## AI Agent Integration

`dbcli` is designed to be the "DB driver" for AI agents.

1.  **SKILL.md**: Provide the agent with the `SKILL.md` (via `dbcli skill`) so it knows the safe command paths.
2.  **Recovery Envelopes**: When a command fails, use `--recovery` to get a machine-readable JSON error with a suggested fix.
3.  **Risk Gating**: Agents use `dbcli plan` and `--dry-run` to verify their actions before committing changes.
4.  **Context Efficiency**: `inspect --for-agent` provides exactly the metadata the agent needs to orient itself without bloating its context window.

---

*Generated by Dbcli Documentation Engine.*
