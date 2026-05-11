# dbcli React UI Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable `dbcli` to output database query results as fully interactive, standalone HTML dashboards using a pre-compiled React template.

**Architecture:** A lightweight React application is built using Vite and bundled into a single minified HTML string. At runtime, `dbcli` parses visual metadata from the query file, injects the query result and metadata into the HTML string, and opens it in the browser.

**Tech Stack:** Bun, TypeScript, React 18, Recharts, Tailwind CSS, Vite.

---

## File Structure

- Create: `src/ui-template/` (React application root)
- Create: `src/ui-template/index.html` (Vite entry point)
- Create: `src/ui-template/src/main.tsx` (React entry point)
- Create: `src/ui-template/src/App.tsx` (Dashboard component)
- Create: `src/ui-template/vite.config.ts` (Vite config with single-file plugin)
- Create: `src/ui-template/package.json` (Template dependencies)
- Create: `src/core/visual-parser.ts` (Parses YAML visual metadata)
- Create: `src/formatters/html-formatter.ts` (Injects data into the compiled template)
- Modify: `src/commands/query.ts` (Add `--ui` and `--format html` flags)
- Modify: `scripts/build.ts` (Add step to pre-compile the UI template during dbcli build)

---

### Task 1: Setup React UI Template Workspace

**Files:**
- Create: `src/ui-template/package.json`
- Create: `src/ui-template/vite.config.ts`
- Create: `src/ui-template/index.html`
- Create: `src/ui-template/src/main.tsx`
- Create: `src/ui-template/src/globals.d.ts`

- [ ] **Step 1: Initialize template `package.json`**

```json
{
  "name": "dbcli-ui-template",
  "private": true,
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "build": "vite build"
  },
  "dependencies": {
    "lucide-react": "^0.378.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "recharts": "^2.12.7"
  },
  "devDependencies": {
    "@types/react": "^18.3.3",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.0",
    "autoprefixer": "^10.4.19",
    "postcss": "^8.4.38",
    "tailwindcss": "^3.4.3",
    "typescript": "^5.4.5",
    "vite": "^5.2.11",
    "vite-plugin-singlefile": "^2.0.2"
  }
}
```

- [ ] **Step 2: Configure Vite for Single-File Output**

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  plugins: [react(), viteSingleFile()],
  build: {
    outDir: '../../dist/ui', // Output directly to main project dist
    emptyOutDir: true,
  },
});
```

- [ ] **Step 3: Create `index.html` with payload placeholder**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>dbcli Dashboard</title>
    <script>
      // Runtime injection point
      window.__DBCLI_PAYLOAD__ = {{{PAYLOAD}}};
    </script>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 4: Create type definitions and React entry point**

Create `src/ui-template/src/globals.d.ts`:
```typescript
interface DbcliPayload {
  data: any[];
  config: any;
}
interface Window {
  __DBCLI_PAYLOAD__: DbcliPayload;
}
```

Create `src/ui-template/src/main.tsx`:
```tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
```

- [ ] **Step 5: Commit setup**

```bash
git add src/ui-template
git commit -m "feat(ui): initialize react template workspace for html export"
```

### Task 2: Build the Core Dashboard Component

**Files:**
- Create: `src/ui-template/src/App.tsx`
- Create: `src/ui-template/src/index.css`
- Create: `src/ui-template/tailwind.config.js`
- Create: `src/ui-template/postcss.config.js`

- [ ] **Step 1: Setup Tailwind CSS**

Create `postcss.config.js`:
```javascript
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}
```

Create `tailwind.config.js`:
```javascript
/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}
```

Create `src/index.css`:
```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

- [ ] **Step 2: Implement dynamic `App.tsx`**

