/**
 * dbcli init command implementation
 *
 * Initialization workflow:
 * 1. Load existing .dbcli config (if present)
 * 2. Attempt to parse database config from .env
 * 3. Determine database system
 * 4. Prompt user for missing values
 * 5. Check existing files and prompt for overwrite confirmation
 * 6. Validate and write config
 */

import { Command } from 'commander'
import { join } from 'path'
import { mkdir } from 'node:fs/promises'
import { t, t_vars } from '@/i18n/message-loader'
import { parseEnvDatabase } from '@/core/env-parser'
import { configModule } from '@/core/config'
import { readV2Config, writeV2Config, detectConfigVersion } from '@/core/config-v2'
import { getDefaultsForSystem } from '@/adapters/defaults'
import { promptUser } from '@/utils/prompts'
import { redactSecretsForDisplay } from '@/utils/redaction'
import type { ConnectionConfig } from '@/types'
import { AdapterFactory, ConnectionError, type ConnectionOptions } from '@/adapters'
import type { DbcliConfigV2 } from '@/utils/validation'
import { resolveConfigPath } from '@/utils/config-path'
import {
  getProjectStoragePath,
  isGlobalConfigPath,
  migrateLegacyProjectEnvLocal,
  resolveConfigStoragePath,
  writeProjectBinding,
} from '@/core/config-binding'
import { checkOverwrite, writeV2InitConfig } from './init-shared'
import { handleMongoDBInit } from './init-mongodb'

const VALID_PERMISSIONS = ['query-only', 'read-write', 'data-admin', 'admin'] as const

async function handleRemove(configPath: string, name: string): Promise<void> {
  const storagePath = await resolveConfigStoragePath(configPath)
  const configFile = Bun.file(join(storagePath, 'config.json'))
  if (!(await configFile.exists())) {
    throw new Error(t('init.config_not_found'))
  }

  const raw = JSON.parse(await configFile.text())
  if (detectConfigVersion(raw) !== 2) {
    throw new Error(t('init.requires_v2_remove'))
  }

  const config = await readV2Config(storagePath)
  if (!config.connections[name]) {
    throw new Error(t_vars('init.connection_not_found', { name }))
  }

  const connectionCount = Object.keys(config.connections).length
  if (connectionCount <= 1) {
    throw new Error(t('init.cannot_remove_last'))
  }

  const remaining = Object.fromEntries(
    Object.entries(config.connections).filter(([connectionName]) => connectionName !== name)
  )
  const newDefault = config.default === name ? Object.keys(remaining)[0]! : config.default

  const updated: DbcliConfigV2 = {
    ...config,
    default: newDefault,
    connections: remaining,
  }

  await writeV2Config(storagePath, updated)

  if (config.default === name) {
    console.log(t_vars('init.connection_removed_switched', { name, newDefault }))
  } else {
    console.log(t_vars('init.connection_removed', { name }))
  }
}

async function handleRename(configPath: string, renameArg: string): Promise<void> {
  const [oldName, newName] = renameArg.split(':')
  if (!oldName || !newName) {
    throw new Error(t('init.rename_invalid_format'))
  }

  const storagePath = await resolveConfigStoragePath(configPath)
  const configFile = Bun.file(join(storagePath, 'config.json'))
  if (!(await configFile.exists())) {
    throw new Error(t('init.config_not_found'))
  }

  const raw = JSON.parse(await configFile.text())
  if (detectConfigVersion(raw) !== 2) {
    throw new Error(t('init.requires_v2_rename'))
  }

  const config = await readV2Config(storagePath)
  if (!config.connections[oldName]) {
    throw new Error(t_vars('init.connection_not_found', { name: oldName }))
  }
  if (config.connections[newName]) {
    throw new Error(t_vars('init.connection_already_exists', { name: newName }))
  }

  const entries = Object.entries(config.connections).map(
    ([key, value]) => [key === oldName ? newName : key, value] as const
  )

  const updated: DbcliConfigV2 = {
    ...config,
    default: config.default === oldName ? newName : config.default,
    connections: Object.fromEntries(entries),
  }

  await writeV2Config(storagePath, updated)
  console.log(t_vars('init.connection_renamed', { oldName, newName }))
}

