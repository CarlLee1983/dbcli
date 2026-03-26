/**
 * dbcli init 命令實現
 *
 * 初始化工作流程：
 * 1. 加載現有 .dbcli 配置（如果存在）
 * 2. 嘗試從 .env 解析資料庫配置
 * 3. 確定資料庫系統
 * 4. 提示用戶輸入缺少的值
 * 5. 檢查現有文件並提示覆蓋確認
 * 6. 驗證並寫入配置
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
 * 建立並配置 init 命令
 */
export const initCommand = new Command('init')
  .description('Initialize dbcli configuration with .env parsing and interactive prompts')
  .option('--host <host>', 'Database host')
  .option('--port <port>', 'Database port')
  .option('--user <user>', 'Database user')
  .option('--password <password>', 'Database password')
  .option('--name <name>', 'Database name')
  .option('--system <system>', 'Database system (postgresql, mysql, mariadb)')
  .option('--permission <permission>', 'Permission level (query-only, read-write, admin)', 'query-only')
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
 * Init 命令的實際處理器
 */
async function initCommandHandler(
  options: Record<string, unknown>
): Promise<void> {
  // 1. 加載現有配置
  const existingConfig = await configModule.read('.dbcli')

  // 2. 判斷是否應該進入交互模式
  // 如果使用 --use-env-refs 且提供了所有 --env-* 選項，則自動進入非交互模式
  const isUsingEnvRefs = options.useEnvRefs
  const hasAllEnvOptions = isUsingEnvRefs &&
    options.envHost &&
    options.envPort &&
    options.envUser &&
    options.envPassword &&
    options.envDatabase

  // shouldPrompt: 是否應該提示用戶輸入？
  // - 如果 --no-interactive，則不提示
  // - 如果 --use-env-refs 且提供了所有 --env-*，則不提示
  // - 否則提示
  const shouldPrompt = !options.noInteractive && !hasAllEnvOptions

  // 3. 嘗試從 .env 解析資料庫配置
  let envConfig = null
  try {
    envConfig = parseEnvDatabase(process.env)
  } catch {
    if (shouldPrompt) {
      console.log(t('init.env_parse_note'))
    }
  }

  // 4. 確定資料庫系統
  let system = options.system || envConfig?.system || 'postgresql'

  // 在需要提示且沒有提供系統值時才提示
  if (shouldPrompt && !options.system && !envConfig?.system) {
    system = await promptUser.select(t('init.select_system'), [
      'postgresql',
      'mysql',
      'mariadb'
    ])
  }

  // 驗證系統值
  if (!['postgresql', 'mysql', 'mariadb'].includes(system)) {
    throw new Error(`Invalid database system: ${system}`)
  }

  const defaults = getDefaultsForSystem(system as 'postgresql' | 'mysql' | 'mariadb')

  // 4. 為每個連接參數收集值
  const connection: Partial<ConnectionConfig> = {
    system: system as 'postgresql' | 'mysql' | 'mariadb'
  }

  // 提前聲明 configForWrite（後面會被賦值）
  let configForWrite: ConnectionConfig

  // 如果使用 --use-env-refs，在交互模式下只詢問環境變量名稱
  // 否則詢問實際的連接值
  if (options.useEnvRefs && shouldPrompt) {
    // 環境變量引用模式：只詢問環境變量名稱，不詢問實際值
    let envHost = options.envHost || await promptUser.text(t('init.prompt_host'), 'DB_HOST')
    let envPort = options.envPort || await promptUser.text(t('init.prompt_port'), 'DB_PORT')
    let envUser = options.envUser || await promptUser.text(t('init.prompt_user'), 'DB_USER')
    let envPassword = options.envPassword || await promptUser.text(t('init.prompt_password'), 'DB_PASSWORD')
    let envDatabase = options.envDatabase || await promptUser.text(t('init.prompt_name'), 'DB_DATABASE')

    // 直接轉換為環境變量引用配置
    configForWrite = {
      system: connection.system as 'postgresql' | 'mysql' | 'mariadb',
      host: { $env: envHost } as any,
      port: { $env: envPort } as any,
      user: { $env: envUser } as any,
      password: { $env: envPassword } as any,
      database: { $env: envDatabase } as any
    }

    // 跳過後續的連接參數收集，直接進行選擇權限級別
    let permission = options.permission || 'query-only'

    if (shouldPrompt && !options.permission) {
      permission = await promptUser.select(t('init.prompt_permission'), [
        'query-only',
        'read-write',
        'admin'
      ])
    }

    // 驗證權限值
    if (!['query-only', 'read-write', 'admin'].includes(permission)) {
      throw new Error(`Invalid permission level: ${permission}`)
    }

    // 合併配置並保存
    const newConfig = configModule.merge(existingConfig, {
      connection: configForWrite,
      permission: permission as 'query-only' | 'read-write' | 'admin'
    })

    // 檢查現有文件並提示覆蓋確認
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

    // 跳過連接測試（因為只有環境變量引用，沒有實際的連接值）
    console.log('⏭️  Skipping connection test in env-ref mode')

    // 寫入配置
    await configModule.write('.dbcli', newConfig)
    console.log(t('init.config_saved'))
    return
  }

  // 正常模式：詢問實際的連接值
  // 主機名
  connection.host =
    options.host ||
    envConfig?.host ||
    (shouldPrompt
      ? await promptUser.text(t('init.prompt_host'), defaults.host || 'localhost')
      : defaults.host || 'localhost')

  // 埠號
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

  // 用戶名
  connection.user =
    options.user ||
    envConfig?.user ||
    (shouldPrompt
      ? await promptUser.text(t('init.prompt_user'))
      : '')

  // 當使用 --use-env-refs 時，可以不提供實際的連接值（會從環境變量讀取）
  // 否則非交互模式下必須提供這些值
  if (!connection.user && !shouldPrompt && !options.useEnvRefs) {
    throw new Error('Non-interactive mode requires --user option')
  }

  // 密碼
  connection.password =
    options.password ||
    envConfig?.password ||
    (shouldPrompt
      ? await promptUser.text(t('init.prompt_password'))
      : '')

  // 資料庫名稱
  connection.database =
    options.name ||
    envConfig?.database ||
    (shouldPrompt
      ? await promptUser.text(t('init.prompt_name'))
      : '')

  // 當使用 --use-env-refs 時，可以不提供實際的連接值（會從環境變量讀取）
  // 否則非交互模式下必須提供這些值
  if (!connection.database && !shouldPrompt && !options.useEnvRefs) {
    throw new Error('Non-interactive mode requires --name option')
  }

  // 5. 選擇權限級別
  let permission = options.permission || 'query-only'

  if (shouldPrompt && !options.permission) {
    permission = await promptUser.select(t('init.prompt_permission'), [
      'query-only',
      'read-write',
      'admin'
    ])
  }

  // 驗證權限值
  if (!['query-only', 'read-write', 'admin'].includes(permission)) {
    throw new Error(`Invalid permission level: ${permission}`)
  }

  // 6. 如果啟用 --use-env-refs（非交互模式），轉換為環境變量引用
  // 註：交互模式已在前面處理完並返回
  configForWrite = connection as ConnectionConfig

  if (options.useEnvRefs) {
    // 非交互模式下需要提供環境變量名稱
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
    permission: permission as 'query-only' | 'read-write' | 'admin'
  })

  // 7. 檢查現有文件並提示覆蓋確認
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

  // 8. 測試資料庫連接（除非 --skip-test 或使用 --use-env-refs）
  // 注：使用 --use-env-refs 時不進行連接測試，因為需要環境變量實際被設置
  if (!options.skipTest && !options.useEnvRefs) {
    console.log(t('init.connection_testing'))

    // 解析實際的連接參數（處理環境變量引用）
    // 在測試連接時需要實際的環境變量值，而不是空字符串
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

  // 9. 寫入配置
  await configModule.write('.dbcli', newConfig)
  console.log(t('init.config_saved'))
}
