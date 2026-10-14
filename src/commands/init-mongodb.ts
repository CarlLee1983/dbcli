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
import { redactSecretsForDisplay } from '@/utils/redaction'
import type { ConnectionConfig } from '@/types'
import { AdapterFactory, ConnectionError, type ConnectionOptions } from '@/adapters'
import {
  getProjectStoragePath,
  isGlobalConfigPath,
  migrateLegacyProjectEnvLocal,
  writeProjectBinding,
} from '@/core/config-binding'
import {
  decomposeConnectionString,
  type DecomposeResult,
  type FallbackReason,
  type MongoFieldConfig,
} from '@/core/mongodb-connection-string'
import { checkOverwrite, writeV2InitConfig } from './init-shared'
import { mkdir } from 'node:fs/promises'

/** --uri 不能與這些欄位 flag 並用：兩邊都給時無從判斷哪邊生效。 */
const FIELD_FLAGS: ReadonlyArray<readonly [optionKey: string, flag: string]> = [
  ['host', '--host'],
  ['port', '--port'],
  ['user', '--user'],
  ['password', '--password'],
  ['authSource', '--auth-source'],
  ['replicaSet', '--replica-set'],
  ['srv', '--srv'],
]

function conflictingFieldFlags(options: Record<string, unknown>): string[] {
  const flags = FIELD_FLAGS.filter(([key]) => options[key] !== undefined).map(([, flag]) => flag)
  // Commander 兩種形式都宣告，所以只有使用者真的給了才會是 boolean
  if (options.tls !== undefined) flags.push(options.tls ? '--tls' : '--no-tls')
  return flags
}

function describeFallbackReasons(reasons: FallbackReason[]): string {
  return reasons
    .map((reason) => {
      switch (reason.type) {
        case 'multi-host':
          return t('init.mongo_uri_reason_multi_host')
        case 'secret-option':
          return t_vars('init.mongo_uri_reason_secret_option', { keys: reason.keys.join(', ') })
        case 'duplicate-key':
          return t_vars('init.mongo_uri_reason_duplicate_key', { keys: reason.keys.join(', ') })
        case 'non-scram-mechanism':
          return t_vars('init.mongo_uri_reason_non_scram', { mechanism: reason.mechanism })
      }
    })
    .join('; ')
}

/** 要寫入的連線設定；用 kind 區分來源，這樣取密碼時不必型別逃逸。 */
type BuiltMongoConfig =
  | { kind: 'env-ref'; config: Record<string, unknown> }
  | { kind: 'decomposed'; config: MongoFieldConfig }
  | { kind: 'uri-fallback'; config: { system: 'mongodb'; uri: string; database: string } }
  | { kind: 'fields'; config: Record<string, unknown> & { password: string } }

/** 連線測試失敗時要從終端訊息遮蔽的密碼；env-ref 只有變數名稱，沒有密碼。 */
function passwordOf(built: BuiltMongoConfig): string {
  switch (built.kind) {
    case 'env-ref':
    case 'uri-fallback':
      return ''
    case 'decomposed':
    case 'fields':
      return built.config.password
  }
}

/**
 * 列出實際會寫入的欄位。密碼依鍵直接輸出遮蔽標記（不對整行做子字串取代，
 * 免得密碼剛好等於帳號或某個 option 值時，連帶遮掉別的欄位）。
 */
function printDecomposed(config: MongoFieldConfig): void {
  const { options, ...fields } = config
  const mask = redactSecretsForDisplay(config.password, [config.password])
  const lines = [
    ...Object.entries(fields)
      .filter(([, value]) => value !== '')
      .map(([key, value]) => `  ${key}: ${key === 'password' ? mask : String(value)}`),
    ...Object.entries(options ?? {}).map(([key, value]) => `  options.${key}: ${value}`),
  ]
  console.log(t('init.mongo_decomposed_header'))
  for (const line of lines) console.log(line)
}

/**
 * 互動貼上連線字串：解析失敗時印出不含原字串的錯誤並再問一次。
 * 直接按 Enter 回傳 null，由呼叫端退回逐欄填寫。
 */
async function promptPastedConnectionString(): Promise<{
  decomposed: DecomposeResult
  connectionString: string
} | null> {
  for (;;) {
    // The string is credential-bearing by construction, so it is collected the
    // same way a password is rather than echoed into scrollback.
    const input = (
      await promptUser.secret(
        'MongoDB 連線字串 / connection string (mongodb://user:pass@host:27017/db)',
        { unavailable: t('init.secret_alternatives_mongo_uri') }
      )
    ).trim()
    if (!input) return null
    try {
      return { decomposed: decomposeConnectionString(input), connectionString: input }
    } catch (error) {
      // 錯誤訊息本來就不含原字串；仍過一次遮蔽，避免日後的訊息帶出帳密
      const message = error instanceof Error ? error.message : String(error)
      console.error(redactSecretsForDisplay(message, [input]))
    }
  }
}

