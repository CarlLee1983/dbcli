import { Command } from 'commander'
import pkg from '../package.json'
import { initCommand } from './commands/init'
import { listCommand } from './commands/list'
import { schemaCommand } from './commands/schema'

const program = new Command()
  .name('dbcli')
  .description('Database CLI for AI agents')
  .version(pkg.version)
  .option('--config <path>', 'Path to .dbcli config file', '.dbcli')

// Register commands
program.addCommand(initCommand)
program.addCommand(listCommand)
program.addCommand(schemaCommand)

// Show help when no command provided
if (!process.argv.slice(2).length) {
  program.outputHelp()
}

program.parse(process.argv)

export default program
