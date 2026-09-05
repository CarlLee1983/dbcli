import type { Command } from 'commander'
import { t } from '../i18n/message-loader'
import { printLocalizedCliError } from '../utils/cli-error'
import {
  createConnectionSelectorOption,
  resolveConnectionSelector,
} from '../core/connection-selector'
import {
  findLongOptionValue,
  hasLongOption,
  normalizeLimitFlags,
  parsePositiveInteger,
  parseSlowMs,
} from '../program-root'

/**
 * Option declarations + action wiring for the seven commands that are
 * registered inline in program.ts, extracted so both the eager tree
 * (program.ts) and the lazy tree (program-lazy.ts) can build the identical
 * command from the same source. Option order, defaults and parsers must stay
 * byte-for-byte what buildProgram() used to declare inline — that shape is
 * the --help contract.
 */

export function registerQueryCommand(
  program: Command,
  run: typeof import('./query').queryCommand
): void {
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
    .option(
      '--truncate <number>',
      'Limit serialized table cells to N Unicode characters',
      parsePositiveInteger
    )
    .option('--no-truncate', 'Disable the default table-cell truncation')
    .option(
      '--slow-ms <number>',
      'Emit a passive performance hint at or above this execution time; 0 disables it',
      parseSlowMs,
      1000
    )
    .addOption(createConnectionSelectorOption())
    .option(
      '--yes',
      'Skip the confirmation shown before an ordinary write; statements that are not limited to specific rows ignore it',
      false
    )
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
      await run(
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
}

export function registerPlanCommand(
  program: Command,
  run: typeof import('./plan').planCommand
): void {
  program
    .command('plan <sql>')
    .description('Analyze SQL risk without executing')
    .option('--format <type>', 'Output format: text, json', 'text')
    .option('--evidence-receipt <path>', 'Write a safe provenance receipt after the result')
    .action(async (sql: string, options: Record<string, unknown>, command) => {
      await run(sql, options as never, command)
    })
}

export function registerQCommand(program: Command, run: typeof import('./q').qCommand): void {
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
      '--slow-ms <number>',
      'Emit a passive performance hint at or above this execution time; 0 disables it',
      parseSlowMs,
      1000
    )
    .option(
      '--recovery',
      'On failure, emit a structured recovery envelope to stdout (suppresses human stderr message)',
      false
    )
    .option('--verify', 'Run verification check after execution if defined', false)
    .action(async (name: string, options: Record<string, unknown>, command) => {
      await run(name, normalizeLimitFlags(options) as any, command)
    })
}

export function registerInsertCommand(
  program: Command,
  run: typeof import('./insert').insertCommand
): void {
  program
    .command('insert <table>')
    .description(t('insert.description'))
    .option('--data <json>', 'JSON object to insert')
    .option('--dry-run', 'Show generated SQL without executing')
    .option('--force', 'Skip confirmation prompt')
    .option('--plan', 'Analyze risk without connecting or executing')
    .option('--format <type>', 'Output format: text or json', 'text')
    .option(
      '--recovery',
      'On failure, emit a structured recovery envelope to stdout (suppresses human stderr message)',
      false
    )
    .action(async (table: string, options: Record<string, unknown>, command) => {
      try {
        await run(table, options, command)
      } catch (error) {
        if (options.recovery === true) {
          const { emitRecoveryEnvelope } = await import('../core/recovery')
          emitRecoveryEnvelope(error, { operation: 'insert', table, writeOperation: 'INSERT' })
        }
        printLocalizedCliError((error as Error).message, error)
        process.exit(1)
      }
    })
}

export function registerUpdateCommand(
  program: Command,
  run: typeof import('./update').updateCommand
): void {
  program
    .command('update <table>')
    .description(t('update.description'))
    .option('--where <condition>', 'WHERE clause (required, e.g. "id=1")')
    .option('--set <json>', 'JSON with fields to update (required, e.g. \'{"name":"Bob"}\')')
    .option('--dry-run', 'Show generated SQL without executing')
    .option('--force', 'Skip confirmation prompt')
    .option('--plan', 'Analyze risk without connecting or executing')
    .option('--format <type>', 'Output format: text or json', 'text')
    .option(
      '--recovery',
      'On failure, emit a structured recovery envelope to stdout (suppresses human stderr message)',
      false
    )
    .action(async (table: string, options: Record<string, unknown>, command) => {
      try {
        await run(table, options as never, command)
      } catch (error) {
        if (options.recovery === true) {
          const { emitRecoveryEnvelope } = await import('../core/recovery')
          emitRecoveryEnvelope(error, { operation: 'update', table, writeOperation: 'UPDATE' })
        }
        printLocalizedCliError((error as Error).message, error)
        process.exit(1)
      }
    })
}

export function registerDeleteCommand(
  program: Command,
  run: typeof import('./delete').deleteCommand
): void {
  program
    .command('delete <table>')
    .description(t('delete.description'))
    .option('--where <condition>', 'WHERE clause (required, e.g. "id=1")')
    .option('--dry-run', 'Show generated SQL without executing')
    .option('--force', 'Skip confirmation prompt')
    .option('--plan', 'Analyze risk without connecting or executing')
    .option('--format <type>', 'Output format: text or json', 'text')
    .option(
      '--recovery',
      'On failure, emit a structured recovery envelope to stdout (suppresses human stderr message)',
      false
    )
    .action(async (table: string, options: Record<string, unknown>, command) => {
      try {
        await run(table, options as never, command)
      } catch (error) {
        if (options.recovery === true) {
          const { emitRecoveryEnvelope } = await import('../core/recovery')
          emitRecoveryEnvelope(error, { operation: 'delete', table, writeOperation: 'DELETE' })
        }
        printLocalizedCliError((error as Error).message, error)
        process.exit(1)
      }
    })
}

export function registerExportCommand(
  program: Command,
  run: typeof import('./export').exportCommand
): void {
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
      return await run(sql, normalizeLimitFlags(options) as never, command)
    })
}
