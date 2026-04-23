/**
 * Immutable config read/write/merge module
 *
 * Provides atomic operations using copy-on-write semantics.
 * All operations return new objects and never mutate input.
 *
 * Supports two configuration modes:
 * 1. Project binding mode (recommended): .dbcli/config.json is a stub that points to
 *    ~/.config/dbcli/projects/<id>/config.json, keeping secrets out of the workspace
 * 2. File mode (legacy): .dbcli (single JSON file)
 */

import { type DbcliConfig, DbcliConfigSchema, DbcliConfigV2Schema } from '@/utils/validation'
import { ConfigError } from '@/utils/errors'
import { detectConfigVersion, resolveConnection, loadConnectionEnv } from '@/core/config-v2'
import { readProjectBinding, resolveConfigStoragePath } from '@/core/config-binding'
import { join } from 'path'

/**
 * 全域 --use 連線名稱，由 CLI preAction hook 設定
 * 所有呼叫 configModule.read() 的指令都能自動繼承此值
 */
let _globalConnectionName: string | undefined

/**
 * 設定全域連線名稱（由 cli.ts preAction hook 呼叫）
 */
export function setGlobalConnectionName(name: string | undefined): void {
  _globalConnectionName = name
}

/**
 * 取得目前全域連線名稱（主要供測試使用）
 */
export function getGlobalConnectionName(): string | undefined {
  return _globalConnectionName
}

/**
 * Resolved V2 connection name for schema directory isolation (e.g. `.dbcli/schemas/<name>/`).
 * Returns undefined for V1 config or legacy file-mode path so callers use `.dbcli/schemas/`.
 */
export async function getSchemaIsolationConnectionName(
  dbcliPath: string
): Promise<string | undefined> {
  const effectiveName = getGlobalConnectionName()
  try {
    const storagePath = await resolveConfigStoragePath(dbcliPath)
    const stat = await Bun.file(storagePath).stat()
    const isDirectory = stat?.isDirectory() ?? false
    if (!isDirectory) return undefined

    const configJsonPath = join(storagePath, 'config.json')
    const configFile = Bun.file(configJsonPath)
    if (!(await configFile.exists())) return undefined

    const raw: unknown = JSON.parse(await configFile.text())
    if (detectConfigVersion(raw) !== 2) return undefined

    const v2Config = DbcliConfigV2Schema.parse(raw)
    return resolveConnection(v2Config, effectiveName).name
  } catch {
    return undefined
  }
}

/**
 * Default configuration values
 */
const DEFAULT_CONFIG: DbcliConfig = {
  connection: {
    system: 'postgresql',
    host: 'localhost',
    port: 5432,
    user: '',
    password: '',
    database: '',
  },
  permission: 'query-only',
  schema: {},
  metadata: {
    version: '1.0',
  },
  blacklist: { tables: [], columns: {} },
}

/**
 * Environment variable reference interface
 * Supports { "$env": "ENV_VAR_NAME" } reference syntax
 */
interface EnvReference {
  $env: string
}

/**
 * Check if a value is an environment variable reference
 */
function isEnvReference(value: unknown): value is EnvReference {
  return (
    typeof value === 'object' &&
    value !== null &&
    '$env' in value &&
    typeof (value as EnvReference).$env === 'string'
  )
}

/**
 * Recursively resolve and replace environment variable references in config
 * Supports nested objects and arrays
 * Automatically converts types (port should be a number)
 *
 * @param config - Config object to resolve
 * @param env - Environment variable object (usually process.env)
 * @param parentKey - Key name of the parent object (used for type inference)
 * @param strict - If true, throw on missing env vars; if false, preserve the reference
 * @returns Resolved config
 * @throws ConfigError if an environment variable is not found in strict mode
 */
function resolveEnvReferences(
  config: any,
  env: Record<string, string | undefined>,
  parentKey?: string,
  strict: boolean = false
): any {
  if (isEnvReference(config)) {
    const envKey = config.$env
    const value = env[envKey]
    if (!value) {
      // In non-strict mode, preserve the env var reference instead of throwing
      if (!strict) {
        return config
      }
      throw new ConfigError(
        `Environment variable not defined: ${envKey}\n` +
          `Please set ${envKey} in .env or your environment.\n` +
          `Hint: check your .env file or run 'export ${envKey}=<value>'`
      )
    }

    // Type conversion based on key name
    if (parentKey === 'port') {
      const portNum = parseInt(value, 10)
      if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
        throw new ConfigError(`${envKey} must be a valid port number (1-65535), got: ${value}`)
      }
      return portNum
    }

    return value
  }

  if (Array.isArray(config)) {
    return config.map((item) => resolveEnvReferences(item, env, parentKey, strict))
  }

  if (typeof config === 'object' && config !== null) {
    const resolved: any = {}
    for (const [key, value] of Object.entries(config)) {
      resolved[key] = resolveEnvReferences(value, env, key, strict)
    }
    return resolved
  }

  return config
}

