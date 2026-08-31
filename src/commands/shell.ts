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
import type { RuntimeDbcliConfig } from '../core/config'
import { t, t_vars } from '../i18n/message-loader'
import pc from 'picocolors'
import { MongoShellAdapter } from '@/adapters/mongo-shell-adapter'
import { RedisShellAdapter } from '@/adapters/redis-shell-adapter'
import * as esShell from '@/commands/es-shell'
import type { RedisAdapter } from '@/adapters/redis-adapter'
import type { QueryableAdapter } from '@/adapters/types'
import { createSubmitQueue } from './shell-submit-queue'

function requireSqlConnection(connection: ConnectionOptions): SqlConnectionOptions {
  if (!['postgresql', 'mysql', 'mariadb'].includes(connection.system)) {
    throw new Error(`This command requires a SQL connection, got: ${connection.system}`)
  }
  return connection as SqlConnectionOptions
}

const HISTORY_PATH = join(homedir(), '.dbcli_history')

/** Eager column completion is skipped above this collection count to keep shell startup fast. */
export const MONGO_COMPLETION_EAGER_THRESHOLD = 20

/** Redis shell samples at most this many keys for tab completion to keep startup fast. */
export const REDIS_COMPLETION_KEY_LIMIT = 1000

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

/**
 * Sample Redis key names for a shell session's tab completion. Best-effort:
 * a scan failure yields empty completion so the prompt is never blocked.
 * `truncated` is true when the keyspace exceeded the sample budget.
 */
