/**
 * dbcli list command
 * Lists all database tables and their metadata
 * Supports table (default) and JSON output formats
 */

import { Command } from 'commander'
import { t, t_vars } from '@/i18n/message-loader'
import { AdapterFactory, ConnectionError, type ConnectionOptions } from '@/adapters'
import { TableListFormatter } from '@/formatters'
import { configModule } from '@/core/config'
import { resolveConfigPath } from '@/utils/config-path'
import { validateFormat } from '@/utils/validation'

const ALLOWED_FORMATS = ['table', 'json'] as const

export const listCommand = new Command()
  .name('list')
  .description('List all tables in the database with metadata')
  .option('--format <format>', 'Output format: table (default) or json', 'table')
  .option('--config <path>', 'Path to .dbcli config file', '.dbcli')
  .option(
    '--include-system',
    'Elasticsearch only: include system indices whose names start with dot',
    false
  )
  .action(listAction)

/**
 * List command action handler
 * Connects to the database, retrieves the table list, and formats output
 */
async function listAction(
  options: { format: string; config: string; includeSystem?: boolean },
  command: Command
) {
  try {
    validateFormat(options.format, ALLOWED_FORMATS, 'list')

    // Load configuration from .dbcli
    const config = await configModule.read(resolveConfigPath(command, options))

    if (!config.connection) {
      console.error('Database not configured. Run: dbcli init')
      process.exit(1)
    }

    // MongoDB: use QueryableAdapter path for collections
    if (config.connection.system === 'mongodb') {
      return mongoListBranch(config, options.format)
    }

    // Redis: keys instead of tables, scoped through the QueryableAdapter
    if (config.connection.system === 'redis') {
      return redisListBranch(config, options.format)
    }

    // Elasticsearch branch
    if (config.connection.system === 'elasticsearch') {
      return elasticsearchListBranch(config, options.format, options.includeSystem === true)
    }

    // Create adapter from configuration
    const adapter = AdapterFactory.createAdapter(config.connection as ConnectionOptions)

    // Connect to the database
    await adapter.connect()

    try {
      // Retrieve table list
      const tables = await adapter.listTables()

      if (tables.length === 0) {
        console.log(t('list.no_tables'))
        return
      }

      // Format output based on --format option
      if (options.format === 'json') {
        // Compact list output: use columnCount instead of empty columns array
        const listOutput = tables.map((t) => ({
          name: t.name,
          columnCount: t.columnCount ?? t.columns.length,
          rowCount: t.rowCount ?? 0,
          engine: t.engine,
          estimatedRowCount: t.estimatedRowCount ?? t.rowCount ?? 0,
          tableType: t.tableType ?? 'table',
        }))
        console.log(JSON.stringify(listOutput, null, 2))
      } else {
        const formatter = new TableListFormatter()
        console.log(formatter.format(tables))
      }

      // Summary
      const tableCount = tables.filter((t) => t.tableType !== 'view').length
      const viewCount = tables.filter((t) => t.tableType === 'view').length
      const viewSuffix = viewCount > 0 ? ` (${viewCount} views)` : ''
      console.log(`\n\u2713 Found ${tableCount} tables${viewSuffix}`)
    } finally {
      await adapter.disconnect()
    }
  } catch (error) {
    if (error instanceof Error) {
      console.error(t_vars('errors.message', { message: error.message }))
      if (error instanceof ConnectionError) {
        error.hints.forEach((hint: string) => console.error(`   Hint: ${hint}`))
      }
    }
    process.exit(1)
  }
}

async function mongoListBranch(
  config: import('@/utils/validation').DbcliConfig,
  format: string
): Promise<void> {
  const connName = (config.connection.database as string) || 'mongodb'

  const mongoAdapter = AdapterFactory.createMongoDBAdapter(config.connection as ConnectionOptions)
  await mongoAdapter.connect()

  try {
    const collections = await mongoAdapter.listCollections()

    if (collections.length === 0) {
      console.log('No collections found in this database.')
      return
    }

    if (format === 'json') {
      console.log(JSON.stringify(collections, null, 2))
    } else {
      console.log(`Collections in ${connName} (mongodb):`)
      for (const col of collections) {
        const nameCol = col.name.padEnd(20)
        const countStr =
          col.documentCount != null ? ` (est. ${col.documentCount.toLocaleString()} docs)` : ''
        console.log(`  ${nameCol}${countStr}`)
      }
      console.log(`\n✓ Found ${collections.length} collections`)
    }
  } finally {
    await mongoAdapter.disconnect()
  }
}

async function redisListBranch(
  config: import('@/utils/validation').DbcliConfig,
  format: string
): Promise<void> {
  const connName = (config.connection.database as string) || '0'
  const redisAdapter = AdapterFactory.createRedisAdapter(config.connection as ConnectionOptions)
  await redisAdapter.connect()

  try {
    const keys = await redisAdapter.listCollections()

    if (keys.length === 0) {
      console.log('No keys found in this Redis database.')
      return
    }

    if (format === 'json') {
      console.log(JSON.stringify(keys, null, 2))
    } else {
      console.log(`Keys in db ${connName} (redis):`)
      for (const k of keys) {
        console.log(`  ${k.name}`)
      }
      console.log(`\n✓ Found ${keys.length} keys`)
    }
  } finally {
    await redisAdapter.disconnect()
  }
}

async function elasticsearchListBranch(
  config: import('@/utils/validation').DbcliConfig,
  format: string,
  includeSystem: boolean
): Promise<void> {
  const esAdapter = AdapterFactory.createElasticsearchAdapter(
    config.connection as ConnectionOptions
  )
  await esAdapter.connect()

  try {
    if (!esAdapter.listTables)
      throw new Error('Elasticsearch adapter does not implement listTables')
    const tables = await esAdapter.listTables({ includeSystem })

    if (tables.length === 0) {
      console.log('No indices found in this Elasticsearch cluster.')
      return
    }

    if (format === 'json') {
      console.log(JSON.stringify(tables, null, 2))
    } else {
      console.log('Indices in elasticsearch:')
      for (const table of tables) {
        const type = table.tableType === 'view' ? 'alias' : 'index'
        const count =
          table.estimatedRowCount != null
            ? ` (${table.estimatedRowCount.toLocaleString()} docs)`
            : ''
        console.log(`  ${table.name.padEnd(24)} ${type}${count}`)
      }
      const indexCount = tables.filter((table) => table.tableType !== 'view').length
      const aliasCount = tables.filter((table) => table.tableType === 'view').length
      const aliasSuffix = aliasCount > 0 ? ` (${aliasCount} aliases)` : ''
      console.log(`\n✓ Found ${indexCount} indices${aliasSuffix}`)
    }
  } finally {
    await esAdapter.disconnect()
  }
}
