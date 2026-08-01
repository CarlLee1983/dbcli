import { getLogger, LogLevel } from './logger'

export interface CliErrorPresentation {
  message: string
  code?: string
  hints: string[]
  stack?: string
}

type ErrorLike = {
  message?: unknown
  code?: unknown
  hints?: unknown
  stack?: unknown
}

/** Convert an unknown rejection into the bounded, public CLI error shape. */
export function mapCliError(error: unknown, includeStack = false): CliErrorPresentation {
  const candidate =
    error !== null && (typeof error === 'object' || typeof error === 'function')
      ? (error as ErrorLike)
      : undefined

  const message =
    typeof candidate?.message === 'string' && candidate.message.trim() !== ''
      ? candidate.message
      : typeof error === 'string' && error.trim() !== ''
        ? error
        : 'An unexpected error occurred'
  const code =
    typeof candidate?.code === 'string' || typeof candidate?.code === 'number'
      ? String(candidate.code)
      : undefined
  const hints = Array.isArray(candidate?.hints)
    ? candidate.hints.filter((hint): hint is string => typeof hint === 'string' && hint !== '')
    : []
  const stack =
    includeStack && typeof candidate?.stack === 'string' && candidate.stack !== ''
      ? candidate.stack
      : undefined

  return { message, ...(code && { code }), hints, ...(stack && { stack }) }
}

export function formatCliError(presentation: CliErrorPresentation): string {
  const lines = [presentation.message]
  if (presentation.code) lines.push(`Code: ${presentation.code}`)
  for (const hint of presentation.hints) lines.push(`Hint: ${hint}`)
  if (presentation.stack) lines.push('Stack:', presentation.stack)
  return lines.join('\n')
}

/** Present one rejection once. Normal mode is bounded; verbose mode adds its stack. */
export function presentCliError(error: unknown): void {
  const includeStack = getLogger().level >= LogLevel.VERBOSE
  process.stderr.write(`${formatCliError(mapCliError(error, includeStack))}\n`)
}

/**
 * Present an error whose wording the command already localized, keeping that
 * wording as the first line and attaching the stack only in verbose mode.
 *
 * Commands that format their own message would otherwise drop the stack
 * entirely, leaving `-v` / `-vv` with nothing extra to show.
 */
export function printLocalizedCliError(message: string, error: unknown): void {
  console.error(message)
  const stack = mapCliError(error, getLogger().level >= LogLevel.VERBOSE).stack
  if (stack) console.error(`Stack:\n${stack}`)
}
