# Multi-Connection & Custom Env File Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable dbcli to manage multiple named database connections per project, each with an optional custom env file path.

**Architecture:** Extend the existing v1 config format with a v2 format containing a `connections` map and `default` pointer. Add format detection to the config module so v1 configs continue working unchanged. Add a `use` command and global `--use` option for connection switching. Env file loading happens per-connection before `$env` reference resolution.

**Tech Stack:** Bun, TypeScript, Commander.js, Zod, bun:test

**Spec:** `docs/superpowers/specs/2026-03-31-multi-connection-env-file-design.md`

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `src/core/env-loader.ts` | Parse and load env files into process.env |
| `src/core/config-v2.ts` | V2 format detection, reading, writing, connection resolution |
| `src/commands/use.ts` | `dbcli use` command handler |
| `tests/unit/core/env-loader.test.ts` | Env loader unit tests |
| `tests/unit/core/config-v2.test.ts` | V2 config format unit tests |
| `tests/unit/commands/use.test.ts` | Use command unit tests |

### Modified Files
| File | Changes |
|------|---------|
| `src/utils/validation.ts` | Add V2 Zod schemas (`DbcliConfigV2Schema`, `NamedConnectionSchema`) |
| `src/core/config.ts` | Integrate v2 detection, delegate to `config-v2.ts` for v2 format |
| `src/commands/init.ts` | Add `--name`, `--env-file`, `--remove`, `--rename` options; v2 format generation |
| `src/cli.ts` | Register `use` command, add global `--use` option |
| `src/commands/doctor.ts` | Add v2-specific checks (envFile existence, $env resolution, default validity) |
| `resources/lang/en/messages.json` | Add i18n keys for use command and new init messages |
| `resources/lang/zh-TW/messages.json` | Add zh-TW translations |

---

## Task 1: Env File Loader

**Files:**
- Create: `src/core/env-loader.ts`
- Test: `tests/unit/core/env-loader.test.ts`

- [ ] **Step 1: Write failing tests for env-loader**

```typescript
// tests/unit/core/env-loader.test.ts
import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { loadEnvFile } from '@/core/env-loader'
import { join } from 'path'

const TMP_DIR = '/tmp/dbcli-env-loader-test'

describe('loadEnvFile', () => {
  beforeEach(async () => {
    await Bun.$`mkdir -p ${TMP_DIR}`
  })

  afterEach(async () => {
    await Bun.$`rm -rf ${TMP_DIR}`
    // Clean up any env vars we set
    delete process.env.TEST_LOADER_HOST
    delete process.env.TEST_LOADER_PORT
    delete process.env.TEST_LOADER_PASSWORD
    delete process.env.TEST_LOADER_QUOTED
    delete process.env.TEST_LOADER_EXISTING
  })

  test('should load key=value pairs into process.env', async () => {
    const envPath = join(TMP_DIR, '.env.test')
    await Bun.file(envPath).write('TEST_LOADER_HOST=staging.example.com\nTEST_LOADER_PORT=5433\n')

    await loadEnvFile(envPath)

    expect(process.env.TEST_LOADER_HOST).toBe('staging.example.com')
    expect(process.env.TEST_LOADER_PORT).toBe('5433')
  })

  test('should not overwrite existing env vars', async () => {
    process.env.TEST_LOADER_EXISTING = 'original'
    const envPath = join(TMP_DIR, '.env.test')
    await Bun.file(envPath).write('TEST_LOADER_EXISTING=overwritten\n')

    await loadEnvFile(envPath)

    expect(process.env.TEST_LOADER_EXISTING).toBe('original')
  })

  test('should skip comments and empty lines', async () => {
    const envPath = join(TMP_DIR, '.env.test')
    await Bun.file(envPath).write('# comment\n\nTEST_LOADER_HOST=localhost\n  # another comment\n')

    await loadEnvFile(envPath)

    expect(process.env.TEST_LOADER_HOST).toBe('localhost')
  })

  test('should handle quoted values', async () => {
    const envPath = join(TMP_DIR, '.env.test')
    await Bun.file(envPath).write('TEST_LOADER_QUOTED="hello world"\n')

    await loadEnvFile(envPath)

    expect(process.env.TEST_LOADER_QUOTED).toBe('hello world')
  })

  test('should handle single-quoted values', async () => {
    const envPath = join(TMP_DIR, '.env.test')
    await Bun.file(envPath).write("TEST_LOADER_QUOTED='hello world'\n")

    await loadEnvFile(envPath)

    expect(process.env.TEST_LOADER_QUOTED).toBe('hello world')
  })

  test('should handle password with special characters', async () => {
    const envPath = join(TMP_DIR, '.env.test')
    await Bun.file(envPath).write('TEST_LOADER_PASSWORD=p@ss=w0rd#123\n')

    await loadEnvFile(envPath)

    expect(process.env.TEST_LOADER_PASSWORD).toBe('p@ss=w0rd#123')
  })

  test('should throw if file does not exist', async () => {
    const envPath = join(TMP_DIR, '.env.nonexistent')

    expect(loadEnvFile(envPath)).rejects.toThrow('找不到 env 檔案')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/unit/core/env-loader.test.ts`
Expected: FAIL — module `@/core/env-loader` not found

- [ ] **Step 3: Implement env-loader**

