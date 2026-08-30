/**
 * dbcli blacklist command
 * Manage sensitive data blacklist to prevent AI agents from accessing restricted tables and columns
 */

import { isV2Config, patchBlacklist } from '@/core/config-v2'
import { Command } from 'commander'
import { t, t_vars } from '@/i18n/message-loader'
import { configModule } from '@/core/config'
import type { BlacklistConfig } from '@/types/blacklist'
import { compilePatterns } from '@/core/mongo/path-matcher'
import { validateFormat } from '@/utils/validation'

export interface BlacklistAudit {
  warnings: Array<{ collection: string; raw: string; reason: string }>
}

export type BlacklistListFormat = 'text' | 'json'

export interface BlacklistListJson {
  tables: string[]
  columns: Record<string, string[]>
  warnings: BlacklistAudit['warnings']
}

export function auditBlacklistPatterns(cfg: BlacklistConfig): BlacklistAudit {
  const warnings: BlacklistAudit['warnings'] = []
  for (const [collection, raw] of Object.entries(cfg.columns ?? {})) {
    const { rejected } = compilePatterns(raw)
    for (const r of rejected) warnings.push({ collection, raw: r.raw, reason: r.reason })
  }
  return { warnings }
}

/** Default config path */
const DEFAULT_CONFIG_PATH = '.dbcli'

/**
 * 黑名單條目允許的字元。
 *
 * 原本是 `^[a-zA-Z_][a-zA-Z0-9_]*$`——SQL 識別字的形狀。那條規則拒絕了幾乎
 * 所有合法的 Elasticsearch index 名（`my-index`、`logs-2026.08.30`、`.kibana`）
 * 以及使用者文件在 Redis 那側明文教的 glob（`secrets:*`），於是
 * `dbcli blacklist table add` 對這兩種連線不可用，使用者只能手編設定檔——
 * 而手編正是最容易把條目寫成 glob 的路徑。一個把人推去繞過自己的驗證規則，
 * 比沒有驗證更糟。
 *
 * 仍然拒絕的是**會靜靜變成別的意思**的形狀：逗號（條目會被展開成多個目標，
 * 一次加一個才說得清楚）、路徑分隔、空白。
 */
const VALID_TABLE_NAME = /^[a-zA-Z0-9_.*?:@[\]-]+$/

/** Valid column name regex (alphanumeric + underscore) */
const VALID_COLUMN_NAME = /^[a-zA-Z_][a-zA-Z0-9_]*$/

/**
 * Validate table name format
 */
export function isValidTableName(name: string): boolean {
  return VALID_TABLE_NAME.test(name)
}

/**
 * Validate column identifier format: "table.column"
 */
export function parseColumnIdentifier(
  identifier: string
): { table: string; column: string } | null {
  const parts = identifier.split('.')
  if (parts.length !== 2) {
    return null
  }
  const [table, column] = parts
  if (!table || !column) {
    return null
  }
  if (!VALID_TABLE_NAME.test(table) || !VALID_COLUMN_NAME.test(column)) {
    return null
  }
  return { table, column }
}

/**
 * Get or initialize blacklist config from DbcliConfig
 */
export function getOrInitBlacklist(config: {
  blacklist?: { tables?: string[]; columns?: Record<string, string[]> }
}): BlacklistConfig {
  if (!config.blacklist) {
    return { tables: [], columns: {} }
  }
  return {
    tables: Array.isArray(config.blacklist.tables) ? [...config.blacklist.tables] : [],
    columns: config.blacklist.columns ? { ...config.blacklist.columns } : {},
  }
}

/**
 * blacklist list subcommand
 * Displays current blacklist configuration
 */
export async function blacklistList(
  configPath: string,
  format: BlacklistListFormat = 'text'
): Promise<void> {
  const config = await configModule.read(configPath)
  const blacklist = getOrInitBlacklist(config)
  const audit = auditBlacklistPatterns(blacklist)

  if (format === 'json') {
    const result: BlacklistListJson = {
      tables: blacklist.tables,
      columns: blacklist.columns,
      warnings: audit.warnings,
    }
    console.log(JSON.stringify(result, null, 2))
    return
  }

  console.log(t('blacklist.list_title'))
  console.log('─'.repeat(40))

  if (blacklist.tables.length === 0 && Object.keys(blacklist.columns).length === 0) {
    console.log(t('blacklist.none'))
    return
  }

  if (blacklist.tables.length > 0) {
    console.log(`${t('blacklist.tables_label')}: [${blacklist.tables.join(', ')}]`)
  } else {
    console.log(`${t('blacklist.tables_label')}: []`)
  }

  const columnEntries = Object.entries(blacklist.columns)
  if (columnEntries.length > 0) {
    const formatted = columnEntries.map(([tbl, cols]) => `${tbl}=[${cols.join(', ')}]`).join(', ')
    console.log(`${t('blacklist.columns_label')}: ${formatted}`)
  } else {
    console.log(`${t('blacklist.columns_label')}: {}`)
  }

  for (const w of audit.warnings) {
    console.error(
      `⚠  blacklist.columns["${w.collection}"]: '${w.raw}' is ignored on mongo connections (${w.reason}).`
    )
  }
}

