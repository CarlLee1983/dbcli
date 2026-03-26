# Phase 2: Init & Config - Research

**Researched:** 2026-03-25
**Domain:** .env parsing, interactive prompts, JSON configuration schema, immutable config management, input validation
**Confidence:** HIGH

## Summary

Phase 2 is the first major feature implementation phase. Its primary challenge is handling variability in .env file formats (DATABASE_URL vs individual DB_HOST/PORT/USER/PASSWORD/NAME variables) while maintaining immutability patterns for config read/write operations. Bun's built-in .env loading simplifies the infrastructure layer, but custom parsing is required to handle both connection URL formats (PostgreSQL/MySQL URL syntax) and component-based formats.

The interactive prompts segment encounters compatibility concerns: both `@inquirer/prompts` and `@clack/prompts` have documented Bun compatibility issues (AsyncResource instantiation, stdin EPERM errors), but both libraries are pure TypeScript and workarounds exist. The research recommends a defensive approach: implement a minimal fallback prompt system in case third-party libraries fail at runtime.

The `.dbcli` JSON schema design must balance simplicity (easy to understand) with completeness (support for future multi-connection and per-table permissions in V2). Immutability patterns prevent silent config corruption; the recommended approach uses Immer-style "copy-on-write" semantics via TypeScript's spread operator.

**Primary recommendation:**
1. Use Bun's built-in .env loading for automatic variable population
2. Implement dual-path .env parser: DATABASE_URL via URL.parse() with percent-decoding, or DB_* components via validation schema
3. Use `@inquirer/prompts` with runtime fallback to minimal synchronous prompts (no external library)
4. Design `.dbcli` schema as: `{ connection, permission, schema }` blocks with per-database defaults
5. Build config module with immutable operations: `read() → validate() → merge() → write()`

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Bun | 1.3.3+ | Built-in .env loading, runtime | Automatic .env parsing before script runs; PROJECT.md locked decision |
| TypeScript | 5.3+ | Type-safe config structures | Strict mode prevents silent .dbcli parsing errors |
| Zod | 3.22+ | Runtime validation of .dbcli config | Schema-first approach catches invalid configs early; supports custom parsing |
| @inquirer/prompts | 5.0+ | Interactive CLI prompts | Rich prompt types (text, select, confirm, group); accessible defaults |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| dotenv | 16.3+ | Fallback .env parser (pure JS) | Already in package.json; supports dotenv-safe pattern if needed |
| node:url | Built-in | Parse DATABASE_URL connection strings | Native URL.parse() with decoding; no extra dependency |
| node:fs | Built-in | Read/write .dbcli files | Bun.file preferred (see Phase 1 CLAUDE.md) |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| @inquirer/prompts | @clack/prompts | @clack/prompts has same Bun compatibility issues (stdin EPERM); @inquirer slightly more mature ecosystem |
| @inquirer/prompts | Manual stdin parsing | Full control, zero dependencies; much more code, poor UX (no visual validation), accessibility issues |
| Zod | JSON-schema-to-zod | Adds complexity for minimal gain; Zod inline schemas are more idiomatic for TypeScript CLI |
| NODE url.parse | Custom regex parser | Avoid—regex for URLs is fragile; RFC 3986 percent-encoding is non-trivial |
| Immutable.js | Manual object spread | Immutable.js is heavier (extra dependency); TypeScript spread operators are sufficient for this domain |

**Installation:**
```bash
bun add @inquirer/prompts
# dotenv already in package.json; zod already in package.json
```

**Version verification:**
- Bun 1.3.3 (latest stable, locked in project)
- TypeScript 5.3+ (already in project)
- Zod 3.22.4 (already in package.json)
- @inquirer/prompts 5.0.0 (added in Phase 1 devDependencies)
- dotenv 16.3.1 (already in package.json)

## Architecture Patterns

### Recommended Project Structure