/**
 * Build and configure the init command
 */
export const initCommand = new Command('init')
  .description('Initialize dbcli configuration with .env parsing and interactive prompts')
  .option('--host <host>', 'Database host')
  .option('--port <port>', 'Database port')
  .option('--user <user>', 'Database user')
  .option('--password <password>', 'Database password')
  .option('--name <name>', 'Database name')
  .option(
    '--system <system>',
    'Database system (postgresql, mysql, mariadb, mongodb, redis, elasticsearch)'
  )
  .option('--cloud-id <id>', 'Elasticsearch Cloud ID')
  .option('--api-key <key>', 'Elasticsearch API Key')
  .option(
    '--uri <uri>',
    'MongoDB connection URI (mongodb://user:pass@host:27017/db?authSource=admin)'
  )

  .option(
    '--auth-source <authSource>',
    'MongoDB auth database (default: admin when user/password are set)'
  )
  .option(
    '--permission <permission>',
    'Permission level (query-only, read-write, data-admin, admin)',
    'query-only'
  )
  .option(
    '--use-env-refs',
    'Store env var references in config instead of actual values (for CI/CD or multi-env)',
    false
  )
  .option('--env-host <var>', 'Env var name for host (with --use-env-refs)')
  .option('--env-port <var>', 'Env var name for port (with --use-env-refs)')
  .option('--env-user <var>', 'Env var name for user (with --use-env-refs)')
  .option('--env-password <var>', 'Env var name for password (with --use-env-refs)')
  .option('--env-database <var>', 'Env var name for database (with --use-env-refs)')
  .option('--skip-test', 'Skip database connection test')
  .option('--no-interactive', 'Non-interactive mode (requires all values via flags)')
  .option('--force', 'Skip overwrite confirmation if .dbcli exists')
  .option('--conn-name <name>', 'Connection name (creates v2 multi-connection config)')
  .option('--env-file <path>', 'Path to env file for this connection')
  .option('--remove <name>', 'Remove a named connection')
  .option('--rename <names>', 'Rename a connection (format: old:new)')
  .action(async (options) => {
    try {
      await initCommandHandler(options, initCommand)
    } catch (error) {
      if (error instanceof Error) {
        console.error(t_vars('errors.message', { message: error.message }))
      } else {
        console.error(t_vars('errors.message', { message: String(error) }))
      }
      process.exit(1)
    }
  })

/**
 * Actual handler for the init command
 */