```tsx
import React from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import './index.css';

const App = () => {
  // Use injected payload, fallback to empty defaults for dev
  const payload = window.__DBCLI_PAYLOAD__ || { data: [], config: {} };
  const { data, config } = payload;
  const title = config?.title || 'Database Query Results';
  const charts = config?.charts || [];

  return (
    <div className="min-h-screen bg-slate-50 p-8 font-sans text-slate-900">
      <div className="max-w-7xl mx-auto space-y-8">
        <header className="flex justify-between items-end border-b border-slate-200 pb-4">
          <h1 className="text-3xl font-bold">{title}</h1>
          <span className="text-slate-500 text-sm">{data.length} rows retrieved</span>
        </header>

        {charts.length > 0 && (
          <div className="grid grid-cols-1 gap-8">
            {charts.map((chart: any, i: number) => (
              <div key={i} className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
                <h3 className="text-lg font-bold mb-6">{chart.title}</h3>
                <div className="h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={data}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                      <XAxis dataKey={chart.x} tick={{fontSize: 12, fill: '#64748b'}} />
                      <YAxis tick={{fontSize: 12, fill: '#64748b'}} />
                      <Tooltip />
                      {chart.y.map((yKey: string, yIdx: number) => (
                        <Line key={yKey} type="monotone" dataKey={yKey} stroke={yIdx === 0 ? "#3b82f6" : "#10b981"} strokeWidth={2} />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  {data.length > 0 && Object.keys(data[0]).map((key) => (
                    <th key={key} className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">{key}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.map((row: any, i: number) => (
                  <tr key={i} className="hover:bg-slate-50">
                    {Object.values(row).map((val: any, j: number) => (
                      <td key={j} className="px-6 py-4 text-sm text-slate-700">{String(val)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};

export default App;
```

- [ ] **Step 3: Commit dashboard component**

```bash
git add src/ui-template/src src/ui-template/tailwind.config.js src/ui-template/postcss.config.js
git commit -m "feat(ui): build dynamic react dashboard component"
```

### Task 3: Build Process Integration

**Files:**
- Modify: `scripts/build.ts`

- [ ] **Step 1: Add template compilation to `scripts/build.ts`**

Update `scripts/build.ts` to build the UI template before or alongside the main CLI build.

```typescript
import { $ } from "bun";

async function build() {
  console.log("Building UI template...");
  
  // Install dependencies if needed
  await $`cd src/ui-template && bun install`.quiet();
  
  // Build single-file HTML
  await $`cd src/ui-template && bun run build`;
  
  console.log("Building CLI...");
  await Bun.build({
    entrypoints: ["./src/cli.ts"],
    outdir: "./dist",
    target: "bun",
    format: "esm",
  });
  
  // Copy the built HTML template to a predictable location for the CLI to load
  await $`mkdir -p ./dist/assets`;
  await $`cp ./dist/ui/index.html ./dist/assets/ui-template.html`;
  
  console.log("Build complete.");
}

build().catch((err) => {
  console.error("Build failed:", err);
  process.exit(1);
});
```

- [ ] **Step 2: Commit build script changes**

```bash
git add scripts/build.ts
git commit -m "build: integrate ui template compilation into main build script"
```

### Task 4: YAML Visual Parser

**Files:**
- Create: `src/core/visual-parser.ts`
- Test: `tests/core/visual-parser.test.ts`

- [ ] **Step 1: Write test for visual parser**

```typescript
import { test, expect } from "bun:test";
import { parseVisualConfig } from "../../src/core/visual-parser";

test("parseVisualConfig extracts visual block", () => {
  const yamlContent = `
name: test_query
visual:
  title: "Test Dashboard"
  charts:
    - type: "line"
      x: "date"
      y: ["amount"]
  `;
  
  const result = parseVisualConfig(yamlContent);
  expect(result).toBeDefined();
  expect(result?.title).toBe("Test Dashboard");
  expect(result?.charts[0].type).toBe("line");
});

test("parseVisualConfig returns null if no visual block", () => {
  const yamlContent = `
name: test_query
description: "Just a query"
  `;
  
  const result = parseVisualConfig(yamlContent);
  expect(result).toBeNull();
});
```

- [ ] **Step 2: Implement visual parser**

```typescript
import { parse as yamlParse } from 'yaml';

export interface VisualConfig {
  title?: string;
  charts?: Array<{
    type: string;
    title?: string;
    x: string;
    y: string[];
    labels?: string[];
  }>;
  kpis?: Array<{
    label: string;
    value_column: string;
    format?: string;
  }>;
}

export function parseVisualConfig(yamlString: string): VisualConfig | null {
  try {
    const parsed = yamlParse(yamlString);
    if (parsed && typeof parsed === 'object' && 'visual' in parsed) {
      return parsed.visual as VisualConfig;
    }
    return null;
  } catch (error) {
    return null;
  }
}
```

- [ ] **Step 3: Run tests and commit**

```bash
bun test tests/core/visual-parser.test.ts
git add src/core/visual-parser.ts tests/core/visual-parser.test.ts
git commit -m "feat(core): add yaml parser for visual metadata"
```