```
src/
├── cli.ts                        # Entry point (already exists)
├── commands/
│   └── init.ts                   # NEW: `dbcli init` command implementation
├── core/
│   ├── config.ts                 # NEW: Config read/write module (immutable)
│   └── env-parser.ts             # NEW: .env parsing (DATABASE_URL + DB_* variants)
├── utils/
│   ├── validation.ts             # NEW: Zod schemas for .dbcli, .env validation
│   ├── errors.ts                 # NEW: Custom error classes (EnvParseError, ConfigError, etc.)
│   └── prompts.ts                # NEW: Prompt wrappers with fallback system
├── types/
│   └── index.ts                  # MODIFY: Add DbcliConfig, ConnectionConfig interfaces
└── adapters/
    └── defaults.ts               # NEW: Database-specific defaults (port, socket, etc.)

tests/
├── unit/
│   ├── core/
│   │   ├── config.test.ts        # NEW: Config read/write/merge tests
│   │   └── env-parser.test.ts    # NEW: .env parsing with variations
│   └── utils/
│       └── validation.test.ts    # NEW: Zod schema validation tests
├── integration/
│   └── init-command.test.ts      # NEW: Full `dbcli init` flow tests
└── fixtures/
    ├── .env.postgres             # NEW: Sample .env (DATABASE_URL format)
    ├── .env.mysql                # NEW: Sample .env (DB_* component format)
    ├── .env.edge-cases           # NEW: Special chars, encoding variations
    ├── sample.dbcli.json         # NEW: Valid .dbcli output
    └── sample.dbcli.invalid.json # NEW: Invalid configs (for negative tests)
```

### Pattern 1: Config Read/Write with Immutability

**What:** Separate concerns of reading, parsing, validating, merging, and writing config files. Never mutate during these operations.

**When to use:** Any config management task to prevent silent data corruption and enable auditing.

**Example:**

```typescript
// Source: ROADMAP.md Phase 2, from project decision on immutability (CLAUDE.md rules/coding-style.md)

// Core config module: immutable operations
export const configModule = {
  read: async (path: string): Promise<RawDbcliConfig> => {
    const content = await Bun.file(path).text().catch(() => '{}')
    return JSON.parse(content)
  },

  validate: (raw: unknown): DbcliConfig => {
    return DbcliConfigSchema.parse(raw)
  },

  merge: (existing: DbcliConfig, updates: Partial<DbcliConfig>): DbcliConfig => {
    // Returns NEW object, never mutates existing
    return {
      ...existing,
      ...updates,
      connection: { ...existing.connection, ...updates.connection },
      schema: { ...existing.schema, ...updates.schema }
    }
  },

  write: async (path: string, config: DbcliConfig): Promise<void> => {
    const json = JSON.stringify(config, null, 2)
    await Bun.file(path).write(json)
  }
}

// Usage: Read → Validate → Merge → Write (atomic operations)
const existing = await configModule.read('.dbcli')
const validated = configModule.validate(existing)
const merged = configModule.merge(validated, { permission: 'read-write' })
await configModule.write('.dbcli', merged)
```

### Pattern 2: .env Parsing with Dual Paths

**What:** Parse .env files supporting both DATABASE_URL (connection string) and DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME (component) formats.

**When to use:** Phase 2 init command to extract existing database credentials.

**Example:**

