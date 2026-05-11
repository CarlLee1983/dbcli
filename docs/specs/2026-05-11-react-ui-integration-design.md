# Dbcli Interactive UI Integration Design Specification

**Date:** 2026-05-11
**Status:** Approved for Implementation Planning
**Author:** AI Agent (with User input)
**Context:** The current terminal-based table output is insufficient for complex data, trend analysis, and sharing. We need a way to present query results in an interactive, human-readable format (React-based dashboard) while keeping the CLI lightweight.

## 1. Goal & Core Philosophy

**Goal:** Enable `dbcli` to output database query results as fully interactive, standalone HTML dashboards without requiring a persistent backend server.

**Philosophy:**
- **Asset-Driven:** UI configuration lives alongside the SQL logic in the Saved Query (@snippet) YAML frontmatter.
- **Zero-Dependency Runtime:** The generated HTML must be completely self-contained (Single-File Artifact) so it can be shared via email, opened locally, or rendered by AI platforms.
- **Progressive Enhancement:** If no UI config is present, or if `--ui` is not passed, fall back to the standard terminal table.

## 2. Visual Metadata Schema (YAML Frontmatter)

Saved queries (`.sql` or `.yaml` in `.dbcli/queries/`) will support a new `visual` block.

```yaml
# ---
# name: daily_sales
# description: Daily revenue and order trends
# visual:
#   title: "Daily Sales Performance"
#   kpis:
#     - label: "Total Revenue"
#       value_column: "total_amount" # Automatically sums or picks the latest if 1 row
#       format: "currency"
#     - label: "Total Orders"
#       value_column: "order_count"
#       format: "number"
#   charts:
#     - type: "area"          # Supported: line, bar, area, pie
#       title: "Revenue Trend"
#       x: "date"
#       y: ["total_amount"]
#       labels: ["Revenue"]
# ---
SELECT DATE(created_at) as date, SUM(amount) as total_amount, COUNT(id) as order_count
FROM orders GROUP BY DATE(created_at) ORDER BY date DESC LIMIT 30;
```

## 3. Architecture: Pre-compiled Template + Data Injection

To avoid shipping a Node.js web server or Vite runtime with `dbcli`, we will use a template injection strategy.

### 3.1 Build Phase (dbcli Development)
1. We create a dedicated React application inside the `dbcli` repository (e.g., `src/ui-template`).
2. It uses Vite to bundle React, Tailwind CSS, Recharts, and Lucide Icons into a **single, minified HTML string**.
3. Inside this HTML, we place a global variable placeholder: `window.__DBCLI_PAYLOAD__ = {{{PAYLOAD}}};`.
4. This minified HTML string is embedded into a TypeScript file (e.g., `src/formatters/html-template.ts`) during the `dbcli` build process.

### 3.2 Execution Phase (Runtime)
When a user runs `dbcli query @daily_sales --ui`:
1. `dbcli` executes the query and gets the JSON result.
2. `dbcli` extracts the `visual` block from the frontmatter.
3. It constructs the payload object: `const payload = { data: queryResult, config: visualConfig };`
4. It takes the pre-compiled HTML string and replaces `{{{PAYLOAD}}}` with `JSON.stringify(payload)`.
5. The resulting HTML is written to a temporary file (e.g., `/tmp/dbcli-report-xxx.html`).
6. `dbcli` uses the system's default command (`open`, `xdg-open`, `start`) to launch the browser pointing to this file.

## 4. CLI Interface Changes

Extend the existing query commands to support the new output format.

*   `dbcli query "SELECT * FROM users" --ui` -> Basic interactive table without charts.
*   `dbcli q @daily_sales --ui` -> Full dashboard based on the YAML config.
*   `dbcli q @daily_sales --format html > report.html` -> Exports the interactive dashboard to a file instead of auto-opening it.

## 5. Security & AI Synergy Considerations

*   **No Data Exfiltration:** The generated HTML contains no external network requests for data. The data is hardcoded into the file at generation time.
*   **AI Artifacts:** AI Agents (Claude, Gemini) can execute `dbcli q @name --format html`, capture the output, and render it directly in the chat UI, providing a seamless "Data to Dashboard" experience without leaving the chat window.

## 6. Implementation Phases

*   **Phase 1: React Template Builder:** Create the Vite project, configure single-file bundling, and build the dynamic Dashboard component that reacts to `window.__DBCLI_PAYLOAD__`.
*   **Phase 2: Metadata Parser & Payload Injector:** Update the query frontmatter parser to read the `visual` schema. Create the injection logic in `dbcli`.
*   **Phase 3: CLI Integration:** Add the `--ui` and `--format html` flags to the query commands and handle OS-specific browser launching.
