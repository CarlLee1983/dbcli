# Dbcli Interactive UI Integration Design Specification (Refined)

**Date:** 2026-05-11
**Status:** Approved for Implementation Planning
**Author:** AI Agent (with User input)
**Context:** The current terminal-based table output is insufficient for complex data, trend analysis, and sharing. We need a way to present query results in an interactive, human-readable format (React-based dashboard) while keeping the CLI lightweight and dependency-minimal.

## 1. Goal & Core Philosophy

**Goal:** Enable `dbcli` to output database query results as fully interactive, standalone HTML dashboards using Bun-native bundling.

**Philosophy:**
- **Asset-Driven:** UI configuration lives alongside the SQL logic in the Saved Query (@snippet) YAML frontmatter.
- **Bun-Native:** Use `Bun.build` for bundling the UI template, removing Vite dependency.
- **Zero-Dependency Runtime:** The generated HTML must be completely self-contained (Single-File Artifact).
- **Security First:** HTML payloads must respect blacklist redaction rules.

## 2. Visual Metadata Schema (YAML Frontmatter)

Saved queries (`.sql` or `.yaml` in `.dbcli/queries/`) will support a new `visual` block. This will be integrated into the core `SavedQueryMeta` type.

```yaml
# ---
# name: daily_sales
# visual:
#   title: "Daily Sales Performance"
#   kpis:
#     - label: "Total Revenue"
#       value_column: "total_amount"
#       format: "currency"
#   charts:
#     - type: "area"
#       title: "Revenue Trend"
#       x: "date"
#       y: ["total_amount"]
# ---
SELECT ...
```

## 3. Architecture: Bun-Native UI Bundling

### 3.1 Build Phase (dbcli Development)
1. **UI App**: Located in `src/ui-template`. A standard React + Tailwind application.
2. **JS Bundling**: `scripts/build.ts` runs `Bun.build` on `src/ui-template/src/main.tsx` to generate a single JS bundle.
3. **CSS Bundling**: `scripts/build.ts` runs `tailwindcss` CLI to generate a minified CSS bundle.
4. **Inlining**: A post-build step inlines the generated JS and CSS into a base HTML template (`src/ui-template/index.html`), producing `assets/ui-template.html`.
5. **Lookup Strategy**:
   - Use `packageAssetPath('ui-template.html')` from `src/utils/package-root.ts`.
   - This handles both dev-mode (repo root) and package-mode (npm install) correctly.

### 3.2 Execution Phase (Runtime)
1. `dbcli` executes the query and gets the JSON result.
2. `dbcli` applies blacklist redaction to the rows.
3. `dbcli` extracts `visual` metadata using the updated `src/core/saved-queries/parser.ts`.
4. `src/formatters/html-formatter.ts` injects the redacted data and visual config into the template:
   `window.__DBCLI_PAYLOAD__ = {{{PAYLOAD}}};`
5. **Behavior**:
   - **`--ui`**: Injects data, writes to a temporary HTML file, and opens it in the default browser.
     - Supports `DBCLI_NO_OPEN=1` to skip actual browser launch (essential for tests).
   - **`--format html`**: Injects data and outputs the final HTML string to `stdout`.
   - **`export ... --format html`**: Writes the interactive dashboard to a file.

## 4. CLI Interface Changes

- `src/cli.ts`: Register global `--ui` option and add `html` to the allowed formats for `query`, `q`, and `export`.
- `src/commands/q.ts`: Primary path for saved queries. Pass `visual` metadata to the formatter.
- `src/commands/query.ts`: Support default dashboard for raw SQL (empty visual metadata).
- `src/commands/export.ts`: Full support for `--format html`.

## 5. Security & Redaction

The HTML payload **MUST NOT** contain any columns redacted by the `BlacklistValidator`. The `QueryResult` passed to the HTML formatter must already be filtered. Tests must explicitly verify that sensitive fields are not found in the raw HTML output by grep-ing the generated payload string.
