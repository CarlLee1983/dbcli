import { Command, InvalidArgumentError } from 'commander'
import { createConnectionSelectorOption } from './core/connection-selector'
import { isCorrelationId } from './core/correlation-id'
import {
  parseTimeoutOption,
  parseStatementTimeoutOption,
  MIN_CONNECTION_TIMEOUT_MS,
  MAX_CONNECTION_TIMEOUT_MS,
  MIN_STATEMENT_TIMEOUT_MS,
  MAX_STATEMENT_TIMEOUT_MS,
} from './utils/validation'
import { parseSlowQueryThreshold } from './core/slow-query-advisory'
import { t } from './i18n/message-loader'
import pkg from '../package.json'

/**
 * Commander-facing wrapper: same rule as the config schema, but reported the way
 * Commander reports every other bad option value.
 */
export function parseConnectionTimeout(value: string): number {
  try {
    return parseTimeoutOption(value)
  } catch {
    throw new InvalidArgumentError(
      `must be an integer between ${MIN_CONNECTION_TIMEOUT_MS} and ${MAX_CONNECTION_TIMEOUT_MS} milliseconds`
    )
  }
}

export function parseStatementTimeout(value: string): number {
  try {
    return parseStatementTimeoutOption(value)
  } catch {
    throw new InvalidArgumentError(
      `must be an integer between ${MIN_STATEMENT_TIMEOUT_MS} and ${MAX_STATEMENT_TIMEOUT_MS} milliseconds (0 removes the limit)`
    )
  }
}

export function parsePositiveInteger(value: string): number {
  if (!/^\d+$/.test(value)) {
    throw new InvalidArgumentError('must be a positive integer')
  }
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new InvalidArgumentError('must be a positive integer')
  }
  return parsed
}

export function parseSlowMs(value: string): number {
  try {
    return parseSlowQueryThreshold(value)
  } catch {
    throw new InvalidArgumentError('must be a non-negative integer')
  }
}

export function parseCorrelationId(value: string): string {
  if (!isCorrelationId(value)) {
    throw new InvalidArgumentError(
      'must be 1-160 ASCII letters, numbers, dots, underscores, colons, or hyphens'
    )
  }
  return value
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

export function findLongOptionValue(
  rawArgs: readonly string[],
  option: string
): string | undefined {
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

export function hasLongOption(rawArgs: readonly string[], option: string): boolean {
  for (const token of rawArgs) {
    if (token === '--') return false
    if (token === option || token.startsWith(`${option}=`)) return true
  }
  return false
}

/**
 * Build the root dbcli Commander program: name, description, version, and all
 * root-level options. No subcommands are registered — callers attach those.
 */
export function createRootProgram(): Command {
  return (
    new Command()
      .name('dbcli')
      .description('Database CLI for AI agents')
      .version(pkg.version)
      .option('--no-color', 'Disable colored output')
      .option(
        '-v, --verbose',
        'Increase verbosity (-v verbose, -vv debug)',
        (_, prev) => prev + 1,
        0
      )
      .option('-q, --quiet', 'Suppress non-essential output')
      .option('--agent-output', t('cli.agent_output_option'), false)
      .option(
        '--correlation-id <id>',
        'Correlation ID for audit and agent output',
        parseCorrelationId
      )
      .option('--config <path>', 'Path to .dbcli config file', '.dbcli')
      .option('--global', 'Use the user-global connection registry (~/.config/dbcli)', false)
      .option(
        '--timeout <ms>',
        'Connection timeout in milliseconds; also caps statement time unless --statement-timeout is given (default 5000)',
        parseConnectionTimeout
      )
      .option(
        '--statement-timeout <ms>',
        'Statement timeout in milliseconds, independent of the connection timeout (0 removes the limit; default: server setting)',
        parseStatementTimeout
      )
      .addOption(createConnectionSelectorOption())
      // Required so options after a sub-subcommand (e.g. `dbcli proxy analyze --events ...`)
      // bind to the leaf command instead of being absorbed by an ancestor that shares the
      // option name. Commander requires every ancestor in the chain to opt in.
      .enablePositionalOptions()
  )
}
