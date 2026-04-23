import { colors } from './colors'

export enum LogLevel {
  QUIET = 0,
  NORMAL = 1,
  VERBOSE = 2,
  DEBUG = 3,
}

export interface Logger {
  error: (...args: unknown[]) => void
  warn: (...args: unknown[]) => void
  info: (...args: unknown[]) => void
  verbose: (...args: unknown[]) => void
  debug: (...args: unknown[]) => void
  level: LogLevel
}

function formatArgs(args: unknown[]): string {
  return args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')
}

export function createLogger(level: LogLevel = LogLevel.NORMAL): Logger {
  const write = (minLevel: LogLevel, prefix: string, args: unknown[]) => {
    if (level < minLevel) return
    const message = `${prefix} ${formatArgs(args)}\n`
    process.stderr.write(message)
  }

  return {
    error: (...args) => write(LogLevel.QUIET, colors.error('[ERROR]'), args),
    warn: (...args) => write(LogLevel.NORMAL, colors.warn('[WARN]'), args),
    info: (...args) => write(LogLevel.NORMAL, colors.info('[INFO]'), args),
    verbose: (...args) => write(LogLevel.VERBOSE, colors.dim('[VERBOSE]'), args),
    debug: (...args) => write(LogLevel.DEBUG, colors.dim('[DEBUG]'), args),
    level,
  }
}

let globalLogger: Logger = createLogger(LogLevel.NORMAL)

export function setGlobalLogger(logger: Logger): void {
  globalLogger = logger
}

export function getLogger(): Logger {
  return globalLogger
}
