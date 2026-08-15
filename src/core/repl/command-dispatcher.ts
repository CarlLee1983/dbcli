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
 * Split a command line string by whitespace, keeping a quoted run together.
 * e.g. 'query "SELECT * FROM users" --format json'
 *   → ['query', 'SELECT * FROM users', '--format', 'json']
 *
 * The quotes group; they are not part of the argument. Tokens go straight to
 * `Bun.spawn`, which takes an argv array and never involves a shell, so a
 * retained quote reached the database as text: `query "DELETE FROM users"`
 * failed with a syntax error at `"DELETE FROM users"` — the whole statement
 * read as one quoted identifier.
 */
function splitRespectingQuotes(input: string): string[] {
  const tokens: string[] = []
  let current = ''
  let inDoubleQuote = false
  let inSingleQuote = false
  let quoted = false

  for (let i = 0; i < input.length; i++) {
    const ch = input[i]

    if (ch === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote
      quoted = true
    } else if (ch === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote
      quoted = true
    } else if (ch === ' ' && !inDoubleQuote && !inSingleQuote) {
      // A quoted run that came out empty is still an argument: `--where ""`
      // means the empty string, and dropping it would shift every flag after it.
      if (current.length > 0 || quoted) {
        tokens.push(current)
        current = ''
        quoted = false
      }
    } else {
      current += ch
    }
  }

  if (current.length > 0 || quoted) {
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