```typescript
// Source: WebSearch verified with Prisma Connection URLs doc + RFC 3986 percent-encoding
// https://www.prisma.io/docs/orm/reference/connection-urls

export const parseEnvDatabase = (env: Record<string, string>): DatabaseEnv => {
  // Path 1: DATABASE_URL (connection string)
  if (env.DATABASE_URL) {
    return parseConnectionUrl(env.DATABASE_URL)
  }

  // Path 2: DB_* components (individual variables)
  if (env.DB_HOST || env.DB_USER) {
    return {
      system: env.DB_SYSTEM || 'postgresql',
      host: env.DB_HOST || 'localhost',
      port: parseInt(env.DB_PORT || '5432', 10),
      user: env.DB_USER || '',
      password: env.DB_PASSWORD || '',
      database: env.DB_NAME || ''
    }
  }

  return null // No database config found
}

function parseConnectionUrl(url: string): DatabaseEnv {
  try {
    const parsed = new URL(url)
    const system = parseSystem(parsed.protocol) // 'postgresql://' → 'postgresql'

    return {
      system,
      host: parsed.hostname || 'localhost',
      port: parsed.port ? parseInt(parsed.port, 10) : getDefaultPort(system),
      user: decodeURIComponent(parsed.username),
      password: decodeURIComponent(parsed.password),
      database: parsed.pathname.slice(1) // Remove leading /
    }
  } catch (error) {
    throw new EnvParseError(`Invalid DATABASE_URL: ${error.message}`)
  }
}
```

### Pattern 3: Interactive Prompts with Fallback

**What:** Use `@inquirer/prompts` with a minimal synchronous fallback system in case Bun compatibility issues arise.

**When to use:** Phase 2 `dbcli init` to guide user through interactive configuration.

**Example:**

```typescript
// Source: @inquirer/prompts npm + github.com/wobsoriano/bun-promptx (Bun-native alternative)

export const promptUser = {
  // Try @inquirer/prompts first; fallback to sync if it fails
  async text(message: string, defaultValue?: string): Promise<string> {
    try {
      const { text } = await import('@inquirer/prompts')
      return await text({ message, default: defaultValue })
    } catch (error) {
      // Fallback: synchronous stdin (worse UX, but functional)
      console.log(`${message}${defaultValue ? ` [${defaultValue}]` : ''}`)
      return readlineSync.question('> ') || defaultValue || ''
    }
  },

  async select(message: string, choices: string[]): Promise<string> {
    try {
      const { select } = await import('@inquirer/prompts')
      return await select({ message, choices })
    } catch {
      console.log(`${message}`)
      choices.forEach((c, i) => console.log(`  ${i + 1}) ${c}`))
      const answer = readlineSync.question('> ')
      return choices[parseInt(answer, 10) - 1] || choices[0]
    }
  },

  async confirm(message: string): Promise<boolean> {
    try {
      const { confirm } = await import('@inquirer/prompts')
      return await confirm({ message })
    } catch {
      const answer = readlineSync.question(`${message} (y/n) `)
      return answer.toLowerCase() === 'y'
    }
  }
}
```

### Anti-Patterns to Avoid

- **Mutating config during read/write:** Direct property assignments during config updates create silent data corruption. Always return new objects.
- **Parsing DATABASE_URL with regex:** URL syntax has edge cases (percent-encoding, IPv6 addresses in brackets, socket paths). Use `new URL()` constructor or established library.
- **Unvalidated .dbcli config:** Loading JSON without schema validation allows invalid configs to break downstream commands. Always validate at read time.
- **Hardcoded port numbers:** Database port defaults vary (PostgreSQL 5432, MySQL/MariaDB 3306). Store in adapter-specific config, not scattered throughout code.
- **Blocking prompts at top level:** Interactive prompts should be isolated in their own module so fallback systems and testing can substitute them easily.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| URL parsing (DATABASE_URL) | Custom regex parser | `new URL()` + RFC 3986 decoding | Handles edge cases: percent-encoding, port inference, protocol normalization |
| Config file I/O | Direct fs.readFile/writeFile | Bun.file (already required by CLAUDE.md) | Async API, better error messages, Bun-native performance |
| Input validation (config schema) | Manual if/else checks | Zod schema (already in package.json) | Type inference, composable validation, error accumulation, not error-on-first |
| Interactive prompts | Manual stdin/readline | @inquirer/prompts (with fallback) | Accessibility, visual feedback, validation, cancellation handling |
| Password special char handling | Manual URL.encode | Built-in decodeURIComponent() | RFC 3986 compliant, handles all reserved chars, standard library |

