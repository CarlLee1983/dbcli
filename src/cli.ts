import { Command } from 'commander'
import pkg from '../package.json'
import { t } from './i18n/message-loader'
import { createLogger, setGlobalLogger, LogLevel } from './utils/logger'
import { initCommand } from './commands/init'
import { listCommand } from './commands/list'
import { schemaCommand } from './commands/schema'
import { queryCommand } from './commands/query'
import { insertCommand } from './commands/insert'
import { updateCommand } from './commands/update'
import { deleteCommand } from './commands/delete'
import { exportCommand } from './commands/export'
import { skillCommand } from './commands/skill'
import { blacklistCommand } from './commands/blacklist'
import { checkCommand } from './commands/check'
import { diffCommand } from './commands/diff'
import { statusCommand } from './commands/status'
import { doctorCommand } from './commands/doctor'

const program = new Command()
  .name('dbcli')
  .description('Database CLI for AI agents')
  .version(pkg.version)
  .option('--no-color', 'Disable colored output')
  .option('-v, --verbose', 'Increase verbosity (-v verbose, -vv debug)', (_, prev) => prev + 1, 0)
  .option('-q, --quiet', 'Suppress non-essential output')
  .option('--config <path>', 'Path to .dbcli config file', '.dbcli')

program.hook('preAction', (thisCommand) => {
  const opts = thisCommand.opts()

  // Handle --no-color: set env var before picocolors reads it
  if (opts.color === false) {
    process.env.NO_COLOR = '1'
  }

  // Handle -q / -v / -vv
  let level = LogLevel.NORMAL
  if (opts.quiet) {
    level = LogLevel.QUIET
  } else if (opts.verbose >= 2) {
    level = LogLevel.DEBUG
  } else if (opts.verbose >= 1) {
    level = LogLevel.VERBOSE
  }

  setGlobalLogger(createLogger(level))
})

// Register commands
program.addCommand(initCommand)
program.addCommand(listCommand)
program.addCommand(schemaCommand)

// Register query command
program
  .command('query <sql>')
  .description(t('query.description'))
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
  .description(t('insert.description'))
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
  .description(t('update.description'))
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
  .description(t('delete.description'))
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
  .description(t('export.description'))
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
  .description(t('skill.description'))
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

// Register blacklist command
program.addCommand(blacklistCommand)

// Register check command
program.addCommand(checkCommand)

// Register diff command
program.addCommand(diffCommand)

// Register status command
program.addCommand(statusCommand)
program.addCommand(doctorCommand)

// Show help when no command provided
if (!process.argv.slice(2).length) {
  program.outputHelp()
}

program.parse(process.argv)

export default program
