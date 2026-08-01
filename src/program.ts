import { Command, InvalidArgumentError } from 'commander'
import { t } from './i18n/message-loader'
import { initCommand } from './commands/init'
import { listCommand } from './commands/list'
import { schemaCommand } from './commands/schema'
import { queryCommand } from './commands/query'
import { planCommand } from './commands/plan'
import { qCommand } from './commands/q'
import { queriesCommand } from './commands/queries'
import { insertCommand } from './commands/insert'
import { updateCommand } from './commands/update'
import { deleteCommand } from './commands/delete'
import { exportCommand } from './commands/export'
import { registerSkillCommand } from './commands/skill'
import { registerSkillTasksCommand } from './commands/skill-tasks'
import { blacklistCommand } from './commands/blacklist'
import { checkCommand } from './commands/check'
import { diffCommand } from './commands/diff'
import { statusCommand } from './commands/status'
import { inspectCommand } from './commands/inspect'
import { reportCommand } from './commands/report'
import { guideCommand } from './commands/guide'
import { registerMissingIndexCommand } from './commands/guide-missing-index'
import { explainCommand } from './commands/explain'
import { lintCommand } from './commands/lint'
import { snapshotCommand } from './commands/snapshot'
import { assertCommand } from './commands/assert'
import { verificationCommand } from './commands/verification'
import { verifyCommand } from './commands/verify'
import { recoveryCommand } from './commands/recovery'
import { recoverCommand } from './commands/recover'
import { auditCommand } from './commands/audit'
import { doctorCommand } from './commands/doctor'
import { completionCommand } from './commands/completion'
import { upgradeCommand } from './commands/upgrade'
import { shellCommand } from './commands/shell'
import { migrateCommand } from './commands/migrate'
import { useCommand } from './commands/use'
import { proxyCommand } from './commands/proxy'
import {
  createConnectionSelectorOption,
  resolveConnectionSelector,
} from './core/connection-selector'
import { printLocalizedCliError } from './utils/cli-error'
import pkg from '../package.json'

function parsePositiveInteger(value: string): number {
  if (!/^\d+$/.test(value)) {
    throw new InvalidArgumentError('must be a positive integer')
  }
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new InvalidArgumentError('must be a positive integer')
  }
  return parsed
}

/**
 * Commander folds a `--no-limit` flag into the `limit` attribute — `false` when
 * passed, `true` when the flag stands alone and is omitted — and never produces
 * `noLimit`. Commands read `noLimit`, so restore that shape here and keep
 * `limit` holding only a real row count.
 */
export function normalizeLimitFlags<T extends Record<string, unknown>>(options: T): T {
  const limit = options.limit
  if (typeof limit === 'boolean') {
    return { ...options, limit: undefined, noLimit: limit === false }
  }
  return { ...options, noLimit: false }
}

function findLongOptionValue(rawArgs: readonly string[], option: string): string | undefined {
  let value: string | undefined
  for (let index = 0; index < rawArgs.length; index++) {
    const token = rawArgs[index]!
    if (token === '--') break
    if (token === option) {
      value = rawArgs[index + 1]
      index++
    } else if (token.startsWith(`${option}=`)) {
      value = token.slice(option.length + 1)
    }
  }
  return value
}

function hasLongOption(rawArgs: readonly string[], option: string): boolean {
  for (const token of rawArgs) {
    if (token === '--') return false
    if (token === option || token.startsWith(`${option}=`)) return true
  }
  return false
}

/**
 * Build the dbcli Commander program with all commands registered.
 *
 * NOTE: command objects are module-level singletons shared across calls, so a
 * second buildProgram() re-parents them onto the newest program. Callers must
 * use the returned program immediately (parse it, or read its command tree) and
 * must NOT retain a previously returned program — its subcommands' .parent will
 * have been repointed. cli.ts builds once; shell.ts builds-and-discards.
 */
