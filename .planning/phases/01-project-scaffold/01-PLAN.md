---
phase: 01-project-scaffold
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - package.json
  - tsconfig.json
  - bunfig.toml
  - src/cli.ts
  - src/types/index.ts
  - .eslintrc.cjs
  - .prettierrc
  - .gitignore
  - README.md
  - vitest.config.ts
  - tests/integration/cli.test.ts
  - .github/workflows/ci.yml
autonomous: true
requirements: []
must_haves:
  truths:
    - "CLI runs and displays help message via `bun run dev -- --help`"
    - "Smoke test passes with `bun test`"
    - "Project builds to executable via `bun run build`"
    - "Bundled executable includes proper shebang and npm bin configuration"
  artifacts:
    - path: "package.json"
      provides: "Project metadata, dependencies, build/test scripts, npm bin field"
      fields: ["name", "version", "scripts", "bin", "dependencies", "devDependencies"]
    - path: "src/cli.ts"
      provides: "Commander.js entry point with --help and --version"
      exports: ["main CLI program instance"]
    - path: "vitest.config.ts"
      provides: "Test runner configuration for Bun"
      exports: ["test environment, coverage thresholds"]
    - path: "tests/integration/cli.test.ts"
      provides: "Smoke tests for CLI invocation"
      min_lines: 40
  key_links:
    - from: "package.json"
      to: "src/cli.ts"
      via: "bin.dbcli points to bundled output"
    - from: "package.json"
      to: ".github/workflows/ci.yml"
      via: "scripts (dev, test, build) are invoked by CI"
    - from: "src/cli.ts"
      to: "tests/integration/cli.test.ts"
      via: "integration tests spawn CLI via `bun run dev`"
---

<objective>
Establish production-ready Bun + TypeScript CLI project scaffold with working build, test, and CI/CD infrastructure. This phase does not implement any dbcli features—only the foundation that later phases depend on.

Purpose: Developers can run three success commands immediately after Phase 1 completes, confirming infrastructure works before implementing database features in Phase 2.

Output: Runnable project with Commander.js CLI entry point, Vitest test framework, Bun bundler, cross-platform GitHub Actions CI, and code quality tools (ESLint, Prettier).
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/01-project-scaffold/01-RESEARCH.md
</execution_context>

<context>
Research findings confirm:
- **CLI Framework:** Commander.js v13.0+ (proven, TypeScript-first, standard since 2015)
- **Build Tool:** Bun's native bundler (5ms startup vs Node's 50ms)
- **Testing:** Vitest 1.2+ with Bun integration (10-20x faster than Jest)
- **Code Quality:** ESLint + Prettier + Husky for developer experience
- **CI/CD:** GitHub Actions matrix testing (macOS, Linux, Windows)
- **Version Strategy:** Lock to Bun 1.3.x, TypeScript 5.3+, Commander 13.0+

Reference implementations exist in research; key patterns documented in RESEARCH.md under "Architecture Patterns" and "Code Examples."
</context>

<tasks>

