/**
 * Immutable config read/write/merge module
 *
 * Provides atomic operations using copy-on-write semantics.
 * All operations return new objects and never mutate input.
 *
 * Supports two configuration modes:
 * 1. Directory mode (recommended): .dbcli/ (config.json + .env.local)
 * 2. File mode (legacy): .dbcli (single JSON file)
 */

import { DbcliConfig, DbcliConfigSchema } from '@/utils/validation'
import { ConfigError } from '@/utils/errors'
import { readFileSync } from 'fs'
import { join } from 'path'

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
    database: ''
  },
  permission: 'query-only',
  schema: {},
  metadata: {
    version: '1.0'
  }
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
function resolveEnvReferences(config: any, env: Record<string, string>, parentKey?: string, strict: boolean = false): any {
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
    return config.map(item => resolveEnvReferences(item, env, parentKey, strict))
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
  return match ? match[1].trim() : null
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
  async read(path: string): Promise<DbcliConfig> {
    try {
      // Check if path is a directory
      let isDirectory = false
      try {
        const stat = await Bun.file(path).stat()
        isDirectory = stat?.isDirectory() ?? false
      } catch {
        isDirectory = false
      }

      // Try directory mode (new)
      if (isDirectory) {
        const configPath = join(path, 'config.json')
        const configFile = Bun.file(configPath)
        const configExists = await configFile.exists()

        if (configExists) {
          const content = await configFile.text()
          const config = JSON.parse(content)

          // Use non-strict mode when reading config, preserving missing env var references
          // This prevents errors even when env vars are not defined
          const resolvedConfig = resolveEnvReferences(config, process.env, undefined, false)

          // Try reading sensitive info from .env.local (legacy approach, for backward compatibility)
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
        // Use non-strict mode when reading config, preserving missing env var references
        const resolved = resolveEnvReferences(raw, process.env, undefined, false)
        return DbcliConfigSchema.parse(resolved)
      }

      // Neither exists, return default config
      return { ...DEFAULT_CONFIG }
    } catch (error) {
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
        ...(updates.connection || {})
      },
      schema: {
        ...existing.schema,
        ...(updates.schema || {})
      },
      metadata: {
        ...existing.metadata,
        ...(updates.metadata || {}),
        // Preserve original createdAt, set new value if absent
        createdAt: existing.metadata?.createdAt || new Date().toISOString(),
        version: (existing.metadata?.version || '1.0')
      }
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

      const pathObj = Bun.file(path)
      const isDirectory = (await pathObj.exists()) && pathObj.type === 'directory'

      // Directory mode: separate config and .env.local
      if (isDirectory || path.endsWith('.dbcli')) {
        // Check if using env var references (password is a { "$env": "..." } object)
        const hasEnvReferences = isEnvReference((config.connection as any).password)

        if (hasEnvReferences) {
          // New approach: using env var references, write directly to config.json
          const configPath = join(path, 'config.json')
          const configJson = JSON.stringify(config, null, 2)
          await Bun.file(configPath).write(configJson)
        } else {
          // Legacy approach: password separated into .env.local
          const password = config.connection.password
          const configWithoutPassword = {
            ...config,
            connection: {
              ...config.connection,
              password: undefined
            }
          }
          delete (configWithoutPassword.connection as any).password

          // Write config.json (without password)
          const configPath = join(path, 'config.json')
          const configJson = JSON.stringify(configWithoutPassword, null, 2)
          await Bun.file(configPath).write(configJson)

          // Write .env.local (password)
          if (password) {
            const envPath = join(path, '.env.local')
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
  }
}
