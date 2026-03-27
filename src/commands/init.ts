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
import { t, t_vars } from '@/i18n/message-loader'
import { parseEnvDatabase } from '@/core/env-parser'
import { configModule } from '@/core/config'
import { getDefaultsForSystem } from '@/adapters/defaults'
import { promptUser } from '@/utils/prompts'
import { ConnectionConfig } from '@/types'
import { AdapterFactory, ConnectionError } from '@/adapters'

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
  .option('--use-env-refs', 'Generate config with environment variable references (for .env)', false)
  .option('--env-host <var>', 'Environment variable name for database host (when using --use-env-refs)')
  .option('--env-port <var>', 'Environment variable name for database port (when using --use-env-refs)')
  .option('--env-user <var>', 'Environment variable name for database user (when using --use-env-refs)')
  .option('--env-password <var>', 'Environment variable name for database password (when using --use-env-refs)')
  .option('--env-database <var>', 'Environment variable name for database name (when using --use-env-refs)')
  .option('--skip-test', 'Skip database connection test')
  .option('--no-interactive', 'Non-interactive mode (requires all values via flags)')
  .option('--force', 'Skip overwrite confirmation if .dbcli exists')
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
  // 1. Load existing config
  const existingConfig = await configModule.read('.dbcli')

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
    throw new Error(`Invalid database system: ${system}`)
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

    if (shouldPrompt && !options.permission) {
      permission = await promptUser.select(t('init.prompt_permission'), [
        'query-only',
        'read-write',
        'admin'
      ])
    }

    // Validate permission value
    if (!['query-only', 'read-write', 'data-admin', 'admin'].includes(permission)) {
      throw new Error(`Invalid permission level: ${permission}`)
    }

    // Merge config and save
    const newConfig = configModule.merge(existingConfig, {
      connection: configForWrite,
      permission: permission as 'query-only' | 'read-write' | 'data-admin' | 'admin'
    })

    // Check existing file and prompt for overwrite confirmation
    const configFile = Bun.file('.dbcli')
    const fileExists = await configFile.exists()

    if (fileExists && !options.force) {
      if (shouldPrompt) {
        const overwrite = await promptUser.confirm(
          t('init.config_exists_overwrite')
        )
        if (!overwrite) {
          console.log(t('init.cancelled'))
          return
        }
      } else {
        throw new Error('.dbcli exists. Use --force option to overwrite.')
      }
    }

    // Skip connection test (only env-var references, no actual connection values)
    console.log('⏭️  Skipping connection test in env-ref mode')

    // Write config
    await configModule.write('.dbcli', newConfig)
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
    throw new Error(`Invalid port: ${portStr}`)
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
    throw new Error('Non-interactive mode requires --user option')
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
    throw new Error('Non-interactive mode requires --name option')
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
  if (!['query-only', 'read-write', 'data-admin', 'admin'].includes(permission)) {
    throw new Error(`Invalid permission level: ${permission}`)
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
      throw new Error(
        'When using --use-env-refs, environment variable names must be specified.\n' +
        'Provide options: --env-host, --env-port, --env-user, --env-password, --env-database\n' +
        'Or use interactive mode: run "bun dev init --use-env-refs" without --no-interactive'
      )
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
  const configFile = Bun.file('.dbcli')
  const fileExists = await configFile.exists()

  if (fileExists && !options.force) {
    if (shouldPrompt) {
      const overwrite = await promptUser.confirm(
        t('init.config_exists_overwrite')
      )
      if (!overwrite) {
        console.log(t('init.cancelled'))
        return
      }
    } else {
      throw new Error('.dbcli exists. Use --force option to overwrite.')
    }
  }

  // 8. Test database connection (unless --skip-test or using --use-env-refs)
  // Note: connection test is skipped with --use-env-refs since env vars must actually be set
  if (!options.skipTest && !options.useEnvRefs) {
    console.log(t('init.connection_testing'))

    // Resolve actual connection parameters (handles env-var references)
    // Actual env var values are needed during connection testing, not empty strings
    const resolveValue = (value: any, fieldName: string): string | number => {
      if (typeof value === 'object' && value !== null && '$env' in value) {
        const envKey = value.$env
        const envValue = process.env[envKey]
        if (!envValue) {
          throw new Error(
            `Cannot test connection: environment variable ${envKey} is not defined\n` +
            `Set ${envKey} in .env or environment variables.\n` +
            `Hint: Check .env file or run 'export ${envKey}=<value>' and retry`
          )
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
        console.error('Hints:')
        error.hints.forEach((hint) => console.error(`  • ${hint}`))
        process.exit(1)
      }
      throw error
    } finally {
      await adapter.disconnect()
    }
  } else {
    console.log('⏭️  Skipping connection test (--skip-test)')
  }

  // 9. Write config
  await configModule.write('.dbcli', newConfig)
  console.log(t('init.config_saved'))
}