<task type="auto">
  <name>Task 1: Initialize Bun project and install core dependencies</name>
  <files>package.json, bunfig.toml, tsconfig.json, .gitignore, README.md</files>
  <action>
    Initialize Bun project with TypeScript support (per RESEARCH.md Stack section):

    1. Run `bun init -y` in project root to generate initial package.json and bunfig.toml
    2. Update package.json:
       - Name: "dbcli"
       - Version: "0.1.0"
       - Description: "Database CLI for AI agents"
       - Add `bin` field: `{ "dbcli": "./dist/cli.mjs" }`
       - Add npm `engines` field: `{ "node": ">=18", "bun": ">=1.3.0" }`
       - Add scripts:
         - `dev`: `bun run src/cli.ts`
         - `build`: `bun build ./src/cli.ts --outfile ./dist/cli.mjs --target bun`
         - `test`: `vitest`
         - `test:run`: `vitest --run`
         - `lint`: `eslint src tests --ext .ts`
         - `lint:fix`: `eslint src tests --ext .ts --fix`
         - `format`: `prettier --write "src/**/*.ts" "tests/**/*.ts"`
    3. Install dependencies:
       ```bash
       bun add commander@13.0.0 dotenv zod
       bun add -D typescript bun-types vitest jsdom happy-dom eslint @eslint/js typescript-eslint prettier @inquirer/prompts
       ```
    4. Create tsconfig.json with strict mode (per RESEARCH.md example):
       - strict: true
       - target: ESNext
       - module: Preserve
       - moduleResolution: bundler
       - lib: ["ESNext"]
       - skipLibCheck: true
       - noEmit: true (tests still check types)
    5. Create bunfig.toml (per RESEARCH.md):
       - [install] registry = "https://registry.npmjs.org/"
       - [dev] reload = true
    6. Create .gitignore (standard for Node/Bun):
       - dist/
       - node_modules/
       - bun.lockb
       - .DS_Store
       - .env
       - .dbcli
       - coverage/
       - *.log
    7. Create initial README.md with header, quick start (dbcli init, list, schema, query), requirements note (Phase 2+)
  </action>
  <verify>
    Automated check:
    ```bash
    test -f package.json && grep -q '"name": "dbcli"' package.json && \
    grep -q '"dev": "bun run src/cli.ts"' package.json && \
    grep -q '"bin"' package.json && \
    test -f tsconfig.json && grep -q '"strict": true' tsconfig.json && \
    test -f bunfig.toml && test -f .gitignore && \
    test -f README.md && bun install
    ```
    Expected: All files exist, dependencies installed successfully.
  </verify>
  <done>Project initialized with locked dependency versions. package.json includes all scripts, bin field, engines constraint. tsconfig.json strict mode enabled. .gitignore configured. README.md created with placeholder content.</done>
</task>

<task type="auto">
  <name>Task 2: Create CLI entry point with Commander.js and type definitions</name>
  <files>src/cli.ts, src/types/index.ts</files>
  <action>
    Create the CLI entry point and shared types (per RESEARCH.md Pattern 1):

    1. Create src/types/index.ts with shared interfaces:
       - Export empty stub for now: `export interface DbcliConfig {}`
       - This allows later phases to extend types without circular deps

    2. Create src/cli.ts with Commander.js instantiation:
       ```typescript
       import { Command } from 'commander'
       const pkg = require('../package.json')

       const program = new Command()
         .name('dbcli')
         .description('Database CLI for AI agents')
         .version(pkg.version)
         .option('--config <path>', 'Path to .dbcli config file', '.dbcli')

       // Show help when no command provided
       if (!process.argv.slice(2).length) {
         program.outputHelp()
       }

       program.parse(process.argv)
       ```

    3. Ensure shebang is added by build process (handled in Task 4)

    Goal: `bun run dev -- --help` should display help text without errors. `bun run dev -- --version` should display package version.
  </action>
  <verify>
    Automated check:
    ```bash
    bun run dev -- --help | grep -q "Database CLI for AI agents" && \
    bun run dev -- --version | grep -q "0.1.0"
    ```
    Expected: Help text displayed, version number shown.
  </verify>
  <done>Commander.js CLI entry point created. Global --config option added. Shared types stub exported. Help and version work correctly.</done>
</task>

<task type="auto">
  <name>Task 3: Set up Vitest, ESLint, and Prettier configuration</name>
  <files>vitest.config.ts, .eslintrc.cjs, .prettierrc</files>
  <action>
    Configure testing and code quality tools (per RESEARCH.md examples):

    1. Create vitest.config.ts (per RESEARCH.md Vitest Configuration):
       ```typescript
       import { defineConfig } from 'vitest/config'

       export default defineConfig({
         test: {
           globals: true,
           environment: 'node',  // CLI code doesn't need jsdom
           coverage: {
             provider: 'v8',
             reporter: ['text', 'json', 'html'],
             all: true,
             lines: 80,
             functions: 80,
             branches: 80,
             statements: 80
           }
         }
       })
       ```

    2. Create .eslintrc.cjs (ESLint + TypeScript):
       ```javascript
       module.exports = {
         root: true,
         extends: [
           'eslint:recommended',
           'plugin:@typescript-eslint/recommended'
         ],
         parser: '@typescript-eslint/parser',
         parserOptions: {
           ecmaVersion: 'latest',
           sourceType: 'module'
         },
         plugins: ['@typescript-eslint'],
         rules: {
           'no-console': 'warn',
           '@typescript-eslint/no-explicit-any': 'error',
           '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }]
         },
         ignorePatterns: ['dist/', 'node_modules/']
       }
       ```

    3. Create .prettierrc (code formatter):
       ```json
       {
         "semi": false,
         "singleQuote": true,
         "trailingComma": "es5",
         "printWidth": 100,
         "tabWidth": 2,
         "arrowParens": "always"
       }
       ```

    Goal: `bun run lint` runs ESLint without errors. `bun run format` applies Prettier. Tests can be discovered and configured.
  </action>
  <verify>
    Automated check:
    ```bash
    test -f vitest.config.ts && \
    test -f .eslintrc.cjs && \
    test -f .prettierrc && \
    bun run lint -- src/cli.ts 2>&1 | grep -v "No files matching the pattern"
    ```
    Expected: All config files exist, ESLint runs without hard errors (may warn about lack of @typescript-eslint plugin if not installed—this is acceptable for Phase 1).
  </verify>
  <done>Vitest configuration created with 80% coverage threshold and node environment. ESLint configured for TypeScript. Prettier configured with project standards (no semicolons, single quotes, trailing commas).</done>
