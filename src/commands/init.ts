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
import { t, t_vars } from '@/i18n/message-loader'
import { parseEnvDatabase } from '@/core/env-parser'
import { configModule } from '@/core/config'
import { readV2Config, writeV2Config, detectConfigVersion } from '@/core/config-v2'
import { getDefaultsForSystem } from '@/adapters/defaults'
import { promptUser } from '@/utils/prompts'
import { ConnectionConfig } from '@/types'
import { AdapterFactory, ConnectionError } from '@/adapters'
import type { DbcliConfigV2 } from '@/utils/validation'
import { resolveConfigPath } from '@/utils/config-path'

const VALID_PERMISSIONS = ['query-only', 'read-write', 'data-admin', 'admin'] as const

/**
 * Check if .dbcli exists and handle overwrite confirmation
 * Shared by both env-ref and normal mode paths
 */
async function checkOverwrite(
  configPath: string,
  shouldPrompt: boolean,
  force: boolean
): Promise<boolean> {
  const fileExists = await Bun.file(configPath).exists()
  const dirConfigExists = await Bun.file(join(configPath, 'config.json')).exists()

  if ((!fileExists && !dirConfigExists) || force) return true

  if (shouldPrompt) {
    const overwrite = await promptUser.confirm(t('init.config_exists_overwrite'))
    if (!overwrite) {
      console.log(t('init.cancelled'))
      return false
    }
    return true
  }

  throw new Error(t('init.config_exists_use_force'))
}