export async function populateRedisKeyCompletion(
  adapter: { sampleKeyNames(limit: number): Promise<{ names: string[]; truncated: boolean }> },
  limit: number = REDIS_COMPLETION_KEY_LIMIT
): Promise<{ tableNames: string[]; truncated: boolean }> {
  try {
    const { names, truncated } = await adapter.sampleKeyNames(limit)
    return { tableNames: names, truncated }
  } catch {
    return { tableNames: [], truncated: false }
  }
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
  let config: RuntimeDbcliConfig
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
    const completion = await populateRedisKeyCompletion(redisInner!)
    tableNames = completion.tableNames
    columnsByTable = {}
    if (completion.truncated) {
      console.error(
        pc.dim(
          `Redis shell: large keyspace; tab completion limited to the first ${REDIS_COMPLETION_KEY_LIMIT} keys.`
        )
      )
    }
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

  // Derive REPL command completion/dispatch names from the live Commander tree
  // so they never drift from the actual CLI surface. The snapshot is injected
  // into ReplContext below — no module-level state. Dynamic import avoids the
  // static cycle: program imports shellCommand, which imports this module.
  const { buildProgram } = await import('@/program')
  const { buildCompletionTree, listTopLevelCommandNames } =
    await import('@/core/completion/command-tree')
  const { deriveReplCommandNames } = await import('@/core/repl/command-registry')
  const commandNames = deriveReplCommandNames(
    listTopLevelCommandNames(buildCompletionTree(buildProgram()))
  )

  const context: ReplContext = {
    configPath,
    permission: config.permission,
    system: config.connection.system,
    tableNames,
    columnsByTable,
    commandNames,
  }

  // Assigned once the REPL's readline interface exists, below. The gate is built
  // before the engine and the interface after it, so the confirmation reaches
  // the one reader that owns the terminal through this holder rather than by
  // opening a second one on stdin.
  let replInterface: ReturnType<typeof createInterface> | null = null
  const { createPromptAsker } = await import('./shell-prompt-asker')
  const asker = createPromptAsker(() => replInterface)

  // The write gate (#78). SQL engines only: Redis and MongoDB statements have a
  // different shape and their own permission guards, and `toSqlDialect` returns
  // undefined for them, which is what leaves their shells untouched.
  const { toSqlDialect } = await import('@/core/permission-guard')
  const dialect = toSqlDialect(config.connection.system)
  const writeGate = dialect
    ? (await import('./shell-write-gate')).createShellWriteGate({
        config,
        configPath,
        dialect,
        ask: asker.ask,
      })
    : null

  const engine = new ReplEngine(adapter, context, HISTORY_PATH, config, writeGate)
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

  replInterface = rl

  const continuationPrompt = pc.dim(t('shell.continuation_prompt') + '> ')

  rl.prompt()

  // `.quit` 之後排在佇列裡的行不再執行。宣告在 `handleLine` 之前，因為兩邊
  // 都讀它：設旗標的是 quit 分支，擋下 enqueue 的是 `'line'` handler。
  let isClosing = false

  const handleLine = async (line: string): Promise<void> => {
    // Paused while the statement runs so that a prompt raised from inside —
    // the tier-two write gate is the only one today — owns stdin alone.
    // Two readers on one terminal split the operator's keystrokes between them.
    rl.pause()
    let result
    try {
      result = await engine.processInput(line)
    } catch (error) {
      // A rejection here would leave the session with no prompt and the process
      // dying on an unhandled rejection. The engine reports the errors it
      // expects; anything reaching this point is a defect, and the operator
      // should still get their shell back to work around it.
      console.error(pc.red(t_vars('shell.error_sql_failed', { message: (error as Error).message })))
      rl.setPrompt(pc.cyan(t('shell.prompt') + '> '))
      rl.prompt()
      return
    } finally {
      rl.resume()
    }

    switch (result.action) {
      case 'quit':
        if (result.output) console.error(result.output)
        isClosing = true
        rl.close()
        return

      case 'clear':
        console.clear()
        break

      case 'multiline':
        // A statement in progress can carry a note — the subcommand-prefix hint
        // — and it goes to stderr so a piped session's stdout stays data only.
        if (result.output) console.error(result.output)
        break

      case 'continue':
        if (result.output) {
          // Output structured data to stdout, messages to stderr
          console.log(result.output)
        }
        break
    }

    // The prompt is read off the engine rather than set per branch. A meta
    // command answered while a statement was accumulating used to return the
    // `dbcli>` prompt while the buffer still held the statement, and `.clear`
    // left `...>` after abandoning it — the prompt said one thing and the
    // buffer meant another.
    rl.setPrompt(engine.isMultiline() ? continuationPrompt : pc.cyan(t('shell.prompt') + '> '))
    rl.prompt()
  }

  // One statement at a time, whatever the terminal delivers. Pausing the
  // interface is not enough on its own: several lines can arrive in a single
  // chunk — a paste, or a confirmation typed ahead of the next statement — and
  // readline emits them all before the handler's first `await` returns. Without
  // this queue those handlers run concurrently through one `ReplEngine`, sharing
  // its multiline buffer and its `.format` / `.no-limit` state.
  // 序列化只是一半。`'close'` 不等這條鏈就 `process.exit(0)`，於是管線輸入的
  // 最後一筆會送得出去而 audit 寫不完——與 ES shell 上第五輪找到的是同一個洞。
  const queue = createSubmitQueue()
  rl.on('line', (line: string) => {
    // `.quit` 之後排在佇列裡的行不再執行——與 ES shell 的 `exit` 同一個形狀。
    if (isClosing) return
    queue.enqueue(() => handleLine(line))
  })

  rl.on('close', async () => {
    await queue.drain()
    console.error(pc.dim(t('shell.goodbye')))
    await engine.saveHistory()
    await adapter.disconnect()
    process.exit(0)
  })

  // Handle SIGINT (Ctrl+C) — cancel multiline, don't exit
  rl.on('SIGINT', () => {
    // A confirmation on screen takes precedence: withdraw it and let the gate
    // report the cancellation and the line handler restore the prompt. Printing
    // one here would land between the gate's own two lines.
    if (asker.cancel()) return

    if (engine.isMultiline()) {
      engine.cancelMultiline()
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
      // A statement still accumulating can carry a note rather than data — the
      // subcommand-prefix hint. It goes to stderr so a piped session's stdout
      // stays parseable; printing it inline corrupted the stream for anything
      // reading the output.
      if (result.action === 'multiline') console.error(result.output)
      else console.log(result.output)
    }
    if (result.action === 'quit') {
      return
    }
  }
}