</task>

<task type="auto">
  <name>Task 4: Create smoke test and verify test infrastructure</name>
  <files>tests/integration/cli.test.ts</files>
  <action>
    Create integration smoke test (per RESEARCH.md Smoke Test Example):

    1. Create tests/integration/cli.test.ts:
       ```typescript
       import { describe, it, expect } from 'vitest'
       import { spawn } from 'child_process'

       describe('CLI smoke tests', () => {
         it('should display help with --help', async () => {
           const result = await execCommand(['--help'])
           expect(result.stdout).toContain('Database CLI for AI agents')
           expect(result.code).toBe(0)
         })

         it('should display version with --version', async () => {
           const result = await execCommand(['--version'])
           expect(result.stdout).toMatch(/\d+\.\d+\.\d+/)
           expect(result.code).toBe(0)
         })
       })

       function execCommand(args: string[]): Promise<{ stdout: string; code: number }> {
         return new Promise((resolve) => {
           const proc = spawn('bun', ['run', 'dev', ...args])
           let stdout = ''
           proc.stdout.on('data', (data) => {
             stdout += data
           })
           proc.on('close', (code) => {
             resolve({ stdout, code: code || 0 })
           })
         })
       }
       ```

    2. Run `bun test --run` to verify test discovery and execution
    3. Tests should PASS (success criteria)
  </action>
  <verify>
    Automated check:
    ```bash
    bun test --run 2>&1 | grep -q "✓" && \
    bun test --run 2>&1 | grep -q "2 passed"
    ```
    Expected: Both smoke tests pass (help and version).
  </verify>
  <done>Smoke test file created with two passing tests. Test infrastructure verified. `bun test --run` executes successfully.</done>
</task>

<task type="auto">
  <name>Task 5: Configure build process and verify bundled output</name>
  <files>dist/cli.mjs (generated)</files>
  <action>
    Set up and test the Bun build process (per RESEARCH.md and package.json scripts):

    1. Run build command: `bun run build`
       - Expected output: dist/cli.mjs file created
       - Bun automatically adds #!/usr/bin/env bun shebang to bundled CLI

    2. Verify bundled CLI works:
       ```bash
       chmod +x dist/cli.mjs
       ./dist/cli.mjs --help | grep -q "Database CLI for AI agents"
       ./dist/cli.mjs --version | grep -q "0.1.0"
       ```

    3. Verify executable can be invoked without `bun` prefix (direct binary execution)

    Goal: `bun run build` produces executable that works independently.
  </action>
  <verify>
    Automated check:
    ```bash
    bun run build && \
    test -f dist/cli.mjs && \
    ./dist/cli.mjs --help | grep -q "Database CLI for AI agents" && \
    ./dist/cli.mjs --version | grep -q "0.1.0"
    ```
    Expected: Build succeeds, executable created, can run --help and --version directly without `bun run`.
  </verify>
  <done>Build process configured. Executable bundled to dist/cli.mjs with correct shebang. Direct invocation works without `bun run` prefix.</done>
</task>