async function handleRemove(configPath: string, name: string): Promise<void> {
  const configFile = Bun.file(join(configPath, 'config.json'))
  if (!(await configFile.exists())) {
    throw new Error(t('init.config_not_found'))
  }

  const raw = JSON.parse(await configFile.text())
  if (detectConfigVersion(raw) !== 2) {
    throw new Error(t('init.requires_v2_remove'))
  }

  const config = await readV2Config(configPath)
  if (!config.connections[name]) {
    throw new Error(t_vars('init.connection_not_found', { name }))
  }

  const connectionCount = Object.keys(config.connections).length
  if (connectionCount <= 1) {
    throw new Error(t('init.cannot_remove_last'))
  }

  const { [name]: _removed, ...remaining } = config.connections
  const newDefault = config.default === name ? Object.keys(remaining)[0] : config.default

  const updated: DbcliConfigV2 = {
    ...config,
    default: newDefault,
    connections: remaining,
  }

  await writeV2Config(configPath, updated)

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

  const configFile = Bun.file(join(configPath, 'config.json'))
  if (!(await configFile.exists())) {
    throw new Error(t('init.config_not_found'))
  }

  const raw = JSON.parse(await configFile.text())
  if (detectConfigVersion(raw) !== 2) {
    throw new Error(t('init.requires_v2_rename'))
  }

  const config = await readV2Config(configPath)
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

  await writeV2Config(configPath, updated)
  console.log(t_vars('init.connection_renamed', { oldName, newName }))
}

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

  // Check for existing v2 config, or migrate from V1
  // configFile is join(configPath, 'config.json') — valid when configPath is a directory
  if (await configFile.exists()) {
    const raw = JSON.parse(await configFile.text())
    if (detectConfigVersion(raw) === 2) {
      existingV2 = await readV2Config(configPath)
    } else {
      // Directory-based V1 config — import it as 'default' connection
      const v1Config = await configModule.read(configPath)
      existingV2 = {
        version: 2,
        default: 'default',
        connections: {
          default: {
            ...v1Config.connection,
            permission: v1Config.permission,
          },
        },
        schema: v1Config.schema || {},
        metadata: v1Config.metadata || { version: '1.0' },
        blacklist: v1Config.blacklist || { tables: [], columns: {} },
      }
    }
  } else {
    // Check if configPath itself is a legacy V1 file (e.g. a single .dbcli JSON file)
    const legacyFile = Bun.file(configPath)
    if (await legacyFile.exists()) {
      const raw = JSON.parse(await legacyFile.text())
      if (detectConfigVersion(raw) !== 2) {
        // V1 single-file config — import it as 'default' connection
        const v1Config = await configModule.read(configPath)
        existingV2 = {
          version: 2,
          default: 'default',
          connections: {
            default: {
              ...v1Config.connection,
              permission: v1Config.permission,
            },
          },
          schema: v1Config.schema || {},
          metadata: v1Config.metadata || { version: '1.0' },
          blacklist: v1Config.blacklist || { tables: [], columns: {} },
        }
      }
    }
  }

  // Build connection entry
  const connEntry: any = {
    ...connection,
    permission: permission as 'query-only' | 'read-write' | 'data-admin' | 'admin',
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
          [connectionName]: connEntry,
        },
      }
    : {
        version: 2,
        default: connectionName,
        connections: {
          [connectionName]: connEntry,
        },
        schema: {},
        metadata: { version: '1.0', createdAt: new Date().toISOString() },
        blacklist: { tables: [], columns: {} },
      }

  // Ensure directory exists
  await Bun.$`mkdir -p ${configPath}`

  await writeV2Config(configPath, v2Config)
  console.log(t('init.config_saved'))
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
  .option('--system <system>', 'Database system (postgresql, mysql, mariadb, mongodb)')
  .option(
    '--uri <uri>',
    'MongoDB connection URI (mongodb://user:pass@host:port/db?authSource=admin)'
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
  const isV2Init = !!(options.connName || options.envFile)
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
  const shouldPrompt = !options.noInteractive && !hasAllEnvOptions

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
  let system = options.system || envConfig?.system || 'postgresql'

  // Only prompt when prompting is needed and no system value was provided
  if (shouldPrompt && !options.system && !envConfig?.system) {
    system = await promptUser.select(t('init.select_system'), [
      'postgresql',
      'mysql',
      'mariadb',
      'mongodb',
    ])
  }

  // Validate system value
  if (!['postgresql', 'mysql', 'mariadb', 'mongodb'].includes(system)) {
    throw new Error(t_vars('errors.invalid_system', { system }))
  }

  const defaults = getDefaultsForSystem(system as 'postgresql' | 'mysql' | 'mariadb' | 'mongodb')

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
    let envHost = options.envHost || (await promptUser.text(t('init.prompt_host'), 'DB_HOST'))
    let envPort = options.envPort || (await promptUser.text(t('init.prompt_port'), 'DB_PORT'))
    let envUser = options.envUser || (await promptUser.text(t('init.prompt_user'), 'DB_USER'))
    let envPassword =
      options.envPassword || (await promptUser.text(t('init.prompt_password'), 'DB_PASSWORD'))
    let envDatabase =
      options.envDatabase || (await promptUser.text(t('init.prompt_name'), 'DB_DATABASE'))

    // Directly convert to env-ref config
    configForWrite = {
      system: connection.system as 'postgresql' | 'mysql' | 'mariadb',
      host: { $env: envHost } as any,
      port: { $env: envPort } as any,
      user: { $env: envUser } as any,
      password: { $env: envPassword } as any,
      database: { $env: envDatabase } as any,
    }

    // Skip subsequent connection parameter collection, go directly to permission selection
    let permission = options.permission || 'query-only'

    if (!options.permission) {
      permission = await promptUser.select(t('init.prompt_permission'), [
        'query-only',
        'read-write',
        'data-admin',
        'admin',
      ])
    }

    // Validate permission value
    if (!VALID_PERMISSIONS.includes(permission)) {
      throw new Error(t_vars('errors.invalid_permission', { permission }))
    }

    // Merge config and save
    const newConfig = configModule.merge(existingConfig, {
      connection: configForWrite,
      permission: permission as 'query-only' | 'read-write' | 'data-admin' | 'admin',
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
    await configModule.write(configPath, newConfig)
    console.log(t('init.config_saved'))
    return
  }

  // Normal mode: ask for actual connection values
  // Hostname
  connection.host =
    options.host ||
    envConfig?.host ||
    (shouldPrompt
      ? await promptUser.text(t('init.prompt_host'), defaults.host || 'localhost')
      : defaults.host || 'localhost')

  // Port number
  const portStr =
    options.port ||
    (envConfig?.port ? String(envConfig.port) : null) ||
    (shouldPrompt
      ? await promptUser.text(t('init.prompt_port'), String(defaults.port || 5432))
      : String(defaults.port || 5432))

  const port = parseInt(portStr, 10)
  if (isNaN(port) || port < 1 || port > 65535) {
    throw new Error(t_vars('errors.invalid_port', { port: portStr }))
  }
  connection.port = port

  // Username
  connection.user =
    options.user ||
    envConfig?.user ||
    (shouldPrompt ? await promptUser.text(t('init.prompt_user')) : '')

  // When using --use-env-refs, actual connection values are optional (read from env vars)
  // Otherwise, non-interactive mode requires these values
  if (!connection.user && !shouldPrompt && !options.useEnvRefs) {
    throw new Error(t('errors.require_user'))
  }

  // Password
  connection.password =
    options.password ||
    envConfig?.password ||
    (shouldPrompt ? await promptUser.text(t('init.prompt_password')) : '')

  // Database name
  connection.database =
    options.name ||
    envConfig?.database ||
    (shouldPrompt ? await promptUser.text(t('init.prompt_name')) : '')

  // When using --use-env-refs, actual connection values are optional (read from env vars)
  // Otherwise, non-interactive mode requires these values
  if (!connection.database && !shouldPrompt && !options.useEnvRefs) {
    throw new Error(t('errors.require_name'))
  }

  // 5. Select permission level
  let permission = options.permission || 'query-only'

  if (shouldPrompt && !options.permission) {
    permission = await promptUser.select(t('init.prompt_permission'), [
      'query-only',
      'read-write',
      'data-admin',
      'admin',
    ])
  }

  // Validate permission value
  if (!VALID_PERMISSIONS.includes(permission)) {
    throw new Error(t_vars('errors.invalid_permission', { permission }))
  }

  // 6. If --use-env-refs is enabled (non-interactive mode), convert to env-var references
  // Note: interactive mode has already been handled above and returned
  configForWrite = connection as ConnectionConfig

  if (options.useEnvRefs) {
    // Non-interactive mode requires env variable names to be provided
    const envHost = options.envHost
    const envPort = options.envPort
    const envUser = options.envUser
    const envPassword = options.envPassword
    const envDatabase = options.envDatabase

    if (!envHost || !envPort || !envUser || !envPassword || !envDatabase) {
      throw new Error(t('errors.env_refs_missing_options'))
    }

    configForWrite = {
      system: connection.system as 'postgresql' | 'mysql' | 'mariadb',
      host: { $env: envHost } as any,
      port: { $env: envPort } as any,
      user: { $env: envUser } as any,
      password: { $env: envPassword } as any,
      database: { $env: envDatabase } as any,
    }
  }

  const newConfig = configModule.merge(existingConfig, {
    connection: configForWrite,
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
    const resolveValue = (value: any, _fieldName: string): string | number => {
      if (typeof value === 'object' && value !== null && '$env' in value) {
        const envKey = value.$env
        const envValue = process.env[envKey]
        if (!envValue) {
          throw new Error(t_vars('errors.env_var_not_defined', { envKey }))
        }
        return envValue
      }
      return value
    }

    const testConnection: ConnectionConfig = {
      system: newConfig.connection.system,
      host: String(resolveValue(newConfig.connection.host, 'host')),
      port: parseInt(String(resolveValue(newConfig.connection.port, 'port')), 10) || 5432,
      user: String(resolveValue(newConfig.connection.user, 'user')),
      password: String(resolveValue(newConfig.connection.password, 'password')) || '',
      database: String(resolveValue(newConfig.connection.database, 'database')),
    }

    const adapter = AdapterFactory.createAdapter(testConnection)

    try {
      await adapter.connect()
      const isHealthy = await adapter.testConnection()
      if (isHealthy) {
        console.log(t('init.connection_success'))
      }
    } catch (error) {
      if (error instanceof ConnectionError) {
        console.error(t_vars('errors.connection_failed', { message: error.message }))
        console.error(t('init.connection_hints'))
        error.hints.forEach((hint) => console.error(`  • ${hint}`))
        process.exit(1)
      }
      throw error
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

  await configModule.write(configPath, newConfig)
  console.log(t('init.config_saved'))
}

async function handleMongoDBInit(ctx: {
  options: Record<string, unknown>
  configPath: string
  connectionName: string
  isV2Init: boolean
  existingConfig: any
  shouldPrompt: boolean
}): Promise<void> {
  const { options, configPath, connectionName, isV2Init, existingConfig } = ctx
  // Use TTY check for interactive prompts (Commander --no-interactive sets options.interactive=false)
  const isInteractive = options.interactive !== false && process.stdin.isTTY

  // URI mode: --uri flag or interactive prompt
  let mongoUri = options.uri as string | undefined
  if (!mongoUri && isInteractive) {
    const input = await promptUser.text(
      'MongoDB URI (e.g. mongodb://user:pass@host:27017/db?authSource=admin) — 留空用 host/port/user/password',
      ''
    )
    if (input.trim()) mongoUri = input.trim()
  }

  // Database name (required even in URI mode for schema cache labelling)
  let database = (options.name as string | undefined) || ''
  if (!database && isInteractive) {
    database = await promptUser.text('Database name', 'testdb')
  }
  if (!database && !isInteractive) {
    throw new Error(t('errors.require_name'))
  }

  // Build connection config
  const authSource = (options.authSource as string | undefined) || ''
  const mongoConfig = mongoUri
    ? {
        system: 'mongodb' as const,
        uri: mongoUri,
        database,
        host: '',
        port: 27017,
        user: '',
        password: '',
      }
    : {
        system: 'mongodb' as const,
        host: (options.host as string) || 'localhost',
        port: parseInt((options.port as string) || '27017', 10),
        user: (options.user as string) || '',
        password: (options.password as string) || '',
        database,
        ...(authSource ? { authSource } : {}),
      }

  // Permission
  let permission = (options.permission as string) || 'query-only'
  if (isInteractive && !options.permission) {
    permission = await promptUser.select(t('init.prompt_permission'), [
      'query-only',
      'read-write',
      'data-admin',
      'admin',
    ])
  }
  if (!VALID_PERMISSIONS.includes(permission as any)) {
    throw new Error(t_vars('errors.invalid_permission', { permission }))
  }

  // Overwrite check
  const canProceed = await checkOverwrite(configPath, isInteractive, !!options.force)
  if (!canProceed) return

  // Connection test
  if (!options.skipTest) {
    console.log(t('init.connection_testing'))
    const mongoAdapter = AdapterFactory.createMongoDBAdapter(mongoConfig as any)
    try {
      await mongoAdapter.connect()
      await mongoAdapter.testConnection()
      console.log(t('init.connection_success'))
    } catch (error) {
      if (error instanceof ConnectionError) {
        console.error(t_vars('errors.connection_failed', { message: error.message }))
        console.error(t('init.connection_hints'))
        error.hints.forEach((hint) => console.error(`  • ${hint}`))
        process.exit(1)
      }
      throw error
    } finally {
      await mongoAdapter.disconnect()
    }
  } else {
    console.log(`⏭️  ${t('init.skip_test')}`)
  }

  // Write config
  if (isV2Init) {
    await writeV2InitConfig(
      configPath,
      connectionName,
      mongoConfig as any,
      permission,
      options.envFile as string | undefined
    )
    return
  }

  const newConfig = configModule.merge(existingConfig, {
    connection: mongoConfig as any,
    permission: permission as any,
  })
  await configModule.write(configPath, newConfig)
  console.log(t('init.config_saved'))
}
