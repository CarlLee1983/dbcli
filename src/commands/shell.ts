// src/commands/shell.ts
import { Command } from 'commander'
import { createInterface } from 'node:readline'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { configModule } from '../core/config'
import { AdapterFactory, type ConnectionOptions, type SqlConnectionOptions } from '@/adapters'
import { ReplEngine } from '../core/repl/repl-engine'
import { createCompleter } from '../core/repl/completer'
import { resolveConfigPath } from '@/utils/config-path'
import type { ReplContext } from '../core/repl/types'
import type { DbcliConfig } from '../types'
import { t, t_vars } from '../i18n/message-loader'
import pc from 'picocolors'
import { MongoShellAdapter } from '@/adapters/mongo-shell-adapter'
import { RedisShellAdapter } from '@/adapters/redis-shell-adapter'
import * as esShell from '@/commands/es-shell'
import type { RedisAdapter } from '@/adapters/redis-adapter'
import type { QueryableAdapter } from '@/adapters/types'

function requireSqlConnection(connection: ConnectionOptions): SqlConnectionOptions {
  if (!['postgresql', 'mysql', 'mariadb'].includes(connection.system)) {
    throw new Error(`This command requires a SQL connection, got: ${connection.system}`)
  }
  return connection as SqlConnectionOptions
}

const HISTORY_PATH = join(homedir(), '.dbcli_history')

/** Eager column completion is skipped above this collection count to keep shell startup fast. */
export const MONGO_COMPLETION_EAGER_THRESHOLD = 20

/**
 * Populate column completion data for a MongoDB shell session.
 * Eagerly samples each collection's schema when collection count is at or below
 * the threshold; otherwise returns an empty map (tab completion still gets the
 * collection names from the caller).
 */
export async function populateMongoColumns(
  mongoAdapter: QueryableAdapter,
  collectionNames: string[],
  threshold: number = MONGO_COMPLETION_EAGER_THRESHOLD
): Promise<Record<string, string[]>> {
  const columnsByTable: Record<string, string[]> = {}
  if (!mongoAdapter.getTableSchema) return columnsByTable
  if (collectionNames.length === 0 || collectionNames.length > threshold) return columnsByTable

  for (const name of collectionNames) {
    try {
      const schema = await mongoAdapter.getTableSchema(name)
      columnsByTable[name] = schema.columns.map((c) => c.name)
    } catch {
      // Skip collections that fail to sample; tab completion gracefully misses them.
    }
  }
  return columnsByTable
}

export const shellCommand = new Command('shell')
  .description('Interactive database shell with auto-completion and syntax highlighting')
  .option('--sql', 'SQL-only mode (skip dbcli command parsing)')
  .action(async (options: { sql?: boolean }, command) => {
    const configPath = resolveConfigPath(command)
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

  if (config.connection.system === 'elasticsearch') {
    await esShell.runEsShell(configPath)
    return
  }

  const isMongoDB = config.connection.system === 'mongodb'
  const isRedis = config.connection.system === 'redis'
  const connectionOpts = config.connection as ConnectionOptions
  const mongoInner = isMongoDB ? AdapterFactory.createMongoDBAdapter(connectionOpts) : null
  const redisInner = isRedis
    ? (AdapterFactory.createRedisAdapter(
        connectionOpts,
        config.blacklist?.tables ?? [],
        (config as { redis?: { mask?: import('@/types/blacklist').RedisMaskRule[] } }).redis
          ?.mask ?? []
      ) as unknown as RedisAdapter)
    : null
  const adapter = isMongoDB
    ? new MongoShellAdapter(mongoInner!)
    : isRedis
      ? new RedisShellAdapter(redisInner!)
      : AdapterFactory.createSqlAdapter(requireSqlConnection(connectionOpts))
  try {
    await adapter.connect()
  } catch (error) {
    console.error(
      pc.red(t_vars('shell.error_connection_failed', { message: (error as Error).message }))
    )
    process.exit(1)
  }

  // Build context from schema cache or MongoDB collections
  let tableNames: string[] = []
  let columnsByTable: Record<string, string[]> = {}
  if (isRedis) {
    const keys = await adapter.listTables()
    tableNames = keys.map((k) => k.name)
    columnsByTable = {}
  } else if (isMongoDB) {
    const collections = await adapter.listTables()
    tableNames = collections.map((collection) => collection.name)
    if (mongoInner) {
      columnsByTable = await populateMongoColumns(mongoInner, tableNames)
      if (collections.length > MONGO_COMPLETION_EAGER_THRESHOLD) {
        console.error(
          pc.dim(
            `MongoDB shell: ${collections.length} collections detected; tab completion limited to collection names (threshold: ${MONGO_COMPLETION_EAGER_THRESHOLD}).`
          )
        )
      }
    }
  } else {
    const schemaData = (config.schema ?? {}) as Record<string, unknown>
    tableNames = Object.keys(schemaData)
    for (const [table, data] of Object.entries(schemaData)) {
      const tableData = data as { columns: { name: string }[] }
      if (tableData?.columns && Array.isArray(tableData.columns)) {
        columnsByTable[table] = tableData.columns.map((c) => c.name)
      }
    }
  }

  const context: ReplContext = {
    configPath,
    permission: config.permission,
    system: config.connection.system,
    tableNames,
    columnsByTable,
  }

  // Seed REPL command completion/dispatch from the live Commander tree so it
  // never drifts from the actual CLI surface. Dynamic import avoids the static
  // cycle: program imports shellCommand, which imports this module.
  const { buildProgram } = await import('@/program')
  const { buildCompletionTree, listTopLevelCommandNames } =
    await import('@/core/completion/command-tree')
  const { setReplCommandNames } = await import('@/core/repl/command-registry')
  setReplCommandNames(listTopLevelCommandNames(buildCompletionTree(buildProgram())))

  const engine = new ReplEngine(adapter, context, HISTORY_PATH, config)
  const complete = createCompleter(context)

  // Welcome message
  console.error(
    pc.bold(
      t_vars('shell.welcome', {
        system: config.connection.system,
        database: String(config.connection.database),
        host: String(config.connection.host),
        port: String(config.connection.port),
      })
    )
  )
  console.error(pc.dim(t_vars('shell.welcome_permission', { permission: config.permission })))
  if (isMongoDB) {
    console.error(pc.dim('MongoDB shell: use `query <json>` with `--collection <name>` for reads.'))
  }
  if (isRedis) {
    console.error(
      pc.dim(
        'Redis shell: single-line commands; SCAN/LRANGE auto-capped at 1000. ' +
          'Type `.no-limit on` to bypass (unsafe).'
      )
    )
  }

  if (options.sql) {
    console.error(pc.dim(t('shell.sql_mode_hint')))
  }

  console.error('')

  if (!(process.stdin.isTTY ?? false)) {
    const input = await Bun.stdin.text()
    await runBatchSession(engine, input)
    console.error(pc.dim(t('shell.goodbye')))
    await engine.saveHistory()
    await adapter.disconnect()
    process.exit(0)
  }

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

export async function runBatchSession(engine: ReplEngine, input: string): Promise<void> {
  const lines = input.replace(/\r\n/g, '\n').split('\n')
  for (const line of lines) {
    if (line.trim() === '' && lines.length > 1) continue
    const result = await engine.processInput(line)
    if (result.output) {
      console.log(result.output)
    }
    if (result.action === 'quit') {
      return
    }
  }
}
