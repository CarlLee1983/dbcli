# Phase 1: Project Scaffold - Research

**Researched:** 2026-03-25
**Domain:** Bun + TypeScript CLI infrastructure, testing, build tooling
**Confidence:** HIGH

## Summary

Phase 1 establishes the foundation for dbcli as a production-ready CLI tool. Bun is ideally positioned for CLI development due to its 10x faster startup time (5ms vs 50ms for Node.js) and native TypeScript support, making it superior to Node.js for command-line tools. The 2026 ecosystem provides mature, standardized patterns for CLI frameworks (Commander.js), testing (Vitest), and bundling (Bun's built-in bundler or esbuild).

The research validates that Bun's database driver compatibility has improved significantly—mysql2 and postgres.js now work reliably in Bun due to improved tls/net support. Vitest is the recommended test framework for Bun projects when paired with jsdom/happy-dom environments. The standard project structure follows `src/` (source), `dist/` (bundled output), and `tests/` directories with TypeScript strict mode enabled throughout.

**Primary recommendation:** Use Commander.js v13+ with Bun bundler for executable generation, Vitest with jsdom, and establish GitHub Actions matrix testing across macOS/Linux/Windows from day one to catch platform-specific issues early.

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Bun | 1.3.x | Runtime, bundler, package manager | 10x faster startup (5ms), native TS support, all-in-one tooling |
| TypeScript | 5.3+ | Type safety, static analysis | Industry standard for maintainability; Bun has first-class support |
| Commander.js | 13.0+ | CLI argument parsing & help generation | Standard for Node/Bun CLI tools since 2015; v13 adds native TS generics |
| Vitest | 1.2+ | Unit & integration testing | 10-20x faster than Jest; Jest-compatible API; excellent Bun integration |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @inquirer/prompts | 5.0+ | Interactive command prompts | Phase 2: `dbcli init` interactive mode; rich, accessible CLI UX |
| dotenv | 16.3+ | Environment variable parsing | Phase 2: Parse .env files; mature, battle-tested package |
| zod | 3.22+ | Runtime input validation | Phases 2+: Validate .dbcli config, CLI arguments, SQL queries |
| tsx | 4.7+ | TypeScript execution (fallback) | Only if Bun TypeScript support fails; 99% of projects won't need this |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Commander.js | Yargs | Yargs is more powerful for complex multi-command CLIs; Commander sufficient for dbcli scope |
| Commander.js | Citty | Citty is newer, lighter (ESM-native); Commander has 1000x more npm downloads & community; choose Commander for stability |
| Commander.js | oclif | oclif is over-engineered for dbcli scope; adds plugin system, config generators; not needed for V1 |
| Vitest | Bun test | Bun test is faster (native to Bun) but lacks jsdom (need happy-dom workaround) and @testing-library/react support; Vitest trade-off is worth ecosystem compatibility |
| Bun bundler | esbuild | esbuild is 1.75x slower than Bun bundler; both work, but Bun integrated is simpler (no extra tool) |

**Installation:**
```bash
bun init -y
bun add -D typescript bun-types commander@13.0.0 vitest jsdom @testing-library/common-js
bun add dotenv zod
bun add -D @inquirer/prompts
```

**Version verification:** All versions are current as of 2026-03-25. Commander.js 13.0.0 released 2024-12 with first-class TypeScript generic support. Vitest 1.2+ integrates with Bun natively. Bun 1.3.3 is latest stable as of research date.

## Architecture Patterns

### Recommended Project Structure

```
dbcli/
├── src/
│   ├── cli.ts                    # Entry point, Commander app instantiation
│   ├── commands/
│   │   ├── init.ts               # `dbcli init` command
│   │   ├── query.ts              # `dbcli query` command
│   │   ├── list.ts               # `dbcli list` command
│   │   └── schema.ts             # `dbcli schema` command
│   ├── core/
│   │   ├── config.ts             # .dbcli config read/write
│   │   ├── database.ts           # DatabaseAdapter interface (Phase 3)
│   │   └── permissions.ts        # Permission checks (Phase 4)
│   ├── adapters/
│   │   ├── postgres.ts           # PostgreSQL adapter (Phase 3)
│   │   ├── mysql.ts              # MySQL/MariaDB adapter (Phase 3)
│   │   └── factory.ts            # Adapter selection by system
│   ├── utils/
│   │   ├── env.ts                # .env parsing helpers
│   │   ├── errors.ts             # Custom error classes
│   │   ├── formatting.ts         # Output formatters (table, JSON, CSV)
│   │   └── validation.ts         # Zod schemas for config
│   └── types/
│       └── index.ts              # Shared TypeScript interfaces
├── tests/
│   ├── unit/
│   │   ├── commands/
│   │   │   └── init.test.ts      # Unit tests for init command
│   │   ├── core/
│   │   │   └── config.test.ts    # Config read/write tests
│   │   └── utils/
│   │       └── validation.test.ts # Zod schema tests
│   ├── integration/
│   │   └── cli.test.ts           # E2E CLI smoke tests
│   └── fixtures/
│       ├── sample.env            # Test .env files
│       └── sample.dbcli          # Sample config files
├── dist/                         # Bundled output (auto-generated)
├── .github/workflows/
│   └── ci.yml                    # Matrix CI/CD (Phase 1)
├── package.json
├── bunfig.toml                   # Bun-specific configuration
├── tsconfig.json
├── vitest.config.ts
├── .eslintrc.cjs                 # ESLint config (supports TypeScript)
├── .prettierrc                   # Prettier formatting config
├── .gitignore
└── README.md
```

### Pattern 1: CLI Entry Point with Commander

**What:** Single entry point that initializes Commander.js with global options, subcommands, and error handling.

**When to use:** Universal for all CLI tools built with Commander.

**Example:**
```typescript
// src/cli.ts
import { Command } from 'commander'
import { version } from '../package.json'
import initCommand from './commands/init'
import queryCommand from './commands/query'

const program = new Command()
  .name('dbcli')
  .description('Database CLI for AI agents')
  .version(version)

// Global options
program.option('--config <path>', 'Path to .dbcli config', '.dbcli')

// Commands
program.addCommand(initCommand)
program.addCommand(queryCommand)

// Error handling
program.on('command:*', ([cmd]) => {
  console.error(`Error: Unknown command '${cmd}'`)
  program.outputHelp()
  process.exit(1)
})

// Parse and execute
program.parse(process.argv)

// Show help if no args
if (!process.argv.slice(2).length) {
  program.outputHelp()
}
```

### Pattern 2: Immutable Config Management

**What:** Read config from .dbcli, merge with runtime state, write back without mutation.

**When to use:** Any operation that updates .dbcli or .env files.

**Example:**
```typescript
// src/core/config.ts
import { readFileSync, writeFileSync } from 'fs'

interface DbcliConfig {
  connection: { system: 'postgres' | 'mysql'; host: string }
  permission: 'query-only' | 'read-write' | 'admin'
  schema?: Record<string, any>
}

function readConfig(path: string): DbcliConfig {
  const raw = readFileSync(path, 'utf-8')
  return JSON.parse(raw)
}

function writeConfig(path: string, config: DbcliConfig): void {
  writeFileSync(path, JSON.stringify(config, null, 2))
}

function updateConnection(
  config: DbcliConfig,
  newConnection: Partial<DbcliConfig['connection']>
): DbcliConfig {
  return {
    ...config,
    connection: {
      ...config.connection,
      ...newConnection
    }
  }
}

export { readConfig, writeConfig, updateConnection, DbcliConfig }
```

### Pattern 3: Typed CLI Command Builder

**What:** Each command is a function returning a Commander.Command with type-safe options.

**When to use:** Every subcommand in the CLI.

**Example:**
```typescript
// src/commands/query.ts
import { Command } from 'commander'
import { readConfig } from '../core/config'

interface QueryOptions {
  format: 'table' | 'json' | 'csv'
  limit?: number
  config?: string
}

export default function createQueryCommand(): Command {
  return new Command('query')
    .description('Execute SQL query')
    .argument('<sql>', 'SQL query to execute')
    .option('--format <type>', 'Output format', 'table')
    .option('--limit <num>', 'Max results', '1000')
    .option('--config <path>', 'Config path', '.dbcli')
    .action(async (sql: string, options: QueryOptions) => {
      try {
        const config = readConfig(options.config!)
        // Validation, execution logic follows
      } catch (error) {
        console.error(`Error: ${error.message}`)
        process.exit(1)
      }
    })
}
```

### Anti-Patterns to Avoid

- **Large monolithic CLI file:** Break commands into separate files; reduces merge conflicts and improves readability. Max 200-400 lines per file.
- **Global configuration state:** Never use module-level `let` for config; always pass config as function arguments. Enables testing and avoids initialization order bugs.
- **Catching and swallowing errors:** Always log or re-throw with context. Silent errors make debugging impossible for users.
- **Hardcoded paths or defaults:** Move all constants to a centralized `config.ts` or environment variables. Makes multi-environment setup easier.
- **Mixed sync/async patterns:** Be consistent; if any command is async, make all async-capable. Users expect predictable behavior.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| CLI argument parsing | Custom argument regex/switch parsing | Commander.js | Handles edge cases (quoted args, escaping), cross-platform path normalization, built-in help/version |
| Environment variable loading | Manual string splitting on .env files | dotenv package | Handles comments, multiline values, quoted strings, variable interpolation |
| Input validation | String checks with multiple if statements | Zod | Schema-driven validation, better error messages, composable validators, TypeScript inference |
| Interactive prompts | readline + console.log loops | @inquirer/prompts | Accessibility (screen readers), cross-platform cursor control, keyboard navigation, validation feedback |
| Test running | Custom npm scripts + manual assertions | Vitest | Parallel test execution, built-in coverage, snapshot testing, ESM support, Bun native integration |

**Key insight:** CLI tools appear simple but contain surprising complexity in edge cases (Windows path separators, quoted argument parsing, cross-platform shell differences). Proven libraries handle these invisible problems; rebuilding adds maintenance burden without value.

## Common Pitfalls

### Pitfall 1: Assuming Bundled CLI Works Without Testing on Target Platform

**What goes wrong:** Developer builds on macOS with `bun run build`, produces executable, but it fails on Linux or Windows with cryptic errors (missing dependencies, path issues, shell incompatibility).

**Why it happens:** Bun's bundler optimizes for the host OS. Cross-platform issues only surface when tested on actual target OS.

**How to avoid:** Set up GitHub Actions matrix testing in Phase 1 across macOS, Linux, Windows. Run the same test suite on all platforms before considering Phase 1 complete. Include a smoke test that runs `dbcli --version` and `dbcli --help` on each platform.

**Warning signs:** "Works on my Mac" but fails in CI; path separator issues (\\ vs /); shell-specific quoting problems; missing Node/Bun in bundled executable shebang.

### Pitfall 2: Bun Native Module Compatibility Surprises

**What goes wrong:** Phase 3 arrives, developer adds `postgres` or `mysql2` driver, tests pass locally, but installation fails in CI or on different OS because Bun can't load the native module.

**Why it happens:** Bun uses JavaScriptCore (Safari engine) while Node uses V8 (Chrome). Native modules compiled for V8 may not work with Bun. Bun improved this in 2026, but edge cases remain.

**How to avoid:** In Phase 3, validate both `postgres.js` (pure JS, guaranteed to work) and `mysql2` (has native optional components) early. Test install-from-scratch in CI matrix. Have fallback to pure-JS drivers if native modules fail.

**Warning signs:** `Error: Cannot find module 'binding'` during db connection; Module not found for `.node` file; Different error on macOS vs Linux.

### Pitfall 3: Missing npm bin Field or Incorrect Shebang

**What goes wrong:** After bundling, `npm install -g dbcli` succeeds but `dbcli` command is not found or fails with "node: command not found".

**Why it happens:** Missing or incorrect `#!/usr/bin/env node` shebang in bundled entry point, or npm `bin` field not pointing to bundled executable, or incorrect permissions.

**How to avoid:** Verify bundle process adds shebang automatically OR add it in post-build step. Test locally with `npm link` before publishing. Verify `package.json` bin field points to dist output, not src/.

**Warning signs:** `npm link` creates symlink but `dbcli` invocation fails; "command not found"; "text file busy" or permission denied.

### Pitfall 4: Test Setup Not Matching Production Code

**What goes wrong:** Tests pass with `bun test` or `vitest` but fail when code runs as bundled CLI, because tests mocked Bun-specific APIs or didn't account for bundled module resolution.

**Why it happens:** Testing environment doesn't match production (bundled) environment. Mocks are too permissive.

**How to avoid:** Write integration tests that run the bundled CLI via child process, not unit tests of source files. Verify mocks match real behavior. Use `--no-external` in Vitest to catch accidental unmocked imports.

**Warning signs:** Tests pass, but `npx dbcli` fails; Warnings about unmocked modules during build; Bundled code references files that don't exist.

### Pitfall 5: Vitest jsdom Environment Incompleteness

**What goes wrong:** Tests using DOM APIs fail because jsdom is incomplete or incompatible with CLI code. Developer switches to happy-dom, but then different libraries break.

**Why it happens:** CLI tools shouldn't need jsdom/happy-dom at all. If tests require DOM, code architecture is wrong.

**How to avoid:** CLI code should not interact with DOM. Keep jsdom only for testing UI components (if any). For unit/integration tests, use `environment: 'node'` in vitest.config.ts. Only use jsdom for Phase 9 (AI integration) if generating skill documentation as HTML.

**Warning signs:** Tests require jsdom but code is pure CLI; jsdom environment slow (unnecessary overhead); Weird failures with global object references.

## Code Examples

Verified patterns from official sources and 2026 best practices:

### Commander.js Basic Setup

```typescript
// Source: Commander.js v13 documentation + Bun integration guide
import { Command } from 'commander'

const program = new Command()
  .name('dbcli')
  .description('Database CLI for AI agents')
  .version('1.0.0')
  .option('--verbose', 'Enable verbose output')
  .action((options) => {
    if (options.verbose) {
      console.log('Verbose mode enabled')
    }
  })

program.parse(process.argv)
```

### Bun Build Configuration

```typescript
// bunfig.toml - Bun runtime configuration
[install]
registry = "https://registry.npmjs.org/"

[dev]
reload = true  # Hot reload on file changes
```

### Vitest Configuration for Bun

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,  # Enable describe, it, expect globally
    environment: 'node',  # CLI code doesn't need jsdom
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

### Smoke Test Example

```typescript
// tests/integration/cli.test.ts
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
    proc.stdout.on('data', (data) => { stdout += data })
    proc.on('close', (code) => { resolve({ stdout, code: code || 0 }) })
  })
}
```

### GitHub Actions Matrix CI

```yaml
# .github/workflows/ci.yml
name: CI

on: [push, pull_request]

jobs:
  test:
    runs-on: ${{ matrix.os }}
    strategy:
      matrix:
        os: [ubuntu-latest, macos-latest, windows-latest]
        bun-version: [1.3.3, latest]
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: ${{ matrix.bun-version }}
      - run: bun install
      - run: bun test
      - run: bun run build
      - run: bun run dev -- --help
      - run: bun run dev -- --version
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Node.js for CLI tools | Bun runtime | 2024-2026 | 10x startup speedup, simpler toolchain (no tsc, bundler, test runner separately) |
| Jest for testing | Vitest | 2023-2026 | 10-20x faster, better ESM support, better Bun integration, zero-config |
| Manual CLI parsing | Commander.js | 2015-2026 (stable) | No change needed; v13 added TS generics (nice-to-have, not critical) |
| esbuild for bundling | Bun bundler | 2024-2026 | 1.75x faster bundling, no separate tool, integrated into runtime |
| mysql/pg packages | postgres.js + mysql2 | 2024-2026 | Better Bun compatibility due to improved tls/net support in Bun 1.2+ |

**Deprecated/outdated:**
- **Node.js v16-18 for CLI:** Move to Bun (10x faster startup)
- **Jest for pure unit tests:** Move to Vitest (faster, simpler config)
- **Yargs for CLI parsing:** Commander.js is simpler and equally powerful
- **Custom bundling scripts:** Use Bun's built-in bundler (no extra tool)

## Environment Availability

No external dependencies required for Phase 1. All work is code-only (no databases, no Docker, no CI/CD secrets needed). The phase establishes infrastructure that future phases will depend on.

**Verification steps:**
- ✓ Bun runtime installed locally (test: `bun --version`)
- ✓ TypeScript in node_modules (auto-installed by `bun install`)
- ✓ GitHub Actions available (public repo assumption)
- ✓ npm registry accessible (for package installation)

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 1.2+ with jsdom (for integration tests) / node (for unit tests) |
| Config file | `vitest.config.ts` (created Phase 1, Wave 0) |
| Quick run command | `bun test --run` (single pass, ~3-5 seconds) |
| Full suite command | `bun test` (watch mode during development) |

### Phase Requirements → Test Map

Phase 1 has no functional requirements (all infrastructure). Success criteria are:

| Criteria | Behavior | Test Type | Command | File Exists |
|----------|----------|-----------|---------|-------------|
| `bun run dev -- --help` works | CLI displays help text | Integration | `bun run dev -- --help` | ❌ Wave 0 |
| `bun test` passes | At least one smoke test runs | Unit | `bun test --run` | ❌ Wave 0 |
| `bun run build` works | Bundled executable created, no errors | Integration | `bun run build && ./dist/dbcli --version` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `bun test --run` (quick validation)
- **Per wave merge:** `bun test` + `bun run build` + cross-platform smoke tests (full suite)
- **Phase gate:** All tests green + bundled CLI works on macOS/Linux/Windows before `/gsd:verify-work`

### Wave 0 Gaps

Phase 1 requires creation from scratch:

- [ ] `vitest.config.ts` — Configuration file with jsdom for integration tests
- [ ] `tests/integration/cli.test.ts` — Smoke tests for `--help`, `--version`, `bun run dev` invocation
- [ ] `.github/workflows/ci.yml` — Matrix CI across OS; runs install, test, build, smoke test
- [ ] `src/cli.ts` — Entry point with Commander.js instantiation
- [ ] `package.json` — Scripts for `dev`, `build`, `test`; bin field for executable
- [ ] `tsconfig.json` — Strict mode, target ESNext, module Preserve
- [ ] `bunfig.toml` — Bun-specific runtime configuration (minimal Phase 1)
- [ ] ESLint / Prettier setup — Configuration files added Phase 1

**No gaps in framework choice — Vitest, Commander, and Bun are production-ready from day one.**

## Open Questions

1. **Will mysql2 native bindings work on all platforms in Phase 3?**
   - What we know: Bun 1.2+ improved tls/net support; mysql2 works in testing
   - What's unclear: Edge cases on Windows with native modules
   - Recommendation: Validate in Phase 3 early; have pure-JS mysql fallback ready

2. **Should dbcli support zero-config (auto-discover .env)?**
   - What we know: Reading .env is straightforward with dotenv
   - What's unclear: How aggressive should auto-detection be? Risk of connecting to wrong database
   - Recommendation: Defer to Phase 2 planning; research project's risk tolerance

3. **How large can bundled executable be before distribution becomes painful?**
   - What we know: Roadmap specifies < 5MB as success criteria
   - What's unclear: If dependencies bloat the bundle, what gets cut?
   - Recommendation: Monitor bundle size in Phase 1; establish size budget early

## Sources

### Primary (HIGH confidence)

- **Bun Official Documentation** - https://bun.com/docs (runtime capabilities, bundler comparison vs esbuild, GitHub Actions setup)
- **Commander.js v13 Documentation** - https://github.com/tj/commander.js (CLI parsing, TypeScript support)
- **Vitest Official Documentation** - https://vitest.dev/ (testing framework, configuration for Bun)

### Secondary (MEDIUM confidence)

- [The Complete Guide to Building Developer CLI Tools in 2026](https://dev.to/chengyixu/the-complete-guide-to-building-developer-cli-tools-in-2026-a96) - DEV Community | Framework comparison, best practices
- [How to Build CLI Applications with Bun](https://oneuptime.com/blog/post/2026-01-31-bun-cli-applications/view) - Oneuptime Blog | Bun-specific CLI patterns
- [Setting up ESLint, Prettier & Husky in a Bun TypeScript Project](https://medium.com/@dharminnagar/setting-up-eslint-prettier-husky-in-a-bun-typescript-project-063fb5076d12) - Dharmin Nagar | ESLint/Prettier configuration
- [GitHub Actions in 2026](https://dev.to/ottoaria/github-actions-in-2026-automate-everything-for-free-cicd-tutorial-4aj1) - DEV Community | Matrix testing patterns

### Tertiary (LOW confidence - marked for validation)

- Individual blog posts on Bun performance benchmarks (startup time measured ~5ms vs Node ~50ms) — should be verified with official benchmarks before claiming as hard requirement

## Metadata

**Confidence breakdown:**

- **Standard Stack:** HIGH - Commander.js, Vitest, Bun are industry standard (2026); versions verified against npm registry
- **Architecture:** HIGH - Project structure and patterns based on official Bun docs and Commander.js examples
- **Pitfalls:** MEDIUM-HIGH - Common issues identified from 2026 ecosystem discussions; native module issues confirmed in GitHub issues
- **Tooling:** HIGH - ESLint/Prettier/GitHub Actions setup well-documented and battle-tested

**Research date:** 2026-03-25
**Valid until:** 2026-04-30 (30 days; Bun moves fast but core patterns stable)

**Assumptions made:**
- Project targets modern Bun 1.3.x (not older versions or Bun nightly)
- GitHub as hosting platform (Actions available; alternative CI would change workflow)
- Standard npm registry (no private registries or monorepo concerns in Phase 1)
- Cross-platform development expected (Windows support required based on roadmap)