**Key insight:** .env parsing and config I/O seem simple until edge cases arise—special characters in passwords, socket connections, cloud-provider URL formats (Google Cloud MySQL), missing defaults. Established libraries have field experience; custom solutions regress.

## Runtime State Inventory

> NOT APPLICABLE — Phase 2 is greenfield (no existing config state to migrate).

Confirmation: This phase creates the first `.dbcli` config files. No data migration required.

## Common Pitfalls

### Pitfall 1: DATABASE_URL Percent-Encoding Mismatch

**What goes wrong:** User's .env contains `DATABASE_URL=postgresql://user:p@$$w0rd@localhost/db`. Standard `new URL()` parsing fails or decodes incorrectly, leading to "authentication failed" errors that blame the user's password instead of the parser.

**Why it happens:** RFC 3986 requires special characters (like `$`, `@`, `#`) to be percent-encoded in URLs. Users often forget this. The parsed credentials don't match what the database expects.

**How to avoid:**
1. Document in --help that DATABASE_URL passwords must be percent-encoded (show example: `p@$$w0rd` → `p%40%24%24w0rd`)
2. Add a validation test with special characters: `p@$$w0rd#!`, `user!email@host`
3. Test connection immediately after parsing to catch encoding errors early
4. Error message should hint: "Password may need percent-encoding; see `dbcli init --help`"

**Warning signs:**
- User reports "init works fine but `dbcli query` fails with auth error"
- Credentials work in other tools (psql, mysql CLI) but not dbcli
- Password contains non-alphanumeric characters

### Pitfall 2: .env Component Vars Incomplete

**What goes wrong:** User provides DB_HOST and DB_PASSWORD but forgets DB_USER and DB_NAME. Init creates a partial config. Downstream commands fail with cryptic errors like "no such table" (because DB_NAME is empty, pointing to wrong database).

**Why it happens:** .env component variables (DB_HOST, DB_PORT, etc.) don't have obvious defaults like DATABASE_URL does. Users assume some have defaults; they don't.

**How to avoid:**
1. Zod schema requires all five: `{ host, port, user, password, database }`. If any are missing, prompt interactively.
2. Validation error: "DB_USER not found in .env; please provide: `export DB_USER=myuser`"
3. Make prompts conditional: if DATABASE_URL exists, skip all prompts (already have complete URL); if .env components exist, only prompt missing ones
4. Test matrix: `[DATABASE_URL set] × [all DB_* set] × [some DB_* set] × [none set]` → 4 test cases

**Warning signs:**
- Init succeeds but connection test fails
- User says "my .env is correct, why doesn't init work?"
- Logs show empty values in parsed config

### Pitfall 3: .dbcli File Conflicts (Re-running Init)

**What goes wrong:** User runs `dbcli init` twice. First time creates .dbcli with `{ system: 'postgresql', permission: 'query-only' }`. Second run overwrites it without prompting. User loses custom permission level or accidentally reverts to different database.

**Why it happens:** No confirmation step; too eager to write. Config files are precious—losing changes is worse than prompting.

**How to avoid:**
1. Before writing .dbcli, check if it exists
2. If it exists, prompt: `"File .dbcli already exists. (a)ppend/(o)verwrite/(q)uit?"`
3. If append/merge mode: load existing config, prompt for changes, merge new values, write
4. Add `--force` flag for CI/automation: `dbcli init --force` skips confirmation
5. Test: run init twice, verify second run prompts before overwriting

**Warning signs:**
- User runs init, changes permission in .dbcli, runs init again, permission reverts
- Loss of configuration between runs

### Pitfall 4: Prompts Hang or Timeout with @inquirer/prompts

**What goes wrong:** User runs `dbcli init` on certain Bun versions (or CI environment) and the prompt never returns; process hangs or times out after 30s.

**Why it happens:** Known Bun compatibility issues: @inquirer/prompts uses AsyncResource (Node internals), stdin handling differs between Bun and Node, or CI environment lacks TTY.