```typescript
// src/core/env-loader.ts
/**
 * Load environment variables from a file into process.env
 * Does NOT overwrite existing variables (consistent with dotenv convention)
 */

import { ConfigError } from '@/utils/errors'

/**
 * Parse a .env file content into key-value pairs
 * Supports: KEY=VALUE, KEY="VALUE", KEY='VALUE', comments (#), empty lines
 */
function parseEnvContent(content: string): Array<[string, string]> {
  const entries: Array<[string, string]> = []

  for (const line of content.split('\n')) {
    const trimmed = line.trim()

    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith('#')) continue

    // Find first = sign
    const eqIndex = trimmed.indexOf('=')
    if (eqIndex === -1) continue

    const key = trimmed.slice(0, eqIndex).trim()
    let value = trimmed.slice(eqIndex + 1)

    // Strip surrounding quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }

    entries.push([key, value])
  }

  return entries
}

/**
 * Load env file and set variables in process.env
 * Does not overwrite existing env vars
 *
 * @param filePath - Absolute or relative path to env file
 * @throws ConfigError if file does not exist
 */
export async function loadEnvFile(filePath: string): Promise<void> {
  const file = Bun.file(filePath)
  const exists = await file.exists()

  if (!exists) {
    throw new ConfigError(`找不到 env 檔案：${filePath}`)
  }

  const content = await file.text()
  const entries = parseEnvContent(content)

  for (const [key, value] of entries) {
    // Do not overwrite existing env vars
    if (process.env[key] === undefined) {
      process.env[key] = value
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/unit/core/env-loader.test.ts`
Expected: All 7 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/env-loader.ts tests/unit/core/env-loader.test.ts
git commit -m "feat: [config] 新增 env 檔案載入器"
```

---

## Task 2: V2 Validation Schemas

**Files:**
- Modify: `src/utils/validation.ts`
- Test: `tests/unit/utils/validation.test.ts`

- [ ] **Step 1: Write failing tests for v2 schemas**

Add these tests to the existing `tests/unit/utils/validation.test.ts`:

```typescript
import { NamedConnectionSchema, DbcliConfigV2Schema } from '@/utils/validation'

