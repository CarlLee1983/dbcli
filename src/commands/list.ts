/**
 * dbcli list command
 * Lists all database tables and their metadata
 * Supports table (default) and JSON output formats
 */

import { Command } from 'commander'
import { t, t_vars } from '@/i18n/message-loader'
import { AdapterFactory, ConnectionError } from '@/adapters'
import { TableListFormatter, JSONFormatter } from '@/formatters'
import { configModule } from '@/core/config'

export const listCommand = new Command()
  .name('list')
  .description('List all tables in the database with metadata')
  .option(
    '--format <format>',
    'Output format: table (default) or json',
    'table'
  )
  .option(
    '--config <path>',
    'Path to .dbcli config file',
    '.dbcli'
  )
  .action(listAction)

/**
 * List command action handler
 * Connects to the database, retrieves the table list, and formats output
 */
async function listAction(options: { format: string; config: string }) {
  try {
    // Load configuration from .dbcli
    const config = await configModule.read(options.config)

    if (!config.connection) {
      console.error('Database not configured. Run: dbcli init')
      process.exit(1)
    }

    // Create adapter from configuration
    const adapter = AdapterFactory.createAdapter(config.connection)

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
        const listOutput = tables.map(t => ({
          name: t.name,
          columnCount: t.columnCount ?? t.columns.length,
          rowCount: t.rowCount ?? 0,
          engine: t.engine,
          estimatedRowCount: t.estimatedRowCount ?? t.rowCount ?? 0,
          tableType: t.tableType ?? 'table'
        }))
        console.log(JSON.stringify(listOutput, null, 2))
      } else {
        const formatter = new TableListFormatter()
        console.log(formatter.format(tables))
      }

      // Summary
      const tableCount = tables.filter(t => (t as any).tableType !== 'view').length
      const viewCount = tables.filter(t => (t as any).tableType === 'view').length
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