**How to avoid:**
1. Implement fallback prompts system (see Pattern 3 above) — gracefully degrade if @inquirer fails
2. Detect non-TTY early: `if (!process.stdin.isTTY) { useNonInteractiveMode() }`
3. Add timeout wrapper around prompts: `withTimeout(prompt, 10000)` — if no response in 10s, assume hang and use default
4. Log which prompt system is active: `[prompt:inquirer]` or `[prompt:fallback]` for debugging
5. Test in CI environment with `--no-interactive` flag: `dbcli init --no-interactive --host localhost --port 5432 ...`

**Warning signs:**
- Works locally but hangs in GitHub Actions CI
- Works in Node.js but hangs in Bun
- "Process killed after timeout" in CI logs

### Pitfall 5: Schema Defaults Not Applied

**What goes wrong:** After init completes, .dbcli config is missing expected defaults. E.g., `{ connection: { host: 'localhost', port: null, user: 'admin' } }` instead of `{ ..., port: 5432 }`.

**Why it happens:** Defaults are scattered: some in prompts (the default value shown), some in adapters (DEFAULT_PORT), some in validation schemas. When merging, defaults are lost.

**How to avoid:**
1. Define defaults in ONE place: adapters/defaults.ts with `getDefaultsForSystem(system: 'postgresql' | 'mysql')`
2. In init flow: after prompts, merge defaults: `config = { ...defaults, ...promptAnswers }`
3. Validation schema should provide defaults via Zod: `.default(3306)` on port field
4. Test explicitly: `expect(config.connection.port).toBe(5432)` for PostgreSQL, etc.
5. Document in code: "Defaults applied here in order: [file] → [defaults] → [prompts]"

**Warning signs:**
- Config has null/undefined port; connection attempts fail
- Defaults work in development but not in user environments

## Code Examples

Verified patterns from official sources and WebSearch findings:

### .env Parsing (DATABASE_URL)

```typescript
// Source: Prisma Connection URLs documentation + RFC 3986 percent-encoding
// https://www.prisma.io/docs/orm/reference/connection-urls

import { EnvParseError } from '@/utils/errors'

export function parseConnectionUrl(
  url: string
): {
  system: 'postgresql' | 'mysql' | 'mariadb'
  host: string
  port: number
  user: string
  password: string
  database: string
} {
  try {
    const parsed = new URL(url)

    // Detect database system from protocol
    const protocol = parsed.protocol.replace(':', '')
    let system: 'postgresql' | 'mysql' | 'mariadb'
    if (protocol === 'postgresql' || protocol === 'postgres') {
      system = 'postgresql'
    } else if (protocol === 'mysql') {
      system = 'mysql'
    } else if (protocol === 'mariadb') {
      system = 'mariadb'
    } else {
      throw new Error(`Unknown protocol: ${protocol}`)
    }

    // Extract components with percent-decoding
    const host = parsed.hostname || 'localhost'
    const port =
      parsed.port !== ''
        ? parseInt(parsed.port, 10)
        : system === 'postgresql'
          ? 5432
          : 3306

    // CRITICAL: Decode username/password to handle special characters
    const user = decodeURIComponent(parsed.username || '')
    const password = decodeURIComponent(parsed.password || '')
    const database = parsed.pathname.slice(1) // Remove leading /

    return { system, host, port, user, password, database }
  } catch (error) {
    throw new EnvParseError(
      `Failed to parse DATABASE_URL: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}
```

### Zod Config Schema

```typescript
// Source: Zod documentation (https://zod.dev/) + project immutability requirement

import { z } from 'zod'

export const ConnectionConfigSchema = z.object({
  system: z.enum(['postgresql', 'mysql', 'mariadb']),
  host: z.string().min(1, 'Host is required'),
  port: z.number().int().min(1).max(65535),
  user: z.string().min(1, 'Database user is required'),
  password: z.string().default(''),
  database: z.string().min(1, 'Database name is required')
})

