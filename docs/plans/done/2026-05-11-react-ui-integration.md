# dbcli React UI Integration Implementation Plan (Refined)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable `dbcli` to output database query results as fully interactive, standalone HTML dashboards using Bun-native bundling and an extended saved-query parser.

**Architecture:** A React + Recharts + Tailwind application in `src/ui-template` is bundled by `Bun.build` and `tailwindcss` CLI. JS and CSS are inlined into a single HTML file. `dbcli` injects data and visual metadata into this template at runtime using standard package asset resolution.

**Tech Stack:** Bun, TypeScript, React 18, Recharts, Tailwind CSS.

---

## File Structure

- Create: `src/ui-template/` (React source)
- Create: `src/ui-template/src/index.css`
- Create: `src/ui-template/tailwind.config.js`
- Create: `src/ui-template/postcss.config.js`
- Create: `src/formatters/html-formatter.ts` (Injector logic)
- Create: `src/utils/opener.ts` (Browser opening helper with `DBCLI_NO_OPEN` support)
- Create: `tests/core/saved-queries/visual-parser.test.ts`
- Create: `tests/formatters/html-formatter.test.ts`
- Create: `tests/integration/ui-output.test.ts`
- Modify: `package.json` (Root dependencies)
- Modify: `tsconfig.json` (Include .tsx files)
- Modify: `src/core/saved-queries/types.ts` (Add `visual` to `SavedQueryMeta`)
- Modify: `src/core/saved-queries/parser.ts` (Implement `normaliseVisual`)
- Modify: `src/commands/q.ts` (Add `--ui`, `html` format support)
- Modify: `src/commands/query.ts` (Add `--ui`, `html` format support)
- Modify: `src/commands/export.ts` (Full `html` format support)
- Modify: `src/cli.ts` (Register global options)
- Modify: `scripts/build.ts` (Add Bun-native UI build step + inlining)

---

### Task 0: Root Dependency Setup

- [ ] **Step 1: Install frontend dependencies in root**

```bash
bun add react react-dom recharts lucide-react
bun add -D tailwindcss@3.4.1 autoprefixer postcss @types/react @types/react-dom
```

- [ ] **Step 2: Commit dependencies (Lore protocol)**

```bash
git add package.json bun.lock
git commit -m "Add interactive UI dependencies to root workspace

Bundling React, Recharts, and Tailwind at the root ensures the CLI build 
pipeline has reliable access to all frontend tools and typings.

Constraint: Root workspace manages all dependencies to keep the project unified
Confidence: high
Tested: installation only
"
```

### Task 1: Core Parser Extension

**Files:**
- Modify: `src/core/saved-queries/types.ts`
- Modify: `src/core/saved-queries/parser.ts`
- Test: `tests/core/saved-queries/visual-parser.test.ts`

- [ ] **Step 1: Update types**

Add `VisualConfig` and update `SavedQueryMeta`.

- [ ] **Step 2: Implement parser logic**

Update `parseFrontmatter` to extract `visual` block using `normaliseVisual`. Use existing `yaml-mini` capabilities.

- [ ] **Step 3: Write tests for visual parser**

Verify extraction and normalization from YAML.

- [ ] **Step 4: Commit (Lore protocol)**

```bash
git add src/core/saved-queries tests/core/saved-queries
git commit -m "Enable saved-query visual metadata for dashboard rendering

The parser now recognizes a 'visual' block in saved-query frontmatter,
allowing users to store visualization intent (KPIs, charts) alongside SQL.

Confidence: high
Scope-risk: narrow
Tested: unit tests for YAML extraction and normalization
"
```

### Task 2: Bun-Native UI Template & Build Integration

**Files:**
- Create: `src/ui-template/src/App.tsx`
- Create: `src/ui-template/src/main.tsx`
- Create: `src/ui-template/src/index.css`
- Create: `src/ui-template/tailwind.config.js`
- Create: `src/ui-template/postcss.config.js`
- Create: `src/ui-template/index.html` (base template)
- Modify: `scripts/build.ts`
- Modify: `tsconfig.json`