const VALID_PERMISSIONS = ['query-only', 'read-write', 'data-admin', 'admin'] as const

/**
 * 欄位設定與 env-ref 設定共用的可選鍵：沒有值就不寫入。
 * SRV 記錄自帶埠號，所以 srv 時不寫 port。
 */
function optionalFieldKeys(fields: {
  port: number | { $env: string }
  authSource: string
  replicaSet: string
  tls: boolean | undefined
  srv: boolean
}): Record<string, unknown> {
  return {
    ...(fields.srv ? {} : { port: fields.port }),
    ...(fields.authSource ? { authSource: fields.authSource } : {}),
    ...(fields.replicaSet ? { replicaSet: fields.replicaSet } : {}),
    ...(fields.tls !== undefined ? { tls: fields.tls } : {}),
    ...(fields.srv ? { srv: true } : {}),
  }
}

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

  // Field-by-field is the primary path; pasting a connection string (Atlas / Compass) is the
  // second choice and is decomposed into fields too (ADR-0043).
  // See docs/adr/ADR-0002-mongodb-connection-field-first-config.md.
  const SETUP_MODES = ['逐欄填寫（建議）', t('init.mongo_setup_mode_paste')] as const
  const CONNECTION_STRING_MODE_INDEX = 1

  // Env-ref mode stores variable names instead of values, so it never asks for
  // the values themselves. It applies to the field path only — a connection string
  // carries its credentials, so --uri rejects it and a pasted string only warns.
  const useEnvRefs = Boolean(options.useEnvRefs)

  let mongoUri = options.uri as string | undefined
  // An explicit --uri keeps its existing non-interactive behaviour: no mode prompt.
  let useConnectionStringMode = Boolean(mongoUri)

  // 連線字串（--uri 旗標或互動貼上）寫入前先拆解（ADR-0043），兩條路徑共用同一套規則。
  let decomposed: DecomposeResult | null = null
  let pastedConnectionString = false
  if (options.uri) {
    const conflicts = conflictingFieldFlags(options)
    if (conflicts.length > 0) {
      throw new Error(t_vars('init.mongo_uri_conflicts_fields', { flags: conflicts.join(', ') }))
    }
    if (useEnvRefs) throw new Error(t('init.mongo_uri_with_env_refs'))
    decomposed = decomposeConnectionString(options.uri as string)
  }

  if (!mongoUri && isInteractive) {
    const mode = await promptUser.select('連線設定方式 / Connection setup', [...SETUP_MODES])
    useConnectionStringMode = mode === SETUP_MODES[CONNECTION_STRING_MODE_INDEX]

    if (useConnectionStringMode) {
      const pasted = await promptPastedConnectionString()
      if (pasted) {
        decomposed = pasted.decomposed
        mongoUri = pasted.connectionString
        pastedConnectionString = true
      } else {
        // Empty input is not a valid connection config; fall back to the field path
        // rather than writing a connection with no host.
        console.log('未輸入連線字串，改用逐欄填寫。')
        useConnectionStringMode = false
      }
    }
  }

  const useFieldEnvRefs = useEnvRefs && !useConnectionStringMode
  if (useEnvRefs && useConnectionStringMode) {
    // Silently writing plaintext credentials under --use-env-refs would leave the
    // user believing they were kept out of the config file.
    console.warn(t('init.mongo_paste_env_refs_warning'))
  }

  // Field-mode values. In env-ref mode these stay at their defaults — the
  // variable names are collected separately below.
  const fields = {
    host: (options.host as string) || 'localhost',
    port: parseInt((options.port as string) || '27017', 10),
    user: (options.user as string) || '',
    password: (options.password as string) || '',
    authSource: (options.authSource as string | undefined) || '',
    replicaSet: (options.replicaSet as string | undefined) || '',
    tls: options.tls as boolean | undefined,
    srv: Boolean(options.srv),
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

  if (!useConnectionStringMode && isInteractive) {
    if (!useFieldEnvRefs) {
      fields.host = await promptUser.text('Host（主機位址）', fields.host)
    }
    // An explicit --srv is kept as given and not asked again, like --password
    if (!fields.srv) {
      fields.srv = await promptUser.confirm('這是 SRV 網域嗎（Atlas 等 mongodb+srv 連線）？')
    }
    if (!fields.srv && !useFieldEnvRefs) {
      fields.port = await promptPort(fields.port)
    }
    if (!useFieldEnvRefs) {
      fields.user = await promptUser.text('User（帳號，無認證請留空）', fields.user)
      if (fields.user) {
        // An explicit --password is kept as given. Offering it back as a
        // prompt default would print the credential it was passed to hide.
        if (!fields.password) {
          fields.password = await promptUser.secret('Password（密碼）', {
            unavailable: t('init.secret_alternatives_mongo_password'),
          })
        }
        fields.authSource = await promptUser.text(
          'authSource（認證資料庫）',
          fields.authSource || 'admin'
        )
      }
    }
    // Only ask for the advanced values that no flag already supplied
    const needReplicaSet = !fields.replicaSet
    const needTls = fields.tls === undefined
    if (
      (needReplicaSet || needTls) &&
      (await promptUser.confirm('設定進階選項（replicaSet / tls）？'))
    ) {
      if (needReplicaSet) {
        fields.replicaSet = await promptUser.text('replicaSet（複本集名稱，可留空）', '')
      }
      if (needTls) fields.tls = await promptUser.confirm('啟用 tls？')
    }
  }

  if (
    !useConnectionStringMode &&
    fields.srv &&
    (useFieldEnvRefs ? options.envPort : options.port)
  ) {
    // Dropping a given port silently would leave the user thinking it took effect.
    console.warn(
      `⚠️  SRV 連線會忽略 ${useFieldEnvRefs ? '--env-port' : '--port'}：SRV 記錄自帶埠號，設定檔不會寫入 port。`
    )
  }

  // Database name (required even in connection-string mode for schema cache labelling)
  let database =
    (options.name as string | undefined) ||
    (decomposed?.kind === 'fields' ? decomposed.config.database : decomposed?.database) ||
    ''
  if (!database && isInteractive && useConnectionStringMode) {
    // 連線字串路徑沒有資料庫：必填且沒有預設值，避免誤連到 testdb 之類的測試庫
    while (!database) database = (await promptUser.text('Database name')).trim()
  } else if (!database && isInteractive && !useFieldEnvRefs) {
    database = await promptUser.text('Database name', 'testdb')
  }

  // 列出的內容要等於實際寫入的，所以在資料庫名稱確定（--name 覆蓋、提問）之後才印
  if (pastedConnectionString && decomposed?.kind === 'fields') {
    printDecomposed({ ...decomposed.config, database })
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
    // SRV records carry their own ports, so the answer would be discarded — don't ask
    const portRef = fields.srv
      ? null
      : await envRefFor(options.envPort, 'Port 的環境變數名稱（可留空）', '')
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
      user: userRef ?? '',
      password: passwordRef ?? '',
      database: databaseRef ?? database,
      ...optionalFieldKeys({ ...fields, port: portRef ?? fields.port }),
    }
  }

  if (!database && !isInteractive && !useFieldEnvRefs) {
    throw new Error(t('errors.require_name'))
  }

  const buildMongoConfig = (): BuiltMongoConfig => {
    if (envRefConfig) return { kind: 'env-ref', config: envRefConfig }
    if (decomposed?.kind === 'fields') {
      return { kind: 'decomposed', config: { ...decomposed.config, database } }
    }
    if (decomposed?.kind === 'uri') {
      return { kind: 'uri-fallback', config: { system: 'mongodb', uri: mongoUri!, database } }
    }
    return {
      kind: 'fields',
      config: {
        system: 'mongodb',
        host: fields.host,
        user: fields.user,
        password: fields.password,
        database,
        ...optionalFieldKeys({
          ...fields,
          authSource: fields.user ? fields.authSource || 'admin' : '',
        }),
      },
    }
  }
  const built = buildMongoConfig()
  const mongoConfig = built.config

  if (decomposed?.kind === 'uri') {
    console.warn(
      t_vars('init.mongo_uri_fallback_warning', {
        reasons: describeFallbackReasons(decomposed.reasons),
      })
    )
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
    // No blacklist yet — this runs while the connection is being created.
    const mongoAdapter = AdapterFactory.createMongoDBAdapter({
      connection: mongoConfig as unknown as ConnectionOptions,
    })
    try {
      await mongoAdapter.connect()
      await mongoAdapter.testConnection()
      console.log(t('init.connection_success'))
    } catch (error) {
      // The driver reproduces the resolved URI — credentials included — in its
      // own error text, so nothing from this path reaches the terminal raw.
      const safe = (text: string) =>
        redactSecretsForDisplay(
          text,
          [fields.password, passwordOf(built), mongoUri ?? ''].filter(Boolean)
        )
      if (error instanceof ConnectionError) {
        console.error(t_vars('errors.connection_failed', { message: safe(error.message) }))
        console.error(t('init.connection_hints'))
        error.hints.forEach((hint) => console.error(`  • ${safe(hint)}`))
        process.exit(1)
      }
      throw new Error(safe(error instanceof Error ? error.message : String(error)))
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