/**
 * 把新的 blacklist 寫回設定，不破壞設定的形狀。
 *
 * v1 走既有的整包覆寫；v2 只 patch 頂層 `blacklist`。先前一律走前者，而
 * `configModule.read()` 對 v2 回傳的是選中連線的扁平化 v1 形狀——於是「加一條
 * blacklist」會把多連線設定壓成單一連線，預設 permission 變成當時 `--use` 的
 * 那一條。加黑名單不該改動任何連線的 tier。
 */
async function persistBlacklist(
  configPath: string,
  config: Parameters<typeof configModule.write>[1],
  blacklist: BlacklistConfig
): Promise<void> {
  if (await isV2Config(configPath)) {
    await patchBlacklist(configPath, blacklist)
    return
  }
  await configModule.write(configPath, { ...config, blacklist })
}

/**
 * blacklist table add <table> subcommand
 * Throws Error on validation failure (caller handles exit)
 */
export async function blacklistTableAdd(tableName: string, configPath: string): Promise<void> {
  if (!isValidTableName(tableName)) {
    throw new Error(t_vars('errors.invalid_table_name', { table: tableName }))
  }

  const config = await configModule.read(configPath)
  const blacklist = getOrInitBlacklist(config)

  if (blacklist.tables.includes(tableName)) {
    throw new Error(t_vars('errors.table_already_blacklisted', { table: tableName }))
  }

  const newBlacklist: BlacklistConfig = {
    ...blacklist,
    tables: [...blacklist.tables, tableName],
  }

  await persistBlacklist(configPath, config, newBlacklist)
  console.log(t_vars('blacklist.table_added', { table: tableName }))
}

/**
 * blacklist table remove <table> subcommand
 * Throws Error on validation failure (caller handles exit)
 */
export async function blacklistTableRemove(tableName: string, configPath: string): Promise<void> {
  if (!isValidTableName(tableName)) {
    throw new Error(t_vars('errors.invalid_table_name', { table: tableName }))
  }

  const config = await configModule.read(configPath)
  const blacklist = getOrInitBlacklist(config)

  if (!blacklist.tables.includes(tableName)) {
    throw new Error(t_vars('errors.table_not_in_blacklist', { table: tableName }))
  }

  const newBlacklist: BlacklistConfig = {
    ...blacklist,
    tables: blacklist.tables.filter((t) => t !== tableName),
  }

  await persistBlacklist(configPath, config, newBlacklist)
  console.log(t_vars('blacklist.table_removed', { table: tableName }))
}

/**
 * blacklist column add <table>.<column> subcommand
 * Throws Error on validation failure (caller handles exit)
 */
export async function blacklistColumnAdd(identifier: string, configPath: string): Promise<void> {
  const parsed = parseColumnIdentifier(identifier)
  if (!parsed) {
    throw new Error(t('errors.invalid_column_format'))
  }

  const { table, column } = parsed
  const config = await configModule.read(configPath)
  const blacklist = getOrInitBlacklist(config)

  const existingCols = blacklist.columns[table] || []
  if (existingCols.includes(column)) {
    throw new Error(t_vars('errors.column_already_blacklisted', { table, column }))
  }

  const newBlacklist: BlacklistConfig = {
    ...blacklist,
    columns: {
      ...blacklist.columns,
      [table]: [...existingCols, column],
    },
  }

  await persistBlacklist(configPath, config, newBlacklist)
  console.log(t_vars('blacklist.column_added', { table, column }))
}

/**
 * blacklist column remove <table>.<column> subcommand
 * Throws Error on validation failure (caller handles exit)
 */
