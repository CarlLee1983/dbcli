import { Command } from 'commander'
import pkg from '../package.json'
import { initCommand } from './commands/init'
import { listCommand } from './commands/list'
import { schemaCommand } from './commands/schema'
import { queryCommand } from './commands/query'

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

// Show help when no command provided
if (!process.argv.slice(2).length) {
  program.outputHelp()
}

program.parse(process.argv)

export default program