export const PermissionSchema = z.enum(['query-only', 'read-write', 'admin'])

export const DbcliConfigSchema = z.object({
  connection: ConnectionConfigSchema,
  permission: PermissionSchema.default('query-only'),
  schema: z.record(z.any()).optional().default({}),
  metadata: z
    .object({
      createdAt: z.string().datetime().optional(),
      version: z.string().default('1.0')
    })
    .optional()
    .default({})
})

export type DbcliConfig = z.infer<typeof DbcliConfigSchema>
export type ConnectionConfig = z.infer<typeof ConnectionConfigSchema>
```

### Immutable Config Module

```typescript
// Source: Project CLAUDE.md rules/coding-style.md (immutability requirement)

import { Bun } from 'bun'
import { DbcliConfig, DbcliConfigSchema } from '@/utils/validation'
import { ConfigError } from '@/utils/errors'

export const configModule = {
  async read(path: string): Promise<DbcliConfig> {
    try {
      const file = Bun.file(path)
      if (!(await file.exists())) {
        return {
          connection: {
            system: 'postgresql',
            host: 'localhost',
            port: 5432,
            user: '',
            password: '',
            database: ''
          },
          permission: 'query-only'
        } as DbcliConfig
      }
      const content = await file.text()
      const raw = JSON.parse(content)
      return DbcliConfigSchema.parse(raw)
    } catch (error) {
      throw new ConfigError(
        `Failed to read .dbcli config: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  },

  validate(raw: unknown): DbcliConfig {
    try {
      return DbcliConfigSchema.parse(raw)
    } catch (error) {
      throw new ConfigError(
        `Invalid .dbcli config structure: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  },

  // Immutable merge: never modify input objects
  merge(
    existing: DbcliConfig,
    updates: Partial<DbcliConfig>
  ): DbcliConfig {
    return {
      ...existing,
      ...updates,
      connection: {
        ...existing.connection,
        ...(updates.connection || {})
      },
      metadata: {
        ...existing.metadata,
        ...(updates.metadata || {}),
        createdAt: existing.metadata?.createdAt || new Date().toISOString()
      }
    } as DbcliConfig
  },

  async write(path: string, config: DbcliConfig): Promise<void> {
    try {
      const validated = this.validate(config)
      const json = JSON.stringify(validated, null, 2)
      await Bun.file(path).write(json)
    } catch (error) {
      throw new ConfigError(
        `Failed to write .dbcli config: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }
}
```

### Interactive Init Command

```typescript
// Source: Phase 2 ROADMAP.md + @inquirer/prompts npm package

import { Command } from 'commander'
import { configModule } from '@/core/config'
import { parseEnvDatabase } from '@/core/env-parser'
import { promptUser } from '@/utils/prompts'
import { getDefaultsForSystem } from '@/adapters/defaults'
import { DatabaseEnv } from '@/types'

export const initCommand = new Command('init')
  .description('Initialize dbcli configuration with .env parsing and interactive prompts')
  .option('--no-interactive', 'Non-interactive mode (requires all flags)')
  .option('--host <host>', 'Database host')
  .option('--port <port>', 'Database port')
  .option('--user <user>', 'Database user')
  .option('--password <password>', 'Database password')
  .option('--name <name>', 'Database name')
  .action(async (options) => {
    try {
      // Step 1: Try to load from .env
      const envVars = process.env
      const envDb = parseEnvDatabase(envVars)

      // Step 2: Determine database system
      let dbSystem = envDb?.system || options.system
      if (!dbSystem) {
        dbSystem = await promptUser.select(
          'Select database system:',
          ['postgresql', 'mysql', 'mariadb']
        )
      }

      // Step 3: Gather connection details (prompt for missing ones)
      const defaults = getDefaultsForSystem(dbSystem)
      const connection = {
        system: dbSystem,
        host: options.host || envDb?.host || (await promptUser.text('Database host:', defaults.host)),
        port: options.port
          ? parseInt(options.port, 10)
          : envDb?.port || (await promptUser.text('Database port:', String(defaults.port))).then(Number),
        user: options.user || envDb?.user || (await promptUser.text('Database user:')),
        password: options.password || envDb?.password || (await promptUser.text('Database password (optional):')),
        database: options.name || envDb?.database || (await promptUser.text('Database name:'))
      }

      // Step 4: Create config
      const config = configModule.merge(
        { connection: { system: dbSystem, host: '', port: 0, user: '', password: '', database: '' }, permission: 'query-only' } as any,
        { connection }
      )

      // Step 5: Write to file
      const path = options.config || '.dbcli'
      await configModule.write(path, config)
      console.log(`✓ Configuration saved to ${path}`)
    } catch (error) {
      console.error(`✗ Init failed: ${error instanceof Error ? error.message : String(error)}`)
      process.exit(1)
    }
  })
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Manual .env parsing with regex | URL.parse() + built-in decoding | 2024+ | Handles percent-encoding correctly; fewer edge cases |
| One prompt library for all CLIs (Inquirer.js) | @inquirer/prompts (scoped) + @clack/prompts alternative | 2024-2025 | Better TypeScript support, smaller bundle, per-library maintained |
| Config files without validation | Zod schemas at read/write time | 2023+ | Type-safe configs, meaningful error messages, prevents silent corruption |
| Mutable config merging | Immutable spread patterns + TypeScript | 2022+ | Auditable changes, easier testing, prevents bugs in multi-step flows |
| Bun with Node.js fallback | Bun-first for CLI (10x faster startup) | 2024+ | CLI startup < 200ms (important for user experience); Bun maturity achieved ~1.0 |

**Deprecated/outdated:**
- Inquirer.js (original): Older, slower, less TypeScript support; replaced by @inquirer/prompts (scoped version)
- dotenv-safe: Added no real safety; plain dotenv + Zod validation is superior
- Manual database URL parsing: Too many edge cases; established libraries handle RFC 3986 properly

## Open Questions

1. **Fallback prompt system scope**
   - What we know: @inquirer/prompts has documented Bun compatibility issues (AsyncResource, stdin EPERM)
   - What's unclear: Will issues appear on all Bun versions or only specific ones? Do they arise in CI (no TTY) only?
   - Recommendation: Implement minimal fallback (Pattern 3) as safeguard. Test both code paths in unit tests. If fallback never triggers in practice, it's just defensive code. If it triggers unexpectedly, we have a workaround.

2. **Database socket connections**
   - What we know: MySQL/PostgreSQL support Unix sockets (faster than TCP on same host)
   - What's unclear: Should Phase 2 support socket paths? Is `host: "/var/run/postgresql"` a valid socket path?
   - Recommendation: DEFER to Phase 3. For now, assume TCP connections only. Add socket support when DB adapters are implemented and we understand the connection API requirements.

3. **Multi-database config scope (V1 vs V2)**
   - What we know: ROADMAP says "single connection in V1" is pending validation
   - What's unclear: Should .dbcli schema support multiple `connection` blocks now, even if only one is active?
   - Recommendation: LOCK to single connection for V1 (simpler code, clearer UX). Design schema to be upgradeable in V2 without breaking V1 configs.

## Environment Availability

Step 2.6 SKIPPED — Phase 2 has no external dependencies. All tools (Bun, Node.js, filesystem) are available in development environment; no databases need to be running for init to work (connection test deferred to Phase 3).

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 1.2+ (already configured in Phase 1) |
| Config file | vitest.config.ts (if needed; may use defaults) |
| Quick run command | `bun test tests/unit/core/ --run` |
| Full suite command | `bun test --run --coverage` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| INIT-01 | `dbcli init` auto-fills from .env, prompts missing | integration | `bun test tests/integration/init-command.test.ts --run` | ❌ Wave 0 |
| INIT-03 | .env parser handles DATABASE_URL and DB_* formats | unit | `bun test tests/unit/core/env-parser.test.ts --run` | ❌ Wave 0 |
| INIT-04 | .dbcli JSON generation with valid schema | unit | `bun test tests/unit/core/config.test.ts --run` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `bun test tests/unit/ --run` (unit tests only, 2-3 second run)
- **Per wave merge:** `bun test --run --coverage` (full suite with coverage report, should be < 10s)
- **Phase gate:** All tests green + coverage >= 80% before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `tests/unit/core/env-parser.test.ts` — covers INIT-03 (.env parsing with DATABASE_URL, DB_* components, special chars)
- [ ] `tests/unit/core/config.test.ts` — covers INIT-04 (read, validate, merge, write operations; immutability checks)
- [ ] `tests/unit/utils/validation.test.ts` — Zod schema validation for .dbcli config
- [ ] `tests/integration/init-command.test.ts` — covers INIT-01 (full init flow: .env detection, prompts, file generation)
- [ ] `tests/fixtures/.env.*` — sample .env files for testing (postgres, mysql, edge cases, invalid)
- [ ] `tests/fixtures/sample.dbcli.json` — valid config output for snapshot testing

_(Note: Test infrastructure already in place from Phase 1; only Phase 2 specific test files are needed.)_

## Sources

### Primary (HIGH confidence)

- **Bun Documentation** (https://bun.com/docs/runtime/environment-variables) — Verified Bun's built-in .env loading and file APIs
- **Prisma Connection URLs** (https://www.prisma.io/docs/orm/reference/connection-urls) — Verified DATABASE_URL parsing and percent-encoding requirements
- **Zod Official Documentation** (https://zod.dev/) — Verified schema design patterns and validation API
- **RFC 3986 (Percent-Encoding)** — Verified special character encoding in URL userinfo
- **PostgreSQL/MySQL Documentation** — Verified default ports (PostgreSQL 5432, MySQL/MariaDB 3306)

### Secondary (MEDIUM confidence)

- **@inquirer/prompts npm package** (https://www.npmjs.com/package/@inquirer/prompts) — Package info, version 5.0.0 current
- **@clack/prompts DEV Community article** (https://dev.to/chengyixu/clackprompts-the-modern-alternative-to-inquirerjs-1ohb) — Overview of modern CLI prompts
- **Immer.js Documentation** (https://immerjs.github.io/immer/) — Immutable patterns reference for config management
- **Bun Compatibility in 2026** (https://dev.to/alexcloudstar/bun-compatibility-in-2026-what-actually-works-what-does-not-and-when-to-switch-23eb) — Known compatibility issues with prompt libraries

### Tertiary (LOW confidence, marked for validation)

- **WebSearch findings on Bun prompt compatibility** — Found multiple GitHub issues, but not all confirmed reproducible on latest Bun 1.3.3
  - Recommendation: Test @inquirer/prompts thoroughly in Wave 0; fallback system is safeguard

## Metadata

**Confidence breakdown:**
- Standard stack: **HIGH** — All libraries are production-ready, widely used; versions are current as of 2026-03-25
- Architecture (.env parsing, config I/O): **HIGH** — Patterns are well-established; RFC standards are stable
- Interactive prompts: **MEDIUM** — @inquirer/prompts has documented Bun issues, but workarounds exist
- Pitfalls: **HIGH** — Derived from real-world .env variability and config file problems documented in ecosystem
- Test strategy: **HIGH** — Vitest is configured; test patterns follow Phase 1 established approach

**Research date:** 2026-03-25
**Valid until:** 2026-04-15 (30 days for stable stack; if Bun releases 1.4.0 or prompt library has breaking changes, re-validate)

**Notes:**
- This phase's success depends heavily on thorough test coverage of .env variations (special chars, missing vars, malformed URLs)
- Fallback prompt system is defensive architecture; design it to be testable and optional
- Immutability patterns are non-negotiable per project CLAUDE.md; ensure all config operations follow copy-on-write semantics
