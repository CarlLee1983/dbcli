import { Command } from 'commander'
import pkg from '../package.json'
import { initCommand } from './commands/init'
import { listCommand } from './commands/list'
import { schemaCommand } from './commands/schema'
import { queryCommand } from './commands/query'
import { insertCommand } from './commands/insert'
import { updateCommand } from './commands/update'
import { deleteCommand } from './commands/delete'
import { exportCommand } from './commands/export'
import { skillCommand } from './commands/skill'

const program = new Command()
  .name('dbcli')
  .description('Database CLI for AI agents')
  .version(pkg.version)
  .option('--config <path>', 'Path to .dbcli config file', '.dbcli')

// Register commands
program.addCommand(initCommand)
program.addCommand(listCommand)
program.addCommand(schemaCommand)

// Register query command
program
  .command('query <sql>')
  .description('Execute SQL query against the database')
  .option('--format <type>', 'Output format: table, json, csv', 'table')
  .option('--limit <number>', 'Limit result rows (overrides auto-limit)', undefined, parseInt)
  .option('--no-limit', 'Disable auto-limit in query-only mode')
  .action(async (sql: string, options: any) => {
    try {
      await queryCommand(sql, options)
    } catch (error) {
      console.error((error as Error).message)
      process.exit(1)
    }
  })

// Register insert command
program
  .command('insert <table>')
  .description('Insert data into database table')
  .option('--data <json>', 'JSON object to insert')
  .option('--dry-run', 'Show generated SQL without executing')
  .option('--force', 'Skip confirmation prompt')
  .action(async (table: string, options: any) => {
    try {
      await insertCommand(table, options)
    } catch (error) {
      console.error((error as Error).message)
      process.exit(1)
    }
  })

// Register update command
program
  .command('update <table>')
  .description('Update data in database table')
  .option('--where <condition>', 'WHERE clause (required, e.g. "id=1")')
  .option('--set <json>', 'JSON with fields to update (required, e.g. \'{"name":"Bob"}\')')
  .option('--dry-run', 'Show generated SQL without executing')
  .option('--force', 'Skip confirmation prompt')
  .action(async (table: string, options: any) => {
    try {
      await updateCommand(table, options)
    } catch (error) {
      console.error((error as Error).message)
      process.exit(1)
    }
  })

// Register delete command
program
  .command('delete <table>')
  .description('Delete data from database table (Admin-only)')
  .option('--where <condition>', 'WHERE clause (required, e.g. "id=1")')
  .option('--dry-run', 'Show generated SQL without executing')
  .option('--force', 'Skip confirmation prompt')
  .action(async (table: string, options: any) => {
    try {
      await deleteCommand(table, options)
    } catch (error) {
      console.error((error as Error).message)
      process.exit(1)
    }
  })

// Register export command
program
  .command('export <sql>')
  .description('Export query results to JSON or CSV format')
  .option(
    '--format <format>',
    'Output format: json or csv (required)',
    'json'
  )
  .option(
    '--output <path>',
    'Output file path (if omitted, write to stdout)',
    undefined
  )
  .action(async (sql: string, options: any) => {
    try {
      // Validate format before calling
      if (!options.format || !['json', 'csv'].includes(options.format)) {
        console.error('❌ Invalid format. Use --format json or --format csv')
        process.exit(1)
      }
      return exportCommand(sql, options)
    } catch (error) {
      console.error((error as Error).message)
      process.exit(1)
    }
  })

// Register skill command
program
  .command('skill')
  .description('Generate AI agent skill documentation (SKILL.md)')
  .option('--install <platform>', 'Install to platform directory (claude, gemini, copilot, cursor)')
  .option('--output <path>', 'Write skill to file instead of stdout')
  .action(async (options: any) => {
    try {
      await skillCommand(program, options)
    } catch (error) {
      console.error((error as Error).message)
      process.exit(1)
    }
  })

// Show help when no command provided
if (!process.argv.slice(2).length) {
  program.outputHelp()
}

program.parse(process.argv)

export default program
