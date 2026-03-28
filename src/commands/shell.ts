// src/commands/shell.ts
import { Command } from 'commander'
import { createInterface } from 'node:readline'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { configModule } from '../core/config'
import { AdapterFactory } from '../adapters/factory'
import { ReplEngine } from '../core/repl/repl-engine'
import { createCompleter } from '../core/repl/completer'
import type { ReplContext } from '../core/repl/types'
import type { DbcliConfig } from '../types'
import { t, t_vars } from '../i18n/message-loader'
import pc from 'picocolors'

const HISTORY_PATH = join(homedir(), '.dbcli_history')

export const shellCommand = new Command('shell')
  .description('Interactive database shell with auto-completion and syntax highlighting')
  .option('--sql', 'SQL-only mode (skip dbcli command parsing)')
  .action(async (options: { sql?: boolean }) => {
    // Issue 3 fix: get global --config option from parent command
    const globalOpts = shellCommand.optsWithGlobals?.() ?? {}
    const configPath = (globalOpts as any).config ?? '.dbcli'
    await runShell(options, configPath)
  })

export async function runShell(options: { sql?: boolean }, configPath: string): Promise<void> {
  // Load config
  let config: DbcliConfig
  try {
    config = await configModule.read(configPath)
  } catch {
    console.error(pc.red(t('shell.error_no_config')))
    process.exit(1)
  }

  // Connect to database
  const adapter = AdapterFactory.createAdapter(config.connection)
  try {
    await adapter.connect()
  } catch (error: any) {
    console.error(pc.red(t_vars('shell.error_connection_failed', { message: error.message })))
    process.exit(1)
  }

  // Build context from schema cache
  const schemaData = (config.schema ?? {}) as Record<string, unknown>
  const tableNames = Object.keys(schemaData)
  const columnsByTable: Record<string, string[]> = {}
  for (const [table, data] of Object.entries(schemaData)) {
    const tableData = data as any
    if (tableData?.columns && Array.isArray(tableData.columns)) {
      columnsByTable[table] = tableData.columns.map((c: any) => c.name)
    }
  }

  const context: ReplContext = {
    configPath,
    permission: config.permission,
    system: config.connection.system,
    tableNames,
    columnsByTable,
  }

  const engine = new ReplEngine(adapter, context, HISTORY_PATH, config)
  const complete = createCompleter(context)

  // Welcome message
  console.error(pc.bold(t_vars('shell.welcome', {
    system: config.connection.system,
    database: String(config.connection.database),
    host: String(config.connection.host),
    port: String(config.connection.port),
  })))
  console.error(pc.dim(t_vars('shell.welcome_permission', { permission: config.permission })))

  if (options.sql) {
    console.error(pc.dim(t('shell.sql_mode_hint')))
  }

  console.error('')

  // Create readline interface
  const rl = createInterface({
    input: process.stdin,
    output: process.stderr,
    prompt: pc.cyan(t('shell.prompt') + '> '),
    completer: (line: string) => complete(line),
    terminal: process.stdin.isTTY ?? false,
  })

  const continuationPrompt = pc.dim(t('shell.continuation_prompt') + '> ')

  rl.prompt()

  rl.on('line', async (line: string) => {
    const result = await engine.processInput(line)

    switch (result.action) {
      case 'quit':
        if (result.output) console.error(result.output)
        rl.close()
        return

      case 'clear':
        console.clear()
        break

      case 'multiline':
        rl.setPrompt(continuationPrompt)
        break

      case 'continue':
        if (result.output) {
          // Output structured data to stdout, messages to stderr
          console.log(result.output)
        }
        rl.setPrompt(pc.cyan(t('shell.prompt') + '> '))
        break
    }

    rl.prompt()
  })

  rl.on('close', async () => {
    console.error(pc.dim(t('shell.goodbye')))
    await engine.saveHistory()
    await adapter.disconnect()
    process.exit(0)
  })

  // Handle SIGINT (Ctrl+C) — cancel multiline, don't exit
  rl.on('SIGINT', () => {
    if (engine.isMultiline()) {
      console.error(pc.dim(t('shell.multiline_cancelled')))
      rl.setPrompt(pc.cyan(t('shell.prompt') + '> '))
    }
    rl.prompt()
  })
}
