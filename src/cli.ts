import { Command } from 'commander'
import pkg from '../package.json'
import { initCommand } from './commands/init'

const program = new Command()
  .name('dbcli')
  .description('Database CLI for AI agents')
  .version(pkg.version)
  .option('--config <path>', 'Path to .dbcli config file', '.dbcli')

// Register commands
program.addCommand(initCommand)

// Show help when no command provided
if (!process.argv.slice(2).length) {
  program.outputHelp()
}

program.parse(process.argv)

export default program
