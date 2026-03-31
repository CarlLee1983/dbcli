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

const VALID_PERMISSIONS = ['query-only', 'read-write', 'data-admin', 'admin'] as const

/**
 * Check if .dbcli exists and handle overwrite confirmation
 * Shared by both env-ref and normal mode paths
 */
async function checkOverwrite(
  shouldPrompt: boolean,
  force: boolean
): Promise<boolean> {
  const configFile = Bun.file('.dbcli')
  const fileExists = await configFile.exists()

  if (!fileExists || force) return true

  if (shouldPrompt) {
    const overwrite = await promptUser.confirm(
      t('init.config_exists_overwrite')
    )
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

async function handleRename(configPath: string, renameArg: string): Promise<void> {
  const [oldName, newName] = renameArg.split(':')
  if (!oldName || !newName) {
    throw new Error('用法：--rename <舊名稱>:<新名稱>')
  }

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
  .option('--system <system>', 'Database system (postgresql, mysql, mariadb)')
  .option('--permission <permission>', 'Permission level (query-only, read-write, data-admin, admin)', 'query-only')
  .option('--use-env-refs', 'Store env var references in config instead of actual values (for CI/CD or multi-env)', false)
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
      await initCommandHandler(options)
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
  options: Record<string, unknown>
): Promise<void> {
  const configPath = (initCommand.parent?.opts().config as string | undefined) ?? '.dbcli'

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
  const hasAllEnvOptions = isUsingEnvRefs &&
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
      'mariadb'
    ])
  }

  // Validate system value
  if (!['postgresql', 'mysql', 'mariadb'].includes(system)) {
    throw new Error(t_vars('errors.invalid_system', { system }))
  }

  const defaults = getDefaultsForSystem(system as 'postgresql' | 'mysql' | 'mariadb')

  // 4. Collect values for each connection parameter
  const connection: Partial<ConnectionConfig> = {
    system: system as 'postgresql' | 'mysql' | 'mariadb'
  }

  // Declare configForWrite early (will be assigned later)
  let configForWrite: ConnectionConfig

  // If --use-env-refs is set, in interactive mode only ask for env var names
  // Otherwise ask for actual connection values
  if (options.useEnvRefs && shouldPrompt) {
    // Env-ref mode: only ask for environment variable names, not actual values
    let envHost = options.envHost || await promptUser.text(t('init.prompt_host'), 'DB_HOST')
    let envPort = options.envPort || await promptUser.text(t('init.prompt_port'), 'DB_PORT')
    let envUser = options.envUser || await promptUser.text(t('init.prompt_user'), 'DB_USER')
    let envPassword = options.envPassword || await promptUser.text(t('init.prompt_password'), 'DB_PASSWORD')
    let envDatabase = options.envDatabase || await promptUser.text(t('init.prompt_name'), 'DB_DATABASE')

    // Directly convert to env-ref config
    configForWrite = {
      system: connection.system as 'postgresql' | 'mysql' | 'mariadb',
      host: { $env: envHost } as any,
      port: { $env: envPort } as any,
      user: { $env: envUser } as any,
      password: { $env: envPassword } as any,
      database: { $env: envDatabase } as any
    }

    // Skip subsequent connection parameter collection, go directly to permission selection
    let permission = options.permission || 'query-only'

    if (!options.permission) {
      permission = await promptUser.select(t('init.prompt_permission'), [
        'query-only',
        'read-write',
        'data-admin',
        'admin'
      ])
    }

    // Validate permission value
    if (!VALID_PERMISSIONS.includes(permission)) {
      throw new Error(t_vars('errors.invalid_permission', { permission }))
    }

    // Merge config and save
    const newConfig = configModule.merge(existingConfig, {
      connection: configForWrite,
      permission: permission as 'query-only' | 'read-write' | 'data-admin' | 'admin'
    })

    // Check existing file and prompt for overwrite confirmation
    const canProceed = await checkOverwrite(shouldPrompt, !!options.force)
    if (!canProceed) return

    // Skip connection test (only env-var references, no actual connection values)
    console.log(`⏭️  ${t('init.skip_test_env_ref')}`)

    // V2 init path (env-refs interactive mode)
    if (isV2Init) {
      await writeV2InitConfig(configPath, connectionName, configForWrite, permission as string, options.envFile as string | undefined)
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
    (shouldPrompt
      ? await promptUser.text(t('init.prompt_user'))
      : '')

  // When using --use-env-refs, actual connection values are optional (read from env vars)
  // Otherwise, non-interactive mode requires these values
  if (!connection.user && !shouldPrompt && !options.useEnvRefs) {
    throw new Error(t('errors.require_user'))
  }

  // Password
  connection.password =
    options.password ||
    envConfig?.password ||
    (shouldPrompt
      ? await promptUser.text(t('init.prompt_password'))
      : '')

  // Database name
  connection.database =
    options.name ||
    envConfig?.database ||
    (shouldPrompt
      ? await promptUser.text(t('init.prompt_name'))
      : '')

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
      'admin'
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
      database: { $env: envDatabase } as any
    }
  }

  const newConfig = configModule.merge(existingConfig, {
    connection: configForWrite,
    permission: permission as 'query-only' | 'read-write' | 'data-admin' | 'admin'
  })

  // 7. Check existing file and prompt for overwrite confirmation
  const canProceed = await checkOverwrite(shouldPrompt, !!options.force)
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
      database: String(resolveValue(newConfig.connection.database, 'database'))
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
    await writeV2InitConfig(configPath, connectionName, configForWrite, permission as string, options.envFile as string | undefined)
    return
  }

  await configModule.write(configPath, newConfig)
  console.log(t('init.config_saved'))
}