### Task 5: HTML Formatter & Payload Injector

**Files:**
- Create: `src/formatters/html-formatter.ts`
- Test: `tests/formatters/html-formatter.test.ts`

- [ ] **Step 1: Write test for HTML formatter**

```typescript
import { test, expect } from "bun:test";
import { generateHtmlReport } from "../../src/formatters/html-formatter";
import { tmpdir } from "os";
import { join } from "path";
import { rm } from "fs/promises";

test("generateHtmlReport creates file with injected payload", async () => {
  const mockTemplate = `<html><body><script>window.__DBCLI_PAYLOAD__ = {{{PAYLOAD}}};</script></body></html>`;
  const data = [{ id: 1, val: "test" }];
  const config = { title: "Test" };
  
  const outputPath = join(tmpdir(), "dbcli-test-report.html");
  
  await generateHtmlReport(data, config, mockTemplate, outputPath);
  
  const fileContent = await Bun.file(outputPath).text();
  expect(fileContent).toContain('window.__DBCLI_PAYLOAD__ = {"data":[{"id":1,"val":"test"}],"config":{"title":"Test"}}');
  
  await rm(outputPath);
});
```

- [ ] **Step 2: Implement HTML formatter**

```typescript
import { write } from "bun";

export async function generateHtmlReport(
  data: any[], 
  config: any, 
  templateHtml: string, 
  outputPath: string
): Promise<string> {
  const payload = { data, config };
  const payloadString = JSON.stringify(payload).replace(/</g, '\\u003c'); // Prevent XSS escaping closing script tags
  
  const finalHtml = templateHtml.replace('{{{PAYLOAD}}}', payloadString);
  
  await write(outputPath, finalHtml);
  return outputPath;
}
```

- [ ] **Step 3: Run tests and commit**

```bash
bun test tests/formatters/html-formatter.test.ts
git add src/formatters/html-formatter.ts tests/formatters/html-formatter.test.ts
git commit -m "feat(formatter): add html formatter for injecting payload into template"
```

### Task 6: CLI Integration

**Files:**
- Modify: `src/commands/query.ts`
- Test: `tests/integration/html-output.test.ts`

- [ ] **Step 1: Update CLI options and handling in `query.ts`**

Update `src/commands/query.ts` (pseudocode for necessary changes):
1. Import `generateHtmlReport` and `parseVisualConfig`.
2. Add `.option('--ui', 'Open results in interactive HTML dashboard')`.
3. Add `.option('--format <type>', 'Output format', 'table')` (ensure `html` is a valid option).
4. After fetching query results and the query YAML frontmatter (if it's a saved query):
   ```typescript
   import { join } from 'path';
   import { tmpdir } from 'os';
   import { $ } from 'bun';
   // ... inside execution logic ...
   
   if (options.ui || options.format === 'html') {
      // 1. Get Visual Config (if snippet)
      const visualConfig = snippetYaml ? parseVisualConfig(snippetYaml) : null;
      
      // 2. Load template (assuming it's built to dist/assets/ui-template.html)
      // Fallback for development mode
      let templateHtml = `<html><body><h1>Template Missing</h1><script>window.__DBCLI_PAYLOAD__={{{PAYLOAD}}};</script></body></html>`;
      try {
        const templatePath = new URL('../../assets/ui-template.html', import.meta.url);
        templateHtml = await Bun.file(templatePath).text();
      } catch (e) {
         console.warn("UI Template not found. Have you run 'bun run build'?");
      }

      // 3. Generate Report
      const timestamp = new Date().getTime();
      const outputPath = join(tmpdir(), `dbcli-report-${timestamp}.html`);
      await generateHtmlReport(results, visualConfig || {}, templateHtml, outputPath);
      
      if (options.format === 'html' && !options.ui) {
         // Just output the path or stream to stdout if needed, but for simplicity let's assume we want to save it
         console.log(`Report generated: ${outputPath}`);
      } else {
         // Open browser
         console.log(`Opening interactive dashboard...`);
         if (process.platform === 'darwin') {
           await $`open ${outputPath}`;
         } else if (process.platform === 'win32') {
           await $`start ${outputPath}`;
         } else {
           await $`xdg-open ${outputPath}`;
         }
      }
      return;
   }
   ```

- [ ] **Step 2: Commit CLI integration**

```bash
git add src/commands/query.ts
git commit -m "feat(cli): integrate --ui flag and html formatting"
```