<task type="auto">
  <name>Task 6: Configure GitHub Actions matrix CI/CD</name>
  <files>.github/workflows/ci.yml</files>
  <action>
    Set up cross-platform CI/CD (per RESEARCH.md GitHub Actions Matrix CI):

    1. Create .github/workflows/ci.yml:
       ```yaml
       name: CI

       on: [push, pull_request]

       jobs:
         test:
           runs-on: ${{ matrix.os }}
           strategy:
             matrix:
               os: [ubuntu-latest, macos-latest, windows-latest]
               bun-version: ['1.3.3', 'latest']
           steps:
             - uses: actions/checkout@v4
             - uses: oven-sh/setup-bun@v2
               with:
                 bun-version: ${{ matrix.bun-version }}
             - run: bun install
             - run: bun test --run
             - run: bun run lint
             - run: bun run build
             - run: bun run dev -- --help
             - run: bun run dev -- --version
             - name: Verify bundled CLI
               run: |
                 chmod +x dist/cli.mjs || true
                 ./dist/cli.mjs --help
                 ./dist/cli.mjs --version
       ```

    2. This CI/CD runs on all commits and PRs, testing against:
       - macOS (latest), Linux (ubuntu-latest), Windows (latest)
       - Bun 1.3.3 (locked) and latest (for forward compatibility)

    3. Tests run in parallel across OS matrix (3 OS × 2 versions = 6 parallel jobs)

    Goal: Push to git should trigger CI tests on all platforms automatically.
  </action>
  <verify>
    Automated check:
    ```bash
    test -f .github/workflows/ci.yml && \
    grep -q "matrix:" .github/workflows/ci.yml && \
    grep -q "macos-latest" .github/workflows/ci.yml && \
    grep -q "windows-latest" .github/workflows/ci.yml
    ```
    Expected: CI workflow file exists, includes OS matrix, includes windows and macOS testing.
  </verify>
  <done>GitHub Actions CI/CD configured. Matrix testing across macOS, Linux, Windows. Tests, lint, build, and smoke tests run on all platforms. File committed to repo.</done>
</task>

</tasks>

<verification>
After all tasks complete, verify Phase 1 success criteria:

1. **CLI Execution:** `bun run dev -- --help` displays help message
   ```bash
   bun run dev -- --help | grep -q "Database CLI for AI agents"
   ```

2. **Testing:** `bun test --run` passes with 2 smoke tests
   ```bash
   bun test --run 2>&1 | grep -q "2 passed"
   ```

3. **Building:** `bun run build` produces working executable
   ```bash
   bun run build && ./dist/cli.mjs --version | grep -q "0.1.0"
   ```

4. **Code Quality:** Linting passes
   ```bash
   bun run lint
   ```

5. **CI/CD:** GitHub Actions matrix defined and syntactically valid
   ```bash
   test -f .github/workflows/ci.yml
   ```

All five success criteria must pass before Phase 1 is considered complete. Push to git will trigger GitHub Actions validation across all platforms.
</verification>

<success_criteria>
Phase 1 complete when:

- ✓ `bun run dev -- --help` displays CLI help message containing "Database CLI for AI agents"
- ✓ `bun run dev -- --version` displays version number (0.1.0)
- ✓ `bun test --run` passes with exactly 2 smoke tests (--help, --version)
- ✓ `bun run build` succeeds and produces dist/cli.mjs executable
- ✓ `./dist/cli.mjs --help` and `./dist/cli.mjs --version` work without `bun run` prefix
- ✓ `bun run lint` completes without errors
- ✓ `.github/workflows/ci.yml` exists and includes matrix testing for macOS, Linux, Windows
- ✓ All files in files_modified list exist and are committed to git
- ✓ No console.log statements in src/ code (except error output)
- ✓ TypeScript strict mode enabled and no type errors reported

**Timeline:** ~30-45 minutes total execution time across 6 tasks
**Complexity:** Low — straightforward setup, no business logic
**Risk:** Low — all patterns from research are proven and standard
</success_criteria>

<output>
After completion, create `.planning/phases/01-project-scaffold/01-SUMMARY.md` with:
- ✓ Phase completion status
- ✓ All 6 tasks completed
- ✓ Success criteria validation results
- ✓ File structure created
- ✓ CI/CD pipeline configured
- ✓ Test infrastructure ready for Phase 2+
- ✓ Key metrics (startup time if measurable, build output size, test execution time)
- ✓ Next phase readiness: Phase 2 (Init & Config) can begin immediately
</output>