async function initCommandHandler(
  options: Record<string, unknown>,
  command: Command
): Promise<void> {
  const configPath = resolveConfigPath(command)

  // Handle --remove
  if (options.remove) {
    await handleRemove(configPath, options.remove as string)
    return
  }

  // Handle --rename
  if (options.rename) {
    await handleRename(configPath, options.rename as string)
    return
  }

  // Determine if this is a v2 init
  const isGlobalConfig = isGlobalConfigPath(configPath)
  const isV2Init = !!(options.connName || options.envFile || isGlobalConfig)
  const connectionName = (options.connName as string) || 'default'

  // 1. Load existing config
  const existingConfig = await configModule.read(configPath)

  // 2. Determine whether to enter interactive mode
  // If --use-env-refs is set and all --env-* options are provided, automatically go non-interactive
  const isUsingEnvRefs = options.useEnvRefs
  const hasAllEnvOptions =
    isUsingEnvRefs &&
    options.envHost &&
    options.envPort &&
    options.envUser &&
    options.envPassword &&
    options.envDatabase

  // shouldPrompt: should we prompt the user for input?
  // - If --no-interactive, do not prompt
  // - If --use-env-refs with all --env-* options provided, do not prompt
  // - Otherwise, prompt
  //
  // Commander stores `--no-interactive` as `interactive: false`; the old
  // `options.noInteractive` read was always undefined, so the flag suppressed
  // nothing.
  const shouldPrompt = options.interactive !== false && !hasAllEnvOptions

  // 3. Attempt to parse database config from .env
  let envConfig = null
  try {
    envConfig = parseEnvDatabase(process.env)
  } catch {
    if (shouldPrompt) {
      console.log(t('init.env_parse_note'))
    }
  }

  // 4. Determine database system
  const systemFromCli = typeof options.system === 'string' ? options.system : undefined
  let system: string = systemFromCli ?? envConfig?.system ?? 'postgresql'

  // Only prompt when prompting is needed and no system value was provided
  if (shouldPrompt && !options.system && !envConfig?.system) {
    system = await promptUser.select(t('init.select_system'), [
      'postgresql',
      'mysql',
      'mariadb',
      'mongodb',
      'redis',
      'elasticsearch',
    ])
  }

  // Validate system value
  if (!['postgresql', 'mysql', 'mariadb', 'mongodb', 'redis', 'elasticsearch'].includes(system)) {
    throw new Error(t_vars('errors.invalid_system', { system }))
  }

  const defaults = getDefaultsForSystem(
    system as 'postgresql' | 'mysql' | 'mariadb' | 'mongodb' | 'redis' | 'elasticsearch'
  )

  // 4a. MongoDB: handle separately and return early
  if (system === 'mongodb') {
    await handleMongoDBInit({
      options,
      configPath,
      connectionName,
      isV2Init,
      existingConfig,
      shouldPrompt,
    })
    return
  }

  // 4. Collect values for each connection parameter
  const connection: Partial<ConnectionConfig> = {
    system: system as 'postgresql' | 'mysql' | 'mariadb',
  }

  // Declare configForWrite early (will be assigned later)
  let configForWrite: ConnectionConfig

  // If --use-env-refs is set, in interactive mode only ask for env var names
  // Otherwise ask for actual connection values
  if (options.useEnvRefs && shouldPrompt) {
    // Env-ref mode: only ask for environment variable names, not actual values
    const envHost =
      (options.envHost as string | undefined) ||
      (await promptUser.text(t('init.prompt_host'), 'DB_HOST'))
    const envPort =
      (options.envPort as string | undefined) ||
      (await promptUser.text(t('init.prompt_port'), 'DB_PORT'))
    const envUser =
      (options.envUser as string | undefined) ||
      (await promptUser.text(t('init.prompt_user'), 'DB_USER'))
    const envPassword =
      (options.envPassword as string | undefined) ||
      (await promptUser.text(t('init.prompt_password'), 'DB_PASSWORD'))
    const envDatabase =
      (options.envDatabase as string | undefined) ||
      (await promptUser.text(t('init.prompt_name'), 'DB_DATABASE'))

    // Directly convert to env-ref config
    configForWrite = {
      system: connection.system as 'postgresql' | 'mysql' | 'mariadb',
      host: { $env: envHost },
      port: { $env: envPort },
      user: { $env: envUser },
      password: { $env: envPassword },
      database: { $env: envDatabase },
    }

    // Skip subsequent connection parameter collection, go directly to permission selection
    const permissionFromCli =
      typeof options.permission === 'string' ? options.permission : undefined
    let permission: string = permissionFromCli ?? 'query-only'

    if (!options.permission) {
      permission = await promptUser.select(t('init.prompt_permission'), [
        'query-only',
        'read-write',
        'data-admin',
        'admin',
      ])
    }

    // Validate permission value
    if (!(VALID_PERMISSIONS as readonly string[]).includes(permission)) {
      throw new Error(t_vars('errors.invalid_permission', { permission }))
    }

    // Merge config and save
    const newConfig = configModule.merge(existingConfig, {
      connection: configForWrite,
      permission: permission as (typeof VALID_PERMISSIONS)[number],
    })

    // Check existing file and prompt for overwrite confirmation
    const canProceed = await checkOverwrite(configPath, shouldPrompt, !!options.force)
    if (!canProceed) return

    // Skip connection test (only env-var references, no actual connection values)
    console.log(`⏭️  ${t('init.skip_test_env_ref')}`)

    // V2 init path (env-refs interactive mode)
    if (isV2Init) {
      await writeV2InitConfig(
        configPath,
        connectionName,
        configForWrite,
        permission as string,
        options.envFile as string | undefined
      )
      return
    }

    // Write config
    const storagePath = isGlobalConfig ? configPath : getProjectStoragePath(configPath)
    await mkdir(storagePath, { recursive: true })
    await configModule.write(storagePath, newConfig)
    if (!isGlobalConfig) {
      await migrateLegacyProjectEnvLocal(configPath, storagePath)
      await writeProjectBinding(configPath, storagePath)
    }
    console.log(t('init.config_saved'))
    return
  }

  // Normal mode: ask for actual connection values
  const strOpt = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)
  const portStrOpt = (v: unknown): string | undefined =>
    typeof v === 'string' || typeof v === 'number' ? String(v) : undefined
  const defaultHost = typeof defaults.host === 'string' ? defaults.host : 'localhost'
  const defaultPort = typeof defaults.port === 'number' ? defaults.port : 5432

  // Hostname
  connection.host =
    strOpt(options.host) ??
    envConfig?.host ??
    (shouldPrompt ? await promptUser.text(t('init.prompt_host'), defaultHost) : defaultHost)

  // Port number
  const portStr =
    portStrOpt(options.port) ??
    (envConfig?.port != null ? String(envConfig.port) : null) ??
    (shouldPrompt
      ? await promptUser.text(t('init.prompt_port'), String(defaultPort))
      : String(defaultPort))

  const port = parseInt(portStr, 10)
  if (isNaN(port) || port < 1 || port > 65535) {
    throw new Error(t_vars('errors.invalid_port', { port: portStr }))
  }
  connection.port = port

  // Username
  connection.user =
    strOpt(options.user) ??
    envConfig?.user ??
    (shouldPrompt ? await promptUser.text(t('init.prompt_user')) : '')

  // When using --use-env-refs, actual connection values are optional (read from env vars)
  // Otherwise, non-interactive mode requires these values
  if (!connection.user && !shouldPrompt && !options.useEnvRefs) {
    throw new Error(t('errors.require_user'))
  }

  // Password. Masked, and with no plain-text fallback: an echoed credential
  // stays in scrollback, logs, and recordings long after init finishes.
  connection.password =
    strOpt(options.password) ??
    envConfig?.password ??
    (shouldPrompt
      ? await promptUser.secret(t('init.prompt_password'), {
          unavailable: t('init.secret_alternatives_sql'),
        })
      : '')

  // Database name
  connection.database =
    strOpt(options.name) ??
    envConfig?.database ??
    (shouldPrompt ? await promptUser.text(t('init.prompt_name')) : '')

  // When using --use-env-refs, actual connection values are optional (read from env vars)
  // Otherwise, non-interactive mode requires these values
  if (!connection.database && !shouldPrompt && !options.useEnvRefs) {
    throw new Error(t('errors.require_name'))
  }

  // 5. Select permission level
  const permissionFromCli = typeof options.permission === 'string' ? options.permission : undefined
  let permission: string = permissionFromCli ?? 'query-only'

  if (shouldPrompt && !options.permission) {
    permission = await promptUser.select(t('init.prompt_permission'), [
      'query-only',
      'read-write',
      'data-admin',
      'admin',
    ])
  }

  // Validate permission value
  if (!(VALID_PERMISSIONS as readonly string[]).includes(permission)) {
    throw new Error(t_vars('errors.invalid_permission', { permission }))
  }

  // 6. If --use-env-refs is enabled (non-interactive mode), convert to env-var references
  // Note: interactive mode has already been handled above and returned
  configForWrite = connection as ConnectionConfig

  if (options.useEnvRefs) {
    // Non-interactive mode requires env variable names to be provided
    const envHost = options.envHost as string | undefined
    const envPort = options.envPort as string | undefined
    const envUser = options.envUser as string | undefined
    const envPassword = options.envPassword as string | undefined
    const envDatabase = options.envDatabase as string | undefined

    if (!envHost || !envPort || !envUser || !envPassword || !envDatabase) {
      throw new Error(t('errors.env_refs_missing_options'))
    }

    configForWrite = {
      system: connection.system as 'postgresql' | 'mysql' | 'mariadb',
      host: { $env: envHost },
      port: { $env: envPort },
      user: { $env: envUser },
      password: { $env: envPassword },
      database: { $env: envDatabase },
    }
  }

  const newConfig = configModule.merge(existingConfig, {
    connection: configForWrite as any,
    permission: permission as 'query-only' | 'read-write' | 'data-admin' | 'admin',
  })

  // 7. Check existing file and prompt for overwrite confirmation
  const canProceed = await checkOverwrite(configPath, shouldPrompt, !!options.force)
  if (!canProceed) return

  // 8. Test database connection (unless --skip-test or using --use-env-refs)
  // Note: connection test is skipped with --use-env-refs since env vars must actually be set
  if (!options.skipTest && !options.useEnvRefs) {
    console.log(t('init.connection_testing'))

    // Resolve actual connection parameters (handles env-var references)
    // Actual env var values are needed during connection testing, not empty strings
    const resolveValue = (value: unknown, _fieldName: string): string | number => {
      if (typeof value === 'object' && value !== null && '$env' in value) {
        const envKey = (value as { $env: string }).$env
        const envValue = process.env[envKey]
        if (!envValue) {
          throw new Error(t_vars('errors.env_var_not_defined', { envKey }))
        }
        return envValue
      }
      return value as string | number
    }

    const testConnection: ConnectionOptions = {
      system: newConfig.connection.system,
      host: String(resolveValue(newConfig.connection.host, 'host')),
      port: parseInt(String(resolveValue(newConfig.connection.port, 'port')), 10) || 5432,
      user: String(resolveValue(newConfig.connection.user, 'user')),
      password: String(resolveValue(newConfig.connection.password, 'password')) || '',
      database: String(resolveValue(newConfig.connection.database, 'database')),
    }

    const adapter = AdapterFactory.createAdapterWithoutRules(testConnection)

    try {
      await adapter.connect()
      const isHealthy = await adapter.testConnection()
      if (isHealthy) {
        console.log(t('init.connection_success'))
      }
    } catch (error) {
      // A driver is free to quote the credential back in its own message.
      const safe = (text: string) => redactSecretsForDisplay(text, [testConnection.password ?? ''])
      if (error instanceof ConnectionError) {
        console.error(t_vars('errors.connection_failed', { message: safe(error.message) }))
        console.error(t('init.connection_hints'))
        error.hints.forEach((hint) => console.error(`  • ${safe(hint)}`))
        process.exit(1)
      }
      throw new Error(safe(error instanceof Error ? error.message : String(error)))
    } finally {
      await adapter.disconnect()
    }
  } else {
    const msgKey = options.useEnvRefs ? 'init.skip_test_env_ref' : 'init.skip_test'
    console.log(`⏭️  ${t(msgKey)}`)
  }

  // 9. Write config
  // V2 init path
  if (isV2Init) {
    await writeV2InitConfig(
      configPath,
      connectionName,
      configForWrite,
      permission as string,
      options.envFile as string | undefined
    )
    return
  }

  const storagePath = isGlobalConfig ? configPath : getProjectStoragePath(configPath)
  await mkdir(storagePath, { recursive: true })
  await configModule.write(storagePath, newConfig)
  if (!isGlobalConfig) {
    await migrateLegacyProjectEnvLocal(configPath, storagePath)
    await writeProjectBinding(configPath, storagePath)
  }
  console.log(t('init.config_saved'))
}
