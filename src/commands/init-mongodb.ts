/**
 * MongoDB init command implementation
 *
 * Extracted from init.ts to keep the SQL/Redis/Elasticsearch path and the
 * MongoDB path in separate files. Shares checkOverwrite/writeV2InitConfig
 * with init.ts via init-shared.ts to avoid a circular import.
 */

import { t, t_vars } from '@/i18n/message-loader'
import { configModule } from '@/core/config'
import { promptUser } from '@/utils/prompts'
import type { ConnectionConfig } from '@/types'
import { AdapterFactory, ConnectionError, type ConnectionOptions } from '@/adapters'
import {
  getProjectStoragePath,
  isGlobalConfigPath,
  migrateLegacyProjectEnvLocal,
  writeProjectBinding,
} from '@/core/config-binding'
import { checkOverwrite, writeV2InitConfig } from './init-shared'
import { mkdir } from 'node:fs/promises'

const VALID_PERMISSIONS = ['query-only', 'read-write', 'data-admin', 'admin'] as const

export async function handleMongoDBInit(ctx: {
  options: Record<string, unknown>
  configPath: string
  connectionName: string
  isV2Init: boolean
  // The existing v1 config blob. Strict DbcliConfig narrows away the
  // partial shapes used during init bootstrap; intentionally loose.

  existingConfig: any
  shouldPrompt: boolean
}): Promise<void> {
  const { options, configPath, connectionName, isV2Init, existingConfig } = ctx
  // Use TTY check for interactive prompts (Commander --no-interactive sets options.interactive=false)
  const isInteractive = options.interactive !== false && process.stdin.isTTY

  // Field-by-field is the primary path; a full URI is the advanced escape hatch.
  // See docs/adr/0002-mongodb-connection-field-first-config.md.
  const SETUP_MODES = ['逐欄填寫（建議）', '貼上完整連線字串（進階）'] as const
  const URI_MODE_INDEX = 1

  // Env-ref mode stores variable names instead of values, so it never asks for
  // the values themselves. It applies to the field path only — a full `uri`
  // carrying credentials is an existing hand-edited escape hatch.
  const useEnvRefs = Boolean(options.useEnvRefs)

  let mongoUri = options.uri as string | undefined
  // An explicit --uri keeps its existing non-interactive behaviour: no mode prompt.
  let useUriMode = Boolean(mongoUri)

  if (!mongoUri && isInteractive) {
    const mode = await promptUser.select('連線設定方式 / Connection setup', [...SETUP_MODES])
    useUriMode = mode === SETUP_MODES[URI_MODE_INDEX]

    while (useUriMode && !mongoUri) {
      const input = await promptUser.text(
        'MongoDB 連線字串 / connection string (mongodb://user:pass@host:27017/db)',
        ''
      )
      if (input.trim()) {
        mongoUri = input.trim()
      } else {
        // Empty input is not a valid URI config; fall back to the field path
        // rather than writing a connection with no host.
        console.log('未輸入連線字串，改用逐欄填寫。')
        useUriMode = false
      }
    }
  }

  const useFieldEnvRefs = useEnvRefs && !useUriMode
  if (useEnvRefs && useUriMode) {
    // Silently writing a plaintext URI under --use-env-refs would leave the user
    // believing their credentials were kept out of the config file.
    console.warn(
      '⚠️  --use-env-refs 不適用於完整連線字串：URI 會原樣寫入設定檔，帳密不會被抽成環境變數參照。'
    )
  }

  // Field-mode values. In env-ref mode these stay at their defaults — the
  // variable names are collected separately below.
  const fields = {
    host: (options.host as string) || 'localhost',
    port: parseInt((options.port as string) || '27017', 10),
    user: (options.user as string) || '',
    password: (options.password as string) || '',
    authSource: (options.authSource as string | undefined) || '',
    replicaSet: '',
    tls: undefined as boolean | undefined,
    srv: false,
  }

  /** Ask for a port until it parses, so NaN never reaches the config file. */
  const promptPort = async (fallback: number): Promise<number> => {
    for (;;) {
      const raw = await promptUser.text('Port（埠號）', String(fallback))
      const parsed = parseInt(raw, 10)
      if (Number.isInteger(parsed) && parsed > 0 && parsed <= 65535) return parsed
      console.log('請輸入 1-65535 的整數。')
    }
  }

  if (!useUriMode && isInteractive) {
    if (!useFieldEnvRefs) {
      fields.host = await promptUser.text('Host（主機位址）', fields.host)
    }
    fields.srv = await promptUser.confirm('這是 SRV 網域嗎（Atlas 等 mongodb+srv 連線）？')
    if (!fields.srv && !useFieldEnvRefs) {
      fields.port = await promptPort(fields.port)
    }
    if (!useFieldEnvRefs) {
      fields.user = await promptUser.text('User（帳號，無認證請留空）', fields.user)
      if (fields.user) {
        fields.password = await promptUser.text('Password（密碼）', fields.password)
        fields.authSource = await promptUser.text(
          'authSource（認證資料庫）',
          fields.authSource || 'admin'
        )
      }
    }
    if (await promptUser.confirm('設定進階選項（replicaSet / tls）？')) {
      fields.replicaSet = await promptUser.text('replicaSet（複本集名稱，可留空）', '')
      fields.tls = await promptUser.confirm('啟用 tls？')
    }
  }

  // Database name (required even in URI mode for schema cache labelling)
  let database = (options.name as string | undefined) || ''
  if (!database && isInteractive && !useFieldEnvRefs) {
    database = await promptUser.text('Database name', 'testdb')
  }

  /**
   * Resolve one env-ref field. An empty name means "this connection has no such
   * value" — writing {$env} for it would make every later command fail on an
   * undefined variable the user never intended to set.
   *
   * `suggestion` is only an interactive prompt default: a non-interactive run
   * with no flag must resolve to nothing, so a missing required flag is caught
   * rather than silently filled in.
   */
  const envRefFor = async (
    flag: unknown,
    label: string,
    suggestion: string
  ): Promise<{ $env: string } | null> => {
    const name =
      (flag as string | undefined) ??
      (isInteractive ? await promptUser.text(label, suggestion) : '')
    return name.trim() ? { $env: name.trim() } : null
  }

  let envRefConfig: Record<string, unknown> | null = null
  if (useFieldEnvRefs) {
    const hostRef = await envRefFor(options.envHost, 'Host 的環境變數名稱', 'MONGO_HOST')
    const portRef = await envRefFor(options.envPort, 'Port 的環境變數名稱（可留空）', '')
    const userRef = await envRefFor(options.envUser, 'User 的環境變數名稱（可留空）', '')
    const passwordRef = await envRefFor(
      options.envPassword,
      'Password 的環境變數名稱（可留空）',
      ''
    )
    const databaseRef = await envRefFor(
      options.envDatabase,
      'Database 的環境變數名稱（可留空）',
      ''
    )

    if (!hostRef) {
      throw new Error('--use-env-refs 需要 host 的環境變數名稱（--env-host）')
    }
    // The database env var is optional, so leaving it blank is a normal answer —
    // ask for the literal name instead of discarding every answer so far.
    if (!databaseRef && !database && isInteractive) {
      database = await promptUser.text('Database name', 'testdb')
    }
    if (!databaseRef && !database) {
      throw new Error(t('errors.require_name'))
    }

    envRefConfig = {
      system: 'mongodb' as const,
      host: hostRef,
      port: portRef ?? fields.port,
      user: userRef ?? '',
      password: passwordRef ?? '',
      database: databaseRef ?? database,
      ...(fields.authSource ? { authSource: fields.authSource } : {}),
      ...(fields.replicaSet ? { replicaSet: fields.replicaSet } : {}),
      ...(fields.tls !== undefined ? { tls: fields.tls } : {}),
      ...(fields.srv ? { srv: true } : {}),
    }
  }

  if (!database && !isInteractive && !useFieldEnvRefs) {
    throw new Error(t('errors.require_name'))
  }

  // Build connection config
  const mongoConfig =
    envRefConfig ??
    (useUriMode
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
          host: fields.host,
          port: fields.port,
          user: fields.user,
          password: fields.password,
          database,
          ...(fields.user ? { authSource: fields.authSource || 'admin' } : {}),
          ...(fields.replicaSet ? { replicaSet: fields.replicaSet } : {}),
          ...(fields.tls !== undefined ? { tls: fields.tls } : {}),
          ...(fields.srv ? { srv: true } : {}),
        })

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
  if (!(VALID_PERMISSIONS as readonly string[]).includes(permission)) {
    throw new Error(t_vars('errors.invalid_permission', { permission }))
  }

  // Overwrite check
  const canProceed = await checkOverwrite(configPath, isInteractive, !!options.force)
  if (!canProceed) return

  // Connection test. Env-ref mode holds variable names rather than values, so
  // there is nothing to connect with — same as the SQL path above.
  if (!options.skipTest && !useFieldEnvRefs) {
    console.log(t('init.connection_testing'))
    const mongoAdapter = AdapterFactory.createMongoDBAdapter(
      mongoConfig as unknown as ConnectionOptions
    )
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
    console.log(`⏭️  ${t(useFieldEnvRefs ? 'init.skip_test_env_ref' : 'init.skip_test')}`)
  }

  // Write config
  if (isV2Init) {
    await writeV2InitConfig(
      configPath,
      connectionName,
      mongoConfig as unknown as ConnectionConfig,
      permission,
      options.envFile as string | undefined
    )
    return
  }

  // Bridge between the hand-written ConnectionConfig in src/types and the
  // zod-derived shape in @/utils/validation that configModule.merge expects.
  const newConfig = configModule.merge(existingConfig, {
    connection: mongoConfig as any,
    permission: permission as 'query-only' | 'read-write' | 'data-admin' | 'admin',
  })
  const globalConfig = isGlobalConfigPath(configPath)
  const storagePath = globalConfig ? configPath : getProjectStoragePath(configPath)
  await mkdir(storagePath, { recursive: true })
  await configModule.write(storagePath, newConfig)
  if (!globalConfig) {
    await migrateLegacyProjectEnvLocal(configPath, storagePath)
    await writeProjectBinding(configPath, storagePath)
  }
  console.log(t('init.config_saved'))
}
