// src/core/repl/command-dispatcher.ts
import { DBCLI_COMMANDS } from './types'

export interface ParsedCommand {
  readonly command: string
  readonly args: readonly string[]
}

const BLOCKED_FROM_REPL = new Set(['shell'])

const knownCommands = new Set(DBCLI_COMMANDS.filter((c) => !BLOCKED_FROM_REPL.has(c)))

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

export function isKnownCommand(name: string): boolean {
  return knownCommands.has(name)
}