describe('V2 Config Schemas', () => {
  describe('NamedConnectionSchema', () => {
    test('should validate connection with direct values', () => {
      const result = NamedConnectionSchema.parse({
        system: 'postgresql',
        host: 'localhost',
        port: 5432,
        user: 'dev',
        password: 'secret',
        database: 'myapp',
        permission: 'read-write'
      })

      expect(result.system).toBe('postgresql')
      expect(result.permission).toBe('read-write')
      expect(result.envFile).toBeUndefined()
    })

    test('should validate connection with envFile', () => {
      const result = NamedConnectionSchema.parse({
        system: 'postgresql',
        host: { $env: 'DB_HOST' },
        port: { $env: 'DB_PORT' },
        user: { $env: 'DB_USER' },
        password: { $env: 'DB_PASSWORD' },
        database: { $env: 'DB_NAME' },
        permission: 'query-only',
        envFile: '.env.staging'
      })

      expect(result.envFile).toBe('.env.staging')
    })

    test('should default permission to query-only', () => {
      const result = NamedConnectionSchema.parse({
        system: 'mysql',
        host: 'localhost',
        port: 3306,
        user: 'root',
        password: '',
        database: 'test'
      })

      expect(result.permission).toBe('query-only')
    })
  })

  describe('DbcliConfigV2Schema', () => {
    test('should validate complete v2 config', () => {
      const result = DbcliConfigV2Schema.parse({
        version: 2,
        default: 'local',
        connections: {
          local: {
            system: 'postgresql',
            host: 'localhost',
            port: 5432,
            user: 'dev',
            password: 'secret',
            database: 'myapp',
            permission: 'read-write'
          }
        }
      })

      expect(result.version).toBe(2)
      expect(result.default).toBe('local')
      expect(result.connections.local.system).toBe('postgresql')
    })

    test('should reject config without connections', () => {
      expect(() => DbcliConfigV2Schema.parse({
        version: 2,
        default: 'local'
      })).toThrow()
    })

    test('should reject config with empty connections', () => {
      expect(() => DbcliConfigV2Schema.parse({
        version: 2,
        default: 'local',
        connections: {}
      })).toThrow()
    })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/unit/utils/validation.test.ts`
Expected: FAIL — `NamedConnectionSchema` and `DbcliConfigV2Schema` not exported

- [ ] **Step 3: Add v2 schemas to validation.ts**

Add after the existing `DbcliConfigSchema` (line 83) in `src/utils/validation.ts`:

```typescript
/**
 * Named connection schema (v2 format)
 * Extends ConnectionConfigSchema with per-connection permission and optional envFile
 */
export const NamedConnectionSchema = ConnectionConfigSchema.extend({
  permission: PermissionSchema,
  envFile: z.string().optional()
})

/**
 * V2 config schema with multiple named connections
 */
export const DbcliConfigV2Schema = z.object({
  version: z.literal(2),
  default: z.string().min(1),
  connections: z.record(NamedConnectionSchema).refine(
    (conns) => Object.keys(conns).length > 0,
    { message: 'At least one connection is required' }
  ),
  schema: z.record(z.any()).optional().default({}),
  metadata: MetadataSchema,
  blacklist: BlacklistConfigSchema
})

export type NamedConnection = z.infer<typeof NamedConnectionSchema>
export type DbcliConfigV2 = z.infer<typeof DbcliConfigV2Schema>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/unit/utils/validation.test.ts`
Expected: All tests PASS (both existing and new)

- [ ] **Step 5: Commit**

```bash
git add src/utils/validation.ts tests/unit/utils/validation.test.ts
git commit -m "feat: [config] 新增 V2 多連線 Zod schemas"
```

---

## Task 3: V2 Config Module

**Files:**
- Create: `src/core/config-v2.ts`
- Test: `tests/unit/core/config-v2.test.ts`

- [ ] **Step 1: Write failing tests for config-v2**

```typescript
// tests/unit/core/config-v2.test.ts
import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { detectConfigVersion, readV2Config, writeV2Config, resolveConnection } from '@/core/config-v2'
import { join } from 'path'

const TMP_DIR = '/tmp/dbcli-config-v2-test'

describe('config-v2', () => {
  beforeEach(async () => {
    await Bun.$`mkdir -p ${TMP_DIR}/.dbcli`
  })

  afterEach(async () => {
    await Bun.$`rm -rf ${TMP_DIR}`
  })

  describe('detectConfigVersion', () => {
    test('should return 2 for v2 config', () => {
      expect(detectConfigVersion({
        version: 2,
        default: 'local',
        connections: { local: {} }
      })).toBe(2)
    })

    test('should return 1 for v1 config', () => {
      expect(detectConfigVersion({
        connection: { system: 'postgresql' }
      })).toBe(1)
    })

    test('should return 1 for empty object', () => {
      expect(detectConfigVersion({})).toBe(1)
    })

    test('should return 1 if version is not 2', () => {
      expect(detectConfigVersion({ version: 1, connections: {} })).toBe(1)
    })
  })

  describe('resolveConnection', () => {
    const v2Config = {
      version: 2 as const,
      default: 'local',
      connections: {
        local: {
          system: 'postgresql' as const,
          host: 'localhost',
          port: 5432,
          user: 'dev',
          password: 'secret',
          database: 'myapp',
          permission: 'read-write' as const
        },
        staging: {
          system: 'postgresql' as const,
          host: 'staging.example.com',
          port: 5432,
          user: 'admin',
          password: 'stagingpass',
          database: 'myapp_staging',
          permission: 'query-only' as const,
          envFile: '.env.staging'
        }
      },
      schema: {},
      metadata: { version: '1.0' },
      blacklist: { tables: [], columns: {} }
    }

    test('should resolve default connection when no name given', () => {
      const result = resolveConnection(v2Config, undefined)
      expect(result.name).toBe('local')
      expect(result.connection.host).toBe('localhost')
      expect(result.permission).toBe('read-write')
    })

    test('should resolve named connection', () => {
      const result = resolveConnection(v2Config, 'staging')
      expect(result.name).toBe('staging')
      expect(result.connection.host).toBe('staging.example.com')
      expect(result.permission).toBe('query-only')
      expect(result.envFile).toBe('.env.staging')
    })

    test('should throw for non-existent connection', () => {
      expect(() => resolveConnection(v2Config, 'nonexistent')).toThrow(
        /不存在/
      )
    })
  })

  describe('readV2Config / writeV2Config', () => {
    test('should round-trip a v2 config', async () => {
      const configPath = join(TMP_DIR, '.dbcli')
      const config = {
        version: 2 as const,
        default: 'local',
        connections: {
          local: {
            system: 'postgresql' as const,
            host: 'localhost',
            port: 5432,
            user: 'dev',
            password: 'secret',
            database: 'myapp',
            permission: 'query-only' as const
          }
        },
        schema: {},
        metadata: { version: '1.0' },
        blacklist: { tables: [], columns: {} }
      }

      await writeV2Config(configPath, config)
      const read = await readV2Config(configPath)

      expect(read.version).toBe(2)
      expect(read.default).toBe('local')
      expect(read.connections.local.host).toBe('localhost')
    })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/unit/core/config-v2.test.ts`
Expected: FAIL — module `@/core/config-v2` not found

- [ ] **Step 3: Implement config-v2**

```typescript
// src/core/config-v2.ts
/**
 * V2 config format: multiple named connections
 *
 * Handles detection, reading, writing, and connection resolution for v2 configs.
 * V1 configs are NOT handled here — they continue using the original config.ts logic.
 */

import { DbcliConfigV2, DbcliConfigV2Schema, NamedConnection } from '@/utils/validation'
import { ConfigError } from '@/utils/errors'
import { loadEnvFile } from '@/core/env-loader'
import { join } from 'path'

/**
 * Detect config version from raw parsed JSON
 */
export function detectConfigVersion(raw: unknown): 1 | 2 {
  if (
    typeof raw === 'object' &&
    raw !== null &&
    'version' in raw &&
    (raw as any).version === 2 &&
    'connections' in raw
  ) {
    return 2
  }
  return 1
}

/**
 * Resolved connection result — what commands receive
 */
export interface ResolvedConnection {
  name: string
  connection: {
    system: 'postgresql' | 'mysql' | 'mariadb'
    host: string | { $env: string }
    port: number | { $env: string }
    user: string | { $env: string }
    password: string | { $env: string }
    database: string | { $env: string }
  }
  permission: 'query-only' | 'read-write' | 'data-admin' | 'admin'
  envFile?: string
}

/**
 * Resolve a named connection from v2 config
 *
 * @param config - Validated v2 config
 * @param name - Connection name, or undefined for default
 * @returns ResolvedConnection
 * @throws ConfigError if connection not found
 */
export function resolveConnection(
  config: DbcliConfigV2,
  name: string | undefined
): ResolvedConnection {
  const connectionName = name ?? config.default
  const conn = config.connections[connectionName]

  if (!conn) {
    const available = Object.keys(config.connections).join(', ')
    throw new ConfigError(
      `連線 '${connectionName}' 不存在。可用連線：${available}`
    )
  }

  const { permission, envFile, ...connectionFields } = conn

  return {
    name: connectionName,
    connection: connectionFields,
    permission,
    envFile
  }
}

/**
 * Load env file for a connection if specified
 *
 * @param resolved - Resolved connection with optional envFile
 * @param basePath - Base path for resolving relative env file paths
 */
export async function loadConnectionEnv(
  resolved: ResolvedConnection,
  basePath: string
): Promise<void> {
  if (resolved.envFile) {
    const envPath = join(basePath, '..', resolved.envFile)
    await loadEnvFile(envPath)
  }
}

/**
 * Read and validate a v2 config from disk
 */
export async function readV2Config(path: string): Promise<DbcliConfigV2> {
  const configPath = join(path, 'config.json')
  const file = Bun.file(configPath)

  if (!(await file.exists())) {
    throw new ConfigError(`找不到 V2 設定檔：${configPath}`)
  }

  const content = await file.text()
  const raw = JSON.parse(content)

  return DbcliConfigV2Schema.parse(raw)
}

/**
 * Write a v2 config to disk
 */
export async function writeV2Config(
  path: string,
  config: DbcliConfigV2
): Promise<void> {
  DbcliConfigV2Schema.parse(config)

  const configPath = join(path, 'config.json')
  const json = JSON.stringify(config, null, 2)
  await Bun.file(configPath).write(json)
}

/**
 * List all connection names in a v2 config
 */
export function listConnections(config: DbcliConfigV2): Array<{
  name: string
  system: string
  host: string | { $env: string }
  port: number | { $env: string }
  database: string | { $env: string }
  isDefault: boolean
}> {
  return Object.entries(config.connections).map(([name, conn]) => ({
    name,
    system: conn.system,
    host: conn.host,
    port: conn.port,
    database: conn.database,
    isDefault: name === config.default
  }))
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/unit/core/config-v2.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/config-v2.ts tests/unit/core/config-v2.test.ts
git commit -m "feat: [config] 新增 V2 多連線 config 模組"
```

---

## Task 4: Integrate V2 Detection into Config Module

**Files:**
- Modify: `src/core/config.ts`
- Test: `tests/unit/core/config.test.ts`

- [ ] **Step 1: Write failing tests for v2 integration**

Add these tests to `tests/unit/core/config.test.ts`:

```typescript
import { detectConfigVersion } from '@/core/config-v2'

describe('configModule v2 integration', () => {
  const V2_CONFIG_PATH = '/tmp/test-v2-dbcli'

  beforeEach(async () => {
    await Bun.$`mkdir -p ${V2_CONFIG_PATH}`
  })

  afterEach(async () => {
    await Bun.$`rm -rf ${V2_CONFIG_PATH}`
  })

  test('should read v2 config and return v1-compatible result', async () => {
    const v2Config = {
      version: 2,
      default: 'local',
      connections: {
        local: {
          system: 'postgresql',
          host: 'localhost',
          port: 5432,
          user: 'dev',
          password: 'secret',
          database: 'myapp',
          permission: 'read-write'
        }
      },
      schema: {},
      metadata: { version: '1.0' },
      blacklist: { tables: [], columns: {} }
    }

    await Bun.file(`${V2_CONFIG_PATH}/config.json`).write(JSON.stringify(v2Config, null, 2))

    const result = await configModule.read(V2_CONFIG_PATH)

    // Should return v1-compatible shape with default connection
    expect(result.connection.system).toBe('postgresql')
    expect(result.connection.host).toBe('localhost')
    expect(result.permission).toBe('read-write')
  })

  test('should read v2 config with --use option', async () => {
    const v2Config = {
      version: 2,
      default: 'local',
      connections: {
        local: {
          system: 'postgresql',
          host: 'localhost',
          port: 5432,
          user: 'dev',
          password: 'secret',
          database: 'myapp',
          permission: 'read-write'
        },
        staging: {
          system: 'postgresql',
          host: 'staging.example.com',
          port: 5432,
          user: 'admin',
          password: 'stagingpass',
          database: 'staging_db',
          permission: 'query-only'
        }
      },
      schema: {},
      metadata: { version: '1.0' },
      blacklist: { tables: [], columns: {} }
    }

    await Bun.file(`${V2_CONFIG_PATH}/config.json`).write(JSON.stringify(v2Config, null, 2))

    const result = await configModule.read(V2_CONFIG_PATH, 'staging')

    expect(result.connection.host).toBe('staging.example.com')
    expect(result.permission).toBe('query-only')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/unit/core/config.test.ts`
Expected: FAIL — `configModule.read` does not accept second parameter

- [ ] **Step 3: Update config.ts to integrate v2**

In `src/core/config.ts`, update the `read` method signature and add v2 detection:

Add import at top:
```typescript
import { detectConfigVersion, readV2Config, resolveConnection, loadConnectionEnv } from '@/core/config-v2'
```

Replace the `read` method (lines 133-195) with:

```typescript
  async read(path: string, connectionName?: string): Promise<DbcliConfig> {
    try {
      // Check if path is a directory
      let isDirectory = false
      try {
        const stat = await Bun.file(path).stat()
        isDirectory = stat?.isDirectory() ?? false
      } catch {
        isDirectory = false
      }

      // Try directory mode
      if (isDirectory) {
        const configPath = join(path, 'config.json')
        const configFile = Bun.file(configPath)
        const configExists = await configFile.exists()

        if (configExists) {
          const content = await configFile.text()
          const raw = JSON.parse(content)

          // Detect v2 format
          if (detectConfigVersion(raw) === 2) {
            const v2Config = readV2Config_fromRaw(raw)
            const resolved = resolveConnection(v2Config, connectionName)

            // Load env file for the connection
            await loadConnectionEnv(resolved, configPath)

            // Resolve $env references after loading env file
            const resolvedConnection = resolveEnvReferences(resolved.connection, process.env, undefined, false)

            // Return v1-compatible shape
            return DbcliConfigSchema.parse({
              connection: resolvedConnection,
              permission: resolved.permission,
              schema: v2Config.schema,
              metadata: v2Config.metadata,
              blacklist: v2Config.blacklist
            })
          }

          // V1 directory mode (existing logic)
          const resolvedConfig = resolveEnvReferences(raw, process.env, undefined, false)

          const envPath = join(path, '.env.local')
          const envFile = Bun.file(envPath)
          if (await envFile.exists()) {
            const envContent = await envFile.text()
            const password = parseEnvPassword(envContent)
            if (password && !resolvedConfig.connection.password) {
              resolvedConfig.connection.password = password
            }
          }

          return DbcliConfigSchema.parse(resolvedConfig)
        }
      }

      // Try legacy file mode (backward compatible)
      const file = Bun.file(path)
      const exists = await file.exists()

      if (exists) {
        const content = await file.text()
        const raw = JSON.parse(content)
        const resolved = resolveEnvReferences(raw, process.env, undefined, false)
        return DbcliConfigSchema.parse(resolved)
      }

      // Neither exists, return default config
      return { ...DEFAULT_CONFIG }
    } catch (error) {
      if (error instanceof ConfigError) throw error
      if (error instanceof Error && error.message.includes('JSON')) {
        throw new ConfigError(`Failed to parse .dbcli file: ${error.message}`)
      }
      throw new ConfigError(
        `Failed to read .dbcli config: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  },
```

Add helper function before `configModule`:

```typescript
/**
 * Parse raw JSON into validated V2 config (without reading from disk)
 */
function readV2Config_fromRaw(raw: unknown): import('@/utils/validation').DbcliConfigV2 {
  const { DbcliConfigV2Schema } = require('@/utils/validation')
  return DbcliConfigV2Schema.parse(raw)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/unit/core/config.test.ts`
Expected: All tests PASS (both existing and new)

- [ ] **Step 5: Commit**

```bash
git add src/core/config.ts tests/unit/core/config.test.ts
git commit -m "feat: [config] 整合 V2 格式偵測至 config 模組"
```

---

## Task 5: Global `--use` Option

**Files:**
- Modify: `src/cli.ts`

- [ ] **Step 1: Add global `--use` option to cli.ts**

In `src/cli.ts`, add the `--use` option after the existing `--config` option (line 36):

```typescript
  .option('--use <connection>', 'Use a specific named connection (v2 config)')
```

- [ ] **Step 2: Verify existing tests still pass**

Run: `bun test tests/integration/cli.test.ts`
Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
git add src/cli.ts
git commit -m "feat: [cli] 新增全域 --use 選項"
```

---

## Task 6: Use Command

**Files:**
- Create: `src/commands/use.ts`
- Test: `tests/unit/commands/use.test.ts`
- Modify: `src/cli.ts` (register command)

- [ ] **Step 1: Write failing tests for use command**

```typescript
// tests/unit/commands/use.test.ts
import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { switchDefault, listConnectionsForDisplay } from '@/commands/use'
import { join } from 'path'

const TMP_DIR = '/tmp/dbcli-use-test'
const CONFIG_DIR = join(TMP_DIR, '.dbcli')

const baseV2Config = {
  version: 2,
  default: 'local',
  connections: {
    local: {
      system: 'postgresql',
      host: 'localhost',
      port: 5432,
      user: 'dev',
      password: 'secret',
      database: 'myapp',
      permission: 'read-write'
    },
    staging: {
      system: 'postgresql',
      host: 'staging.example.com',
      port: 5432,
      user: 'admin',
      password: 'stagingpass',
      database: 'staging_db',
      permission: 'query-only'
    }
  },
  schema: {},
  metadata: { version: '1.0' },
  blacklist: { tables: [], columns: {} }
}

describe('use command', () => {
  beforeEach(async () => {
    await Bun.$`mkdir -p ${CONFIG_DIR}`
    await Bun.file(join(CONFIG_DIR, 'config.json')).write(JSON.stringify(baseV2Config, null, 2))
  })

  afterEach(async () => {
    await Bun.$`rm -rf ${TMP_DIR}`
  })

  describe('switchDefault', () => {
    test('should switch default connection', async () => {
      await switchDefault(CONFIG_DIR, 'staging')

      const updated = JSON.parse(await Bun.file(join(CONFIG_DIR, 'config.json')).text())
      expect(updated.default).toBe('staging')
    })

    test('should throw for non-existent connection', async () => {
      expect(switchDefault(CONFIG_DIR, 'nonexistent')).rejects.toThrow(/不存在/)
    })
  })

  describe('listConnectionsForDisplay', () => {
    test('should list all connections with default marker', () => {
      const lines = listConnectionsForDisplay(baseV2Config)

      expect(lines).toHaveLength(2)
      expect(lines[0]).toContain('*')
      expect(lines[0]).toContain('local')
      expect(lines[1]).not.toContain('*')
      expect(lines[1]).toContain('staging')
    })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/unit/commands/use.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement use command**

```typescript
// src/commands/use.ts
/**
 * dbcli use command — switch or list named connections (v2 config)
 */

import { Command } from 'commander'
import { t_vars } from '@/i18n/message-loader'
import { readV2Config, writeV2Config } from '@/core/config-v2'
import type { DbcliConfigV2 } from '@/utils/validation'
import { ConfigError } from '@/utils/errors'
import { join } from 'path'

/**
 * Switch the default connection in v2 config
 */
export async function switchDefault(
  configPath: string,
  name: string
): Promise<void> {
  const config = await readV2Config(configPath)

  if (!config.connections[name]) {
    const available = Object.keys(config.connections).join(', ')
    throw new ConfigError(
      `連線 '${name}' 不存在。可用連線：${available}`
    )
  }

  const updated: DbcliConfigV2 = {
    ...config,
    default: name
  }

  await writeV2Config(configPath, updated)
}

/**
 * Format connections for display
 */
export function listConnectionsForDisplay(config: DbcliConfigV2): string[] {
  return Object.entries(config.connections).map(([name, conn]) => {
    const marker = name === config.default ? '*' : ' '
    const host = typeof conn.host === 'object' ? `\${${conn.host.$env}}` : conn.host
    const port = typeof conn.port === 'object' ? `\${${conn.port.$env}}` : conn.port
    const db = typeof conn.database === 'object' ? `\${${conn.database.$env}}` : conn.database

    return `${marker} ${name.padEnd(12)} ${conn.system.padEnd(12)} ${host}:${port}/${db}`
  })
}

/**
 * Check if config is v1 (not v2) and throw helpful error
 */
async function ensureV2Config(configPath: string): Promise<DbcliConfigV2> {
  const configFile = Bun.file(join(configPath, 'config.json'))
  if (!(await configFile.exists())) {
    throw new ConfigError('找不到設定檔。請先執行 dbcli init')
  }

  const raw = JSON.parse(await configFile.text())

  if (!raw.version || raw.version !== 2 || !raw.connections) {
    throw new ConfigError(
      '此功能需要新格式設定。請使用 dbcli init --name <名稱> 建立多連線設定'
    )
  }

  return readV2Config(configPath)
}

export const useCommand = new Command('use')
  .description('Switch or display the default database connection (v2 config)')
  .argument('[name]', 'Connection name to switch to')
  .option('--list', 'List all connections')
  .action(async (name: string | undefined, options: any) => {
    try {
      const configPath = useCommand.parent?.opts().config ?? '.dbcli'

      if (options.list || !name) {
        const config = await ensureV2Config(configPath)
        const lines = listConnectionsForDisplay(config)

        if (!name) {
          console.log(`目前預設連線：${config.default}`)
        }

        if (options.list || !name) {
          console.log('')
          for (const line of lines) {
            console.log(line)
          }
        }
        return
      }

      // Switch default
      await ensureV2Config(configPath) // Validate v2 format
      await switchDefault(configPath, name)
      console.log(`已切換預設連線為 ${name}`)
    } catch (error) {
      if (error instanceof Error) {
        console.error(error.message)
      } else {
        console.error(String(error))
      }
      process.exit(1)
    }
  })
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/unit/commands/use.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Register use command in cli.ts**

In `src/cli.ts`, add import:
```typescript
import { useCommand } from './commands/use'
```

Add after the `program.addCommand(migrateCommand)` line (line 216):
```typescript
program.addCommand(useCommand)
```

- [ ] **Step 6: Commit**

```bash
git add src/commands/use.ts tests/unit/commands/use.test.ts src/cli.ts
git commit -m "feat: [cli] 新增 use 指令切換預設連線"
```

---

## Task 7: Update Init Command for Multi-Connection

**Files:**
- Modify: `src/commands/init.ts`

- [ ] **Step 1: Add new options to init command**

In `src/commands/init.ts`, add these options after the existing `.option('--force', ...)` (line 71):

```typescript
  .option('--conn-name <name>', 'Connection name (creates v2 multi-connection config)')
  .option('--env-file <path>', 'Path to env file for this connection')
  .option('--remove <name>', 'Remove a named connection')
  .option('--rename <old> <new>', 'Rename a connection')
```

Note: We use `--conn-name` instead of `--name` because `--name` is already used for "Database name". This avoids a breaking change.

- [ ] **Step 2: Add remove handler**

Add this function after `checkOverwrite` in `src/commands/init.ts`:

```typescript
import { readV2Config, writeV2Config, detectConfigVersion } from '@/core/config-v2'
import type { DbcliConfigV2 } from '@/utils/validation'
import { join } from 'path'

async function handleRemove(configPath: string, name: string): Promise<void> {
  const configFile = Bun.file(join(configPath, 'config.json'))
  if (!(await configFile.exists())) {
    throw new Error('找不到設定檔')
  }

  const raw = JSON.parse(await configFile.text())
  if (detectConfigVersion(raw) !== 2) {
    throw new Error('移除連線需要 V2 格式設定')
  }

  const config = await readV2Config(configPath)
  if (!config.connections[name]) {
    throw new Error(`連線 '${name}' 不存在`)
  }

  const connectionCount = Object.keys(config.connections).length
  if (connectionCount <= 1) {
    throw new Error('無法移除最後一個連線')
  }

  const { [name]: _removed, ...remaining } = config.connections
  const newDefault = config.default === name
    ? Object.keys(remaining)[0]
    : config.default

  const updated: DbcliConfigV2 = {
    ...config,
    default: newDefault,
    connections: remaining
  }

  await writeV2Config(configPath, updated)

  if (config.default === name) {
    console.log(`已移除連線 '${name}'，預設連線已切換為 '${newDefault}'`)
  } else {
    console.log(`已移除連線 '${name}'`)
  }
}

async function handleRename(configPath: string, oldName: string, newName: string): Promise<void> {
  const configFile = Bun.file(join(configPath, 'config.json'))
  if (!(await configFile.exists())) {
    throw new Error('找不到設定檔')
  }

  const raw = JSON.parse(await configFile.text())
  if (detectConfigVersion(raw) !== 2) {
    throw new Error('重新命名連線需要 V2 格式設定')
  }

  const config = await readV2Config(configPath)
  if (!config.connections[oldName]) {
    throw new Error(`連線 '${oldName}' 不存在`)
  }
  if (config.connections[newName]) {
    throw new Error(`連線 '${newName}' 已存在`)
  }

  const entries = Object.entries(config.connections).map(
    ([key, value]) => [key === oldName ? newName : key, value] as const
  )

  const updated: DbcliConfigV2 = {
    ...config,
    default: config.default === oldName ? newName : config.default,
    connections: Object.fromEntries(entries)
  }

  await writeV2Config(configPath, updated)
  console.log(`已將連線 '${oldName}' 重新命名為 '${newName}'`)
}
```

- [ ] **Step 3: Update initCommandHandler for v2 flow**

At the start of `initCommandHandler`, add handling for `--remove` and `--rename`:

```typescript
async function initCommandHandler(
  options: Record<string, unknown>
): Promise<void> {
  const configPath = '.dbcli'

  // Handle --remove
  if (options.remove) {
    await handleRemove(configPath, options.remove as string)
    return
  }

  // Handle --rename
  if (options.rename) {
    // Commander passes --rename as the first value; the second value comes as the next arg
    // We need to handle this as: --rename <old> requires a positional for <new>
    // For simplicity, use format: --rename old:new
    const [oldName, newName] = (options.rename as string).split(':')
    if (!oldName || !newName) {
      throw new Error('用法：--rename <舊名稱>:<新名稱>')
    }
    await handleRename(configPath, oldName, newName)
    return
  }

  // Determine if this is a v2 init (--conn-name or --env-file used)
  const isV2Init = !!(options.connName || options.envFile)
  const connectionName = (options.connName as string) || 'default'

  // ... rest of existing init logic ...
```

Then at the config write section (end of handler), add v2 path:

```typescript
  // Before the final write, if v2 init:
  if (isV2Init) {
    await writeV2InitConfig(configPath, connectionName, configForWrite, permission as string, options.envFile as string | undefined)
    return
  }

  // Existing v1 write logic continues unchanged...
```

Add the v2 write helper:

```typescript
async function writeV2InitConfig(
  configPath: string,
  connectionName: string,
  connection: ConnectionConfig,
  permission: string,
  envFile?: string
): Promise<void> {
  const configJsonPath = join(configPath, 'config.json')
  const configFile = Bun.file(configJsonPath)
  let existingV2: DbcliConfigV2 | null = null

  // Check for existing v2 config
  if (await configFile.exists()) {
    const raw = JSON.parse(await configFile.text())
    if (detectConfigVersion(raw) === 2) {
      existingV2 = await readV2Config(configPath)
    } else {
      // Existing v1 config — offer to migrate
      const shouldMigrate = await promptUser.confirm(
        '偵測到舊格式設定，將建立新格式並將現有連線匯入為 \'default\'，是否繼續？'
      )
      if (!shouldMigrate) {
        console.log(t('init.cancelled'))
        return
      }

      // Import v1 as 'default' connection
      const v1Config = await configModule.read(configPath)
      existingV2 = {
        version: 2,
        default: 'default',
        connections: {
          default: {
            ...v1Config.connection,
            permission: v1Config.permission
          }
        },
        schema: v1Config.schema,
        metadata: v1Config.metadata,
        blacklist: v1Config.blacklist
      }
    }
  }

  // Build connection entry
  const connEntry: any = {
    ...connection,
    permission: permission as 'query-only' | 'read-write' | 'data-admin' | 'admin'
  }
  if (envFile) {
    connEntry.envFile = envFile
  }

  // Build v2 config
  const v2Config: DbcliConfigV2 = existingV2
    ? {
        ...existingV2,
        connections: {
          ...existingV2.connections,
          [connectionName]: connEntry
        }
      }
    : {
        version: 2,
        default: connectionName,
        connections: {
          [connectionName]: connEntry
        },
        schema: {},
        metadata: { version: '1.0', createdAt: new Date().toISOString() },
        blacklist: { tables: [], columns: {} }
      }

  // Ensure directory exists
  await Bun.$`mkdir -p ${configPath}`

  await writeV2Config(configPath, v2Config)
  console.log(t('init.config_saved'))
}
```

- [ ] **Step 4: Run existing init tests**

Run: `bun test tests/integration/init-command.test.ts`
Expected: All existing tests PASS (v1 flow unchanged)

- [ ] **Step 5: Commit**

```bash
git add src/commands/init.ts
git commit -m "feat: [init] 支援 --conn-name / --env-file / --remove / --rename 多連線選項"
```

---

## Task 8: Update i18n Messages

**Files:**
- Modify: `resources/lang/en/messages.json`
- Modify: `resources/lang/zh-TW/messages.json`

- [ ] **Step 1: Add English messages**

Add to `resources/lang/en/messages.json` inside the `"init"` section:

```json
"connection_added": "Connection '{{name}}' added",
"connection_removed": "Connection '{{name}}' removed",
"connection_renamed": "Connection '{{oldName}}' renamed to '{{newName}}'",
"v1_migration_prompt": "Detected old config format. Create new format and import existing connection as 'default'?",
"config_saved_v2": "V2 configuration saved to .dbcli"
```

Add new `"use"` section:

```json
"use": {
  "description": "Switch or display the default database connection",
  "switched": "Switched default connection to {{name}}",
  "current": "Current default connection: {{name}}",
  "requires_v2": "This feature requires v2 config format. Use 'dbcli init --conn-name <name>' to create one"
}
```

- [ ] **Step 2: Add zh-TW messages**

Add matching keys to `resources/lang/zh-TW/messages.json`.

- [ ] **Step 3: Commit**

```bash
git add resources/lang/en/messages.json resources/lang/zh-TW/messages.json
git commit -m "docs: [i18n] 新增多連線相關訊息翻譯"
```

---

## Task 9: Doctor Command V2 Checks

**Files:**
- Modify: `src/commands/doctor.ts`

- [ ] **Step 1: Add v2-specific checks**

Add these check functions to `doctor.ts`:

```typescript
async checkEnvFiles(configPath: string): Promise<DoctorResult[]> {
  const results: DoctorResult[] = []
  const configFile = Bun.file(join(configPath, 'config.json'))

  if (!(await configFile.exists())) return results

  const raw = JSON.parse(await configFile.text())
  if (detectConfigVersion(raw) !== 2) return results

  const config = DbcliConfigV2Schema.parse(raw)

  // Check default points to existing connection
  if (!config.connections[config.default]) {
    results.push({
      group: 'Configuration',
      label: 'Default connection',
      status: 'error',
      message: `預設連線 '${config.default}' 不存在於 connections 中`
    })
  }

  // Check envFile existence for each connection
  for (const [name, conn] of Object.entries(config.connections)) {
    if (conn.envFile) {
      const envPath = join(configPath, '..', conn.envFile)
      const exists = await Bun.file(envPath).exists()
      results.push({
        group: 'Configuration',
        label: `Env file (${name})`,
        status: exists ? 'pass' : 'warn',
        message: exists
          ? `${conn.envFile} exists`
          : `${conn.envFile} not found for connection '${name}'`
      })
    }
  }

  return results
}
```

- [ ] **Step 2: Wire the check into the main doctor flow**

In the doctor command's main action, after the existing config checks, add:

```typescript
// V2-specific checks
const v2Results = await runDoctorChecks.checkEnvFiles(configPath)
results.push(...v2Results)
```

- [ ] **Step 3: Run doctor tests**

Run: `bun test tests/unit/commands/doctor.test.ts`
Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
git add src/commands/doctor.ts
git commit -m "feat: [doctor] 新增 V2 多連線健康檢查"
```

---

## Task 10: Integration Test

**Files:**
- Create: `tests/integration/multi-connection.test.ts`

- [ ] **Step 1: Write integration test**

```typescript
// tests/integration/multi-connection.test.ts
import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { join } from 'path'

const TMP_DIR = '/tmp/dbcli-multi-conn-integration'
const CLI = 'bun run src/cli.ts'

describe('multi-connection integration', () => {
  beforeEach(async () => {
    await Bun.$`mkdir -p ${TMP_DIR}/.dbcli`
  })

  afterEach(async () => {
    await Bun.$`rm -rf ${TMP_DIR}`
  })

  test('init with --conn-name creates v2 config', async () => {
    const result = await Bun.$`cd ${TMP_DIR} && ${CLI} init --conn-name local --system postgresql --host localhost --port 5432 --user test --password test --name testdb --skip-test --no-interactive --force`.text()

    const config = JSON.parse(await Bun.file(join(TMP_DIR, '.dbcli', 'config.json')).text())
    expect(config.version).toBe(2)
    expect(config.default).toBe('local')
    expect(config.connections.local).toBeDefined()
    expect(config.connections.local.system).toBe('postgresql')
  })

  test('use command switches default', async () => {
    // Create v2 config with two connections
    const v2Config = {
      version: 2,
      default: 'local',
      connections: {
        local: {
          system: 'postgresql',
          host: 'localhost',
          port: 5432,
          user: 'dev',
          password: 'secret',
          database: 'myapp',
          permission: 'read-write'
        },
        staging: {
          system: 'postgresql',
          host: 'staging.example.com',
          port: 5432,
          user: 'admin',
          password: 'pass',
          database: 'staging_db',
          permission: 'query-only'
        }
      },
      schema: {},
      metadata: { version: '1.0' },
      blacklist: { tables: [], columns: {} }
    }
    await Bun.file(join(TMP_DIR, '.dbcli', 'config.json')).write(JSON.stringify(v2Config, null, 2))

    await Bun.$`cd ${TMP_DIR} && ${CLI} use staging --config .dbcli`

    const updated = JSON.parse(await Bun.file(join(TMP_DIR, '.dbcli', 'config.json')).text())
    expect(updated.default).toBe('staging')
  })

  test('use --list shows all connections', async () => {
    const v2Config = {
      version: 2,
      default: 'local',
      connections: {
        local: {
          system: 'postgresql',
          host: 'localhost',
          port: 5432,
          user: 'dev',
          password: 'secret',
          database: 'myapp',
          permission: 'read-write'
        }
      },
      schema: {},
      metadata: { version: '1.0' },
      blacklist: { tables: [], columns: {} }
    }
    await Bun.file(join(TMP_DIR, '.dbcli', 'config.json')).write(JSON.stringify(v2Config, null, 2))

    const output = await Bun.$`cd ${TMP_DIR} && ${CLI} use --list --config .dbcli`.text()
    expect(output).toContain('local')
    expect(output).toContain('postgresql')
  })
})
```

- [ ] **Step 2: Run integration test**

Run: `bun test tests/integration/multi-connection.test.ts`
Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
git add tests/integration/multi-connection.test.ts
git commit -m "test: [multi-connection] 新增多連線整合測試"
```

---

## Task 11: Full Test Suite Verification

- [ ] **Step 1: Run all unit tests**

Run: `bun test tests/unit/`
Expected: All tests PASS

- [ ] **Step 2: Run all integration tests**

Run: `bun test tests/integration/`
Expected: All tests PASS (some may skip if no DB available)

- [ ] **Step 3: Fix any regressions**

If any existing tests fail, fix them without changing the test expectations (fix the implementation).

- [ ] **Step 4: Final commit**

```bash
git commit -m "test: 確認全部測試通過" --allow-empty
```
