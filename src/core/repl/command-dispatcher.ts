// src/core/repl/command-dispatcher.ts

export interface ParsedCommand {
  readonly command: string
  readonly args: readonly string[]
}

export function parseCommandLine(input: string): ParsedCommand {
  const trimmed = input.trim()
  const parts = splitRespectingQuotes(trimmed)
  const command = parts[0] ?? ''
  const args = parts.slice(1)
  return { command, args }
}

/**
 * Split a command line string by whitespace, but preserve quoted tokens.
 * e.g. 'query "SELECT * FROM users" --format json'
 *   → ['query', '"SELECT * FROM users"', '--format', 'json']
 */
function splitRespectingQuotes(input: string): string[] {
  const tokens: string[] = []
  let current = ''
  let inDoubleQuote = false
  let inSingleQuote = false

  for (let i = 0; i < input.length; i++) {
    const ch = input[i]

    if (ch === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote
      current += ch
    } else if (ch === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote
      current += ch
    } else if (ch === ' ' && !inDoubleQuote && !inSingleQuote) {
      if (current.length > 0) {
        tokens.push(current)
        current = ''
      }
    } else {
      current += ch
    }
  }

  if (current.length > 0) {
    tokens.push(current)
  }

  return tokens
}

/**
 * Whether `name` is a REPL-dispatchable command. The candidate set is passed in
 * explicitly (sourced from `ReplContext.commandNames`) rather than read from
 * module-level state, so callers control the command surface.
 */
export function isKnownCommand(name: string, commandNames: readonly string[]): boolean {
  return commandNames.includes(name)
}