export function buildProgram(): Command {
  const program = new Command()
    .name('dbcli')
    .description('Database CLI for AI agents')
    .version(pkg.version)
    .option('--no-color', 'Disable colored output')
    .option('-v, --verbose', 'Increase verbosity (-v verbose, -vv debug)', (_, prev) => prev + 1, 0)
    .option('-q, --quiet', 'Suppress non-essential output')
    .option('--config <path>', 'Path to .dbcli config file', '.dbcli')
    .addOption(createConnectionSelectorOption())
    // Required so options after a sub-subcommand (e.g. `dbcli proxy analyze --events ...`)
    // bind to the leaf command instead of being absorbed by an ancestor that shares the
    // option name. Commander requires every ancestor in the chain to opt in.
    .enablePositionalOptions()

  // Register commands
  program.addCommand(initCommand)
  program.addCommand(listCommand)
  program.addCommand(schemaCommand)

  // Register query command
  program
    .command('query [sql]')
    .description(t('query.description'))
    .option('-f, --query-file <path>', 'Read query text from a UTF-8 file, or - for stdin')
    .option('--format <type>', 'Output format: table, json, csv, html', 'table')
    .option('--ui', 'Show interactive dashboard in browser', false)
    .option('--limit <number>', 'Limit result rows (overrides auto-limit)', parsePositiveInteger)
    .option('--no-limit', 'Disable auto-limit in query-only mode')
    .option('--collection <name>', 'MongoDB collection name; Elasticsearch index name')
    .option('--index <name>', 'Elasticsearch index name (alias for --collection)')
    .option('--fields <list>', 'Include fields, or exclude them with --fields=-field_a,-field_b')
    .option('--truncate <number>', 'Limit serialized table cells to N Unicode characters', parsePositiveInteger)
    .option('--no-truncate', 'Disable the default table-cell truncation')
    .addOption(createConnectionSelectorOption())
    .option(
      '--recovery',
      'On failure, emit a structured recovery envelope to stdout (suppresses human stderr message)',
      false
    )
    .action(async (sql: string | undefined, options: Record<string, unknown>, command) => {
      const rawArgs = command.parent?.rawArgs ?? []
      const rawTruncate = findLongOptionValue(rawArgs, '--truncate')
      const rootUse = command.parent?.opts().use as string | undefined
      const commandUse = options.use as string | undefined
      const connectionSelector =
        rootUse !== undefined || commandUse !== undefined
          ? resolveConnectionSelector({ root: rootUse, command: commandUse })
          : undefined
      await queryCommand(
        sql,
        {
          ...normalizeLimitFlags(options),
          connectionSelector,
          truncate: rawTruncate === undefined ? undefined : parsePositiveInteger(rawTruncate),
          noTruncate: hasLongOption(rawArgs, '--no-truncate'),
        } as any,
        command
      )
    })

  // Register plan command
  program
    .command('plan <sql>')
    .description('Analyze SQL risk without executing')
    .option('--format <type>', 'Output format: text, json', 'text')
    .action(async (sql: string, options: Record<string, unknown>, command) => {
      await planCommand(sql, options as never, command)
    })

  // Register saved-query (q) command
  program
    .command('q <name>')
    .description(t('q.description'))
    .option('--format <type>', 'Output format: table, json, csv, html', 'table')
    .option('--ui', 'Show interactive dashboard in browser', false)
    .option('--no-limit', 'Disable size guard wrap (LIMIT 1000)')
    .option('--dry-run', 'Show final SQL + bind values; do not execute')
    .option(
      '--param <kv>',
      'Pass parameter as key=value (repeatable)',
      (val: string, prev: string[] = []) => prev.concat([val]),
      [] as string[]
    )
    .option('--param-file <path>', 'JSON file containing param values')
    .option(
      '--recovery',
      'On failure, emit a structured recovery envelope to stdout (suppresses human stderr message)',
      false
    )
    .option('--verify', 'Run verification check after execution if defined', false)
    .action(async (name: string, options: Record<string, unknown>, command) => {
      await qCommand(name, normalizeLimitFlags(options) as any, command)
    })

  // Register insert command
  program
    .command('insert <table>')
    .description(t('insert.description'))
    .option('--data <json>', 'JSON object to insert')
    .option('--dry-run', 'Show generated SQL without executing')
    .option('--force', 'Skip confirmation prompt')
    .option('--plan', 'Analyze risk without connecting or executing')
    .option('--format <type>', 'Output format for --plan: text or json', 'text')
    .option(
      '--recovery',
      'On failure, emit a structured recovery envelope to stdout (suppresses human stderr message)',
      false
    )
    .action(async (table: string, options: Record<string, unknown>, command) => {
      try {
        await insertCommand(table, options, command)
      } catch (error) {
        if (options.recovery === true) {
          const { emitRecoveryEnvelope } = await import('./core/recovery')
          emitRecoveryEnvelope(error, { operation: 'insert', table, writeOperation: 'INSERT' })
        }
        printLocalizedCliError((error as Error).message, error)
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
    .option('--plan', 'Analyze risk without connecting or executing')
    .option('--format <type>', 'Output format for --plan: text or json', 'text')
    .option(
      '--recovery',
      'On failure, emit a structured recovery envelope to stdout (suppresses human stderr message)',
      false
    )
    .action(async (table: string, options: Record<string, unknown>, command) => {
      try {
        await updateCommand(table, options as never, command)
      } catch (error) {
        if (options.recovery === true) {
          const { emitRecoveryEnvelope } = await import('./core/recovery')
          emitRecoveryEnvelope(error, { operation: 'update', table, writeOperation: 'UPDATE' })
        }
        printLocalizedCliError((error as Error).message, error)
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
    .option('--plan', 'Analyze risk without connecting or executing')
    .option('--format <type>', 'Output format for --plan: text or json', 'text')
    .option(
      '--recovery',
      'On failure, emit a structured recovery envelope to stdout (suppresses human stderr message)',
      false
    )
    .action(async (table: string, options: Record<string, unknown>, command) => {
      try {
        await deleteCommand(table, options as never, command)
      } catch (error) {
        if (options.recovery === true) {
          const { emitRecoveryEnvelope } = await import('./core/recovery')
          emitRecoveryEnvelope(error, { operation: 'delete', table, writeOperation: 'DELETE' })
        }
        printLocalizedCliError((error as Error).message, error)
        process.exit(1)
      }
    })

  // Register export command
  program
    .command('export <sql>')
    .description(t('export.description'))
    .option('--format <format>', 'Output format: json, jsonl, csv, html', 'json')
    .option('--output <path>', 'Output file path (if omitted, write to stdout)', undefined)
    .option('--force', 'Skip overwrite confirmation', false)
    .option('--collection <name>', 'MongoDB collection name; Elasticsearch index name')
    .option('--index <name>', 'Elasticsearch index name (alias for --collection)')
    .addOption(createConnectionSelectorOption())
    .option('--limit <number>', 'Limit result rows (overrides auto-limit)', (val) =>
      parseInt(val, 10)
    )
    .option('--no-limit', 'Disable auto-limit in query-only mode')
    .option(
      '--recovery',
      'On failure, emit a structured recovery envelope to stdout (suppresses human stderr message)',
      false
    )
    .action(async (sql: string, options: Record<string, unknown>, command) => {
      return await exportCommand(sql, normalizeLimitFlags(options) as never, command)
    })

  // Register skill command + skill tasks sub-tree
  const skillCmd = registerSkillCommand(program)
  registerSkillTasksCommand(skillCmd)

  // Register blacklist command
  program.addCommand(blacklistCommand)

  // Register check command
  program.addCommand(checkCommand)

  // Register diff command
  program.addCommand(diffCommand)

  // Register status command
  program.addCommand(statusCommand)
  program.addCommand(inspectCommand)
  program.addCommand(reportCommand)
  program.addCommand(guideCommand)
  registerMissingIndexCommand(guideCommand)
  program.addCommand(recoveryCommand)
  program.addCommand(recoverCommand)
  program.addCommand(auditCommand)
  program.addCommand(doctorCommand)
  program.addCommand(completionCommand)
  program.addCommand(upgradeCommand)
  program.addCommand(shellCommand)
  program.addCommand(migrateCommand)
  program.addCommand(useCommand)
  program.addCommand(queriesCommand)
  program.addCommand(explainCommand)
  program.addCommand(lintCommand)
  program.addCommand(snapshotCommand)
  program.addCommand(assertCommand)
  program.addCommand(verificationCommand)
  program.addCommand(verifyCommand)
  program.addCommand(proxyCommand)

  return program
}