- [ ] **Step 1: Include .tsx in tsconfig.json**

```json
"include": ["src/**/*.ts", "src/**/*.tsx", "scripts/**/*.ts", "tests/**/*.ts"]
```

- [ ] **Step 2: Create React source and tailwind config**

Implement the Dashboard component. Ensure `tailwind.config.js` covers `src/ui-template/src/**/*.{ts,tsx}`.

- [ ] **Step 3: Implement Bundling & Inlining logic in `scripts/build.ts`**

```typescript
// 1. Bun.build for JS
const js = await Bun.build({ entrypoints: ["./src/ui-template/src/main.tsx"], minify: true });
// 2. tailwindcss CLI for CSS (explicitly target the local config)
await $`bunx tailwindcss -c ./src/ui-template/tailwind.config.js -i ./src/ui-template/src/index.css -o ./dist/ui/style.css --minify`;
// 3. Inline into index.html -> assets/ui-template.html
```

- [ ] **Step 4: Commit UI source and build logic (Lore protocol)**

```bash
git add src/ui-template scripts/build.ts tsconfig.json
git commit -m "Establish standalone React UI template with Bun-native build

Migrated from Vite to Bun.build + tailwindcss CLI to simplify the dev 
environment and produce a zero-dependency, single-file HTML dashboard.

Rejected: Vite | adds unnecessary dependency overhead for single-file output
Confidence: high
Tested: manual verification of generated assets/ui-template.html
"
```

### Task 3: HTML Formatter, Asset Lookup & Opener

**Files:**
- Create: `src/formatters/html-formatter.ts`
- Create: `src/utils/opener.ts`
- Test: `tests/formatters/html-formatter.test.ts`

- [ ] **Step 1: Implement Asset Lookup**

Use `packageAssetPath('ui-template.html')` from `src/utils/package-root.ts`.

- [ ] **Step 2: Implement Opener Helper**

Create `src/utils/opener.ts` to handle `open` with `DBCLI_NO_OPEN` guard.

- [ ] **Step 3: Implement Payload Injector**

Implement `generateHtmlReport` with `window.__DBCLI_PAYLOAD__` injection. Ensure JSON escaping.

- [ ] **Step 4: Write security-focused tests**

Verify that `BlacklistValidator` redaction is reflected in the HTML payload.

- [ ] **Step 5: Commit (Lore protocol)**

```bash
git add src/formatters src/utils/opener.ts tests/formatters
git commit -m "Implement secure HTML reporting with asset-aware data injection

The formatter safely injects redacted query results into the UI template, 
honoring security blacklists while maintaining path robustness across dev/npm.

Directive: Always use BlacklistValidator before passing data to generateHtmlReport
Confidence: high
Tested: security tests for payload redaction, asset lookup path resolution
"
```

### Task 4: CLI Integration & Behavioral Wiring

**Files:**
- Modify: `src/commands/q.ts`
- Modify: `src/commands/query.ts`
- Modify: `src/commands/export.ts`
- Modify: `src/cli.ts`
- Test: `tests/integration/ui-output.test.ts`

- [ ] **Step 1: Update global CLI flags in `cli.ts`**

Register `--ui` and add `html` format.

- [ ] **Step 2: Implement command logic**

- `--ui`: Save to temp file and use opener helper.
- `--format html`: Output directly to `stdout`.
- `export ... --format html`: Support both stdout and file output via `--output`.

- [ ] **Step 3: Write comprehensive integration tests**

Verify:
- `dbcli q @snippet --ui` (with `DBCLI_NO_OPEN=1`).
- `dbcli query "SELECT..." --format html`.
- `dbcli export "SELECT..." --format html --output test.html`.
- Blacklisted columns are NOT in the HTML.

- [ ] **Step 4: Commit (Lore protocol)**

```bash
git add src/commands src/cli.ts tests/integration
git commit -m "Integrate interactive dashboards across all query interfaces

Enabled one-click UI reporting for saved queries, raw SQL, and data exports, 
providing a modern human-readable interface for database operations.

Confidence: high
Tested: integration tests for --ui, --format html, and export redirection
"
```