/**
 * Extract password from a .env format file
 */
function parseEnvPassword(content: string): string | null {
  const match = content.match(/^DBCLI_PASSWORD=(.+)$/m)
  return match?.[1] != null ? match[1].trim() : null
}

/**
 * Config module: read, validate, merge, write
 */
export const configModule = {
  /**
   * Read config (supports both directory and file modes)
   * 1. If path is a directory: reads .dbcli/config.json and .dbcli/.env.local
   * 2. If path is a file: reads legacy single-file .dbcli (backward compatible)
   * Returns default config if neither exists
   *
   * @param path - Path to .dbcli directory or file
   * @returns DbcliConfig
   * @throws ConfigError if JSON is invalid or validation fails
   */
  async read(path: string, connectionName?: string): Promise<DbcliConfig> {
    // 優先使用明確傳入的 connectionName，fallback 到全域 --use 值
    const effectiveConnectionName = connectionName ?? _globalConnectionName

    try {
      const binding = await readProjectBinding(path)
      const storagePath = await resolveConfigStoragePath(path)

      if (binding) {
        const storageConfigExists = await Bun.file(join(storagePath, 'config.json')).exists()
        if (!storageConfigExists) {
          throw new ConfigError(`Bound dbcli config not found: ${join(storagePath, 'config.json')}`)
        }
      }

      // Check if path is a directory
      let isDirectory = false
      try {
        const stat = await Bun.file(storagePath).stat()
        isDirectory = stat?.isDirectory() ?? false
      } catch {
        isDirectory = false
      }

      // Try directory mode (new)
      if (isDirectory) {
        const configPath = join(storagePath, 'config.json')
        const configFile = Bun.file(configPath)
        const configExists = await configFile.exists()

        if (configExists) {
          const content = await configFile.text()
          const config = JSON.parse(content)

          // V2 detection: handle multi-connection format
          if (detectConfigVersion(config) === 2) {
            const v2Config = DbcliConfigV2Schema.parse(config)
            const resolved = resolveConnection(v2Config, effectiveConnectionName)

            // Load env file for the connection
            await loadConnectionEnv(resolved, storagePath)

            // Legacy .env.local fallback for backward compatibility
            // Ensures connections without envFile can still read passwords from .env.local
            const envLocalPath = join(storagePath, '.env.local')
            const envLocalFile = Bun.file(envLocalPath)
            let legacyPassword: string | null = null
            if (await envLocalFile.exists()) {
              const envContent = await envLocalFile.text()
              legacyPassword = parseEnvPassword(envContent)
              if (legacyPassword && !process.env.DBCLI_PASSWORD) {
                process.env.DBCLI_PASSWORD = legacyPassword
              }
            }

            // Resolve $env references after loading env files
            const resolvedConnection = resolveEnvReferences(
              resolved.connection,
              process.env,
              undefined,
              false
            )

            // Apply legacy password if connection password is still empty
            if (!resolvedConnection.password && legacyPassword) {
              resolvedConnection.password = legacyPassword
            }

            // Load schema from layered cache if it exists (Wave 1 integration)
            let schema = (v2Config.schemas ?? {})[resolved.name] ?? v2Config.schema
            try {
              const { SchemaLayeredLoader } = await import('./schema-loader')
              const loader = new SchemaLayeredLoader(storagePath, { connectionName: resolved.name })
              const { cache, index } = await loader.initialize()

              if (index && Object.keys(index.tables).length > 0) {
                // If layered cache exists, we use it.
                // For simplicity in this wave, we load all tables into the returned config object
                // to maintain compatibility with existing commands.
                const layeredSchema: Record<string, any> = {}
                for (const tableName of Object.keys(index.tables)) {
                  const s = await cache.getTableSchema(tableName)
                  if (s) layeredSchema[tableName] = s
                }
                if (Object.keys(layeredSchema).length > 0) {
                  schema = layeredSchema
                }
              }
            } catch (error) {
              // Graceful fallback to config.json schema
              console.warn(
                'Warning: Failed to load layered schema cache, falling back to config.json'
              )
            }

            // Return v1-compatible shape
            return DbcliConfigSchema.parse({
              connection: resolvedConnection,
              permission: resolved.permission,
              schema,
              metadata: v2Config.metadata,
              blacklist: v2Config.blacklist,
            })
          }

          // Use non-strict mode when reading config, preserving missing env var references
          // This prevents errors even when env vars are not defined
          const resolvedConfig = resolveEnvReferences(config, process.env, undefined, false)

          // Try reading sensitive info from .env.local (legacy approach, for backward compatibility)
          const envPath = join(storagePath, '.env.local')
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
        // Use non-strict mode when reading config, preserving missing env var references
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

  /**
   * Validate raw data against the DbcliConfig schema
   *
   * @param raw - Raw data to validate
   * @returns DbcliConfig validated config
   * @throws ConfigError if validation fails
   */
  validate(raw: unknown): DbcliConfig {
    try {
      return DbcliConfigSchema.parse(raw)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      throw new ConfigError(`Invalid .dbcli config structure: ${errorMessage}`)
    }
  },

  /**
   * Merge two config objects with immutable semantics
   *
   * Characteristics:
   * - Returns a new object (never mutates input)
   * - Deep merges nested objects (connection, metadata, schema)
   * - Preserves existing metadata.createdAt
   * - Sets current timestamp if createdAt is absent
   *
   * @param existing - Existing config
   * @param updates - Updates to apply (partial config)
   * @returns DbcliConfig new merged config
   */
  merge(existing: DbcliConfig, updates: Partial<DbcliConfig>): DbcliConfig {
    const mergedConfig: DbcliConfig = {
      ...existing,
      ...updates,
      connection: {
        ...existing.connection,
        ...(updates.connection || {}),
      },
      schema: {
        ...existing.schema,
        ...(updates.schema || {}),
      },
      metadata: {
        ...existing.metadata,
        ...(updates.metadata || {}),
        // Preserve original createdAt, set new value if absent
        createdAt: existing.metadata?.createdAt || new Date().toISOString(),
        version: existing.metadata?.version || '1.0',
      },
    }

    return mergedConfig
  },

  /**
   * Write config to .dbcli (supports directory and file modes)
   *
   * Directory mode (.dbcli/):
   * - config.json: main config (without password)
   * - .env.local: sensitive info (password)
   *
   * File mode (.dbcli):
   * - Single JSON file (legacy, backward compatible)
   *
   * Characteristics:
   * - Validate before write (fail fast)
   * - JSON formatted with 2-space indentation
   * - Uses Bun.file for writing
   *
   * @param path - Path to .dbcli directory or file
   * @param config - Config to write
   * @throws ConfigError if validation or write fails
   */
  async write(path: string, config: DbcliConfig): Promise<void> {
    try {
      // Validate first to ensure we never write invalid config
      this.validate(config)

      const storagePath = await resolveConfigStoragePath(path)
      let isDirectory = false
      try {
        const stat = await Bun.file(storagePath).stat()
        isDirectory = stat?.isDirectory() ?? false
      } catch {
        isDirectory = false
      }

      // Directory mode: separate config and .env.local
      if (isDirectory || path.endsWith('.dbcli') || (path === storagePath && isDirectory)) {
        await Bun.$`mkdir -p ${storagePath}`

        // Check if using env var references (password is a { "$env": "..." } object)
        const hasEnvReferences = isEnvReference((config.connection as any).password)

        if (hasEnvReferences) {
          // New approach: using env var references, write directly to config.json
          const configPath = join(storagePath, 'config.json')
          const configJson = JSON.stringify(config, null, 2)
          await Bun.file(configPath).write(configJson)
        } else {
          // Legacy approach: password separated into .env.local
          const password = config.connection.password
          const configWithoutPassword = {
            ...config,
            connection: {
              ...config.connection,
              password: undefined,
            },
          }
          delete (configWithoutPassword.connection as any).password

          // Write config.json (without password)
          const configPath = join(storagePath, 'config.json')
          const configJson = JSON.stringify(configWithoutPassword, null, 2)
          await Bun.file(configPath).write(configJson)

          // Write .env.local (password)
          if (password) {
            const envPath = join(storagePath, '.env.local')
            const envContent = `# Database Credentials - DO NOT commit to git\n\nDBCLI_PASSWORD=${password}\n`
            await Bun.file(envPath).write(envContent)
          }
        }
      } else {
        // Legacy file mode (backward compatible)
        const json = JSON.stringify(config, null, 2)
        await Bun.file(path).write(json)
      }
    } catch (error) {
      if (error instanceof ConfigError) {
        throw error
      }
      throw new ConfigError(
        `Failed to write .dbcli config: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  },
}