export async function blacklistColumnRemove(identifier: string, configPath: string): Promise<void> {
  const parsed = parseColumnIdentifier(identifier)
  if (!parsed) {
    throw new Error(t('errors.invalid_column_format'))
  }

  const { table, column } = parsed
  const config = await configModule.read(configPath)
  const blacklist = getOrInitBlacklist(config)

  const existingCols = blacklist.columns[table] || []
  if (!existingCols.includes(column)) {
    throw new Error(t_vars('errors.column_not_in_blacklist', { table, column }))
  }

  const updatedCols = existingCols.filter((c) => c !== column)
  const newColumns = { ...blacklist.columns }

  if (updatedCols.length === 0) {
    delete newColumns[table]
  } else {
    newColumns[table] = updatedCols
  }

  const newBlacklist: BlacklistConfig = {
    ...blacklist,
    columns: newColumns,
  }

  await persistBlacklist(configPath, config, newBlacklist)
  console.log(t_vars('blacklist.column_removed', { table, column }))
}

// ─── Command builder ─────────────────────────────────────────────────────────

const blacklistCommand = new Command('blacklist').description(t('blacklist.description'))

// blacklist list
blacklistCommand
  .command('list')
  .description(t('blacklist.list_title'))
  .option('--config <path>', 'Path to .dbcli config file')
  .option('--format <type>', 'Output format: text, json', 'text')
  .action(async (options: Record<string, unknown>, command: unknown) => {
    try {
      const format = (options.format as string) || 'text'
      validateFormat(format, ['text', 'json'], 'blacklist list')
      await blacklistList(
        resolveBlacklistConfigPath(options, command as never),
        format as BlacklistListFormat
      )
    } catch (error) {
      console.error((error as Error).message)
      process.exit(1)
    }
  })

/**
 * 子指令的 `--config`，其次是根層的 `--config`，最後才是預設值。
 *
 * 每個子指令原本自己宣告了一個**帶預設值**的 `--config`，於是 commander 永遠
 * 給得出一個值，根層的那個因此完全不生效：`dbcli --config /path blacklist
 * table add x` 會改到 `.dbcli` 而不是 `/path`，然後回報成功。一個寫錯對象
 * 卻宣稱成功的設定指令，比失敗更糟——使用者會相信保護已經生效。
 */
function resolveBlacklistConfigPath(
  options: Record<string, unknown>,
  command: { parent?: { opts: () => Record<string, unknown> } | null } | undefined
): string {
  if (typeof options.config === 'string' && options.config.length > 0) return options.config
  let node = command?.parent
  while (node) {
    const rootConfig = node.opts?.().config
    if (typeof rootConfig === 'string' && rootConfig.length > 0) return rootConfig
    node = (node as { parent?: typeof node }).parent ?? undefined
  }
  return DEFAULT_CONFIG_PATH
}

// blacklist table <subcommand>
const tableCmd = blacklistCommand.command('table').description(t('blacklist.tables_label'))

tableCmd
  .command('add <table>')
  .description('Add table to blacklist')
  .option('--config <path>', 'Path to .dbcli config file')
  .action(async (tableName: string, options: Record<string, unknown>, command: unknown) => {
    try {
      await blacklistTableAdd(tableName, resolveBlacklistConfigPath(options, command as never))
    } catch (error) {
      console.error((error as Error).message)
      process.exit(1)
    }
  })

tableCmd
  .command('remove <table>')
  .description('Remove table from blacklist')
  .option('--config <path>', 'Path to .dbcli config file')
  .action(async (tableName: string, options: Record<string, unknown>, command: unknown) => {
    try {
      await blacklistTableRemove(tableName, resolveBlacklistConfigPath(options, command as never))
    } catch (error) {
      console.error((error as Error).message)
      process.exit(1)
    }
  })

// blacklist column <subcommand>
const columnCmd = blacklistCommand.command('column').description(t('blacklist.columns_label'))

columnCmd
  .command('add <table.column>')
  .description('Add column to blacklist (format: table.column)')
  .option('--config <path>', 'Path to .dbcli config file')
  .action(async (identifier: string, options: Record<string, unknown>, command: unknown) => {
    try {
      await blacklistColumnAdd(identifier, resolveBlacklistConfigPath(options, command as never))
    } catch (error) {
      console.error((error as Error).message)
      process.exit(1)
    }
  })

columnCmd
  .command('remove <table.column>')
  .description('Remove column from blacklist (format: table.column)')
  .option('--config <path>', 'Path to .dbcli config file')
  .action(async (identifier: string, options: Record<string, unknown>, command: unknown) => {
    try {
      await blacklistColumnRemove(identifier, resolveBlacklistConfigPath(options, command as never))
    } catch (error) {
      console.error((error as Error).message)
      process.exit(1)
    }
  })

export { blacklistCommand }
