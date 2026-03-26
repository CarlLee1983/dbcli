/**
 * dbcli blacklist command
 * Manage sensitive data blacklist to prevent AI agents from accessing restricted tables and columns
 */

import { Command } from 'commander'
import { t, t_vars } from '@/i18n/message-loader'
import { configModule } from '@/core/config'
import type { BlacklistConfig } from '@/types/blacklist'

/** Default config path */
const DEFAULT_CONFIG_PATH = '.dbcli'

/** Valid table name regex (alphanumeric + underscore) */
const VALID_TABLE_NAME = /^[a-zA-Z_][a-zA-Z0-9_]*$/

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
export function parseColumnIdentifier(identifier: string): { table: string; column: string } | null {
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
export function getOrInitBlacklist(config: any): BlacklistConfig {
  if (!config.blacklist) {
    return { tables: [], columns: {} }
  }
  return {
    tables: Array.isArray(config.blacklist.tables) ? [...config.blacklist.tables] : [],
    columns: config.blacklist.columns ? { ...config.blacklist.columns } : {}
  }
}

/**
 * blacklist list subcommand
 * Displays current blacklist configuration
 */
export async function blacklistList(configPath: string): Promise<void> {
  const config = await configModule.read(configPath)
  const blacklist = getOrInitBlacklist(config)

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
    tables: [...blacklist.tables, tableName]
  }

  await configModule.write(configPath, { ...config, blacklist: newBlacklist } as any)
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
    tables: blacklist.tables.filter(t => t !== tableName)
  }

  await configModule.write(configPath, { ...config, blacklist: newBlacklist } as any)
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
      [table]: [...existingCols, column]
    }
  }

  await configModule.write(configPath, { ...config, blacklist: newBlacklist } as any)
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

  const updatedCols = existingCols.filter(c => c !== column)
  const newColumns = { ...blacklist.columns }

  if (updatedCols.length === 0) {
    delete newColumns[table]
  } else {
    newColumns[table] = updatedCols
  }

  const newBlacklist: BlacklistConfig = {
    ...blacklist,
    columns: newColumns
  }

  await configModule.write(configPath, { ...config, blacklist: newBlacklist } as any)
  console.log(t_vars('blacklist.column_removed', { table, column }))
}

// ─── Command builder ─────────────────────────────────────────────────────────

const blacklistCommand = new Command('blacklist')
  .description(t('blacklist.description'))

// blacklist list
blacklistCommand
  .command('list')
  .description(t('blacklist.list_title'))
  .option('--config <path>', 'Path to .dbcli config file', DEFAULT_CONFIG_PATH)
  .action(async (options: any) => {
    try {
      await blacklistList(options.config || DEFAULT_CONFIG_PATH)
    } catch (error) {
      console.error((error as Error).message)
      process.exit(1)
    }
  })

// blacklist table <subcommand>
const tableCmd = blacklistCommand.command('table').description(t('blacklist.tables_label'))

tableCmd
  .command('add <table>')
  .description('Add table to blacklist')
  .option('--config <path>', 'Path to .dbcli config file', DEFAULT_CONFIG_PATH)
  .action(async (tableName: string, options: any) => {
    try {
      await blacklistTableAdd(tableName, options.config || DEFAULT_CONFIG_PATH)
    } catch (error) {
      console.error((error as Error).message)
      process.exit(1)
    }
  })

tableCmd
  .command('remove <table>')
  .description('Remove table from blacklist')
  .option('--config <path>', 'Path to .dbcli config file', DEFAULT_CONFIG_PATH)
  .action(async (tableName: string, options: any) => {
    try {
      await blacklistTableRemove(tableName, options.config || DEFAULT_CONFIG_PATH)
    } catch (error) {
      console.error((error as Error).message)
      process.exit(1)
    }
  })

// blacklist column <subcommand>
const columnCmd = blacklistCommand.command('column').description(t('blacklist.columns_label'))

columnCmd
  .command("add <table.column>")
  .description('Add column to blacklist (format: table.column)')
  .option('--config <path>', 'Path to .dbcli config file', DEFAULT_CONFIG_PATH)
  .action(async (identifier: string, options: any) => {
    try {
      await blacklistColumnAdd(identifier, options.config || DEFAULT_CONFIG_PATH)
    } catch (error) {
      console.error((error as Error).message)
      process.exit(1)
    }
  })

columnCmd
  .command("remove <table.column>")
  .description('Remove column from blacklist (format: table.column)')
  .option('--config <path>', 'Path to .dbcli config file', DEFAULT_CONFIG_PATH)
  .action(async (identifier: string, options: any) => {
    try {
      await blacklistColumnRemove(identifier, options.config || DEFAULT_CONFIG_PATH)
    } catch (error) {
      console.error((error as Error).message)
      process.exit(1)
    }
  })

export { blacklistCommand }
