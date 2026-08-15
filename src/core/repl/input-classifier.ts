// src/core/repl/input-classifier.ts
import type { ClassifiedInput } from './types'
import { SQL_KEYWORDS_FOR_DETECTION, META_COMMANDS } from './types'

const META_PREFIX = '.'
/**
 * What reaches a dbcli subcommand from inside the shell.
 *
 * A shell is for typing SQL, so on a name clash SQL wins: `DELETE FROM users
 * WHERE …` has to run as typed. That left `delete`, `update`, `insert` and the
 * other subcommands named after SQL keywords with no way in at all — the line
 * was read as SQL, had no semicolon, and the shell silently entered multiline
 * mode where even `.quit` was swallowed (#88).
 *
 * A separate prefix rather than the meta `.`: these are dbcli subcommands run in
 * their own process, not commands the shell implements, and keeping the two
 * namespaces apart means a future `.export` cannot collide with `export`.
 */
export const COMMAND_PREFIX = '\\'
const SQL_TERMINATOR = ';'

const sqlKeywordSet = new Set(SQL_KEYWORDS_FOR_DETECTION)
const metaCommandNames = META_COMMANDS.map((m) => m.slice(1))

export function classifyInput(raw: string): ClassifiedInput {
  const normalized = raw.trim()

  if (normalized === '') {
    return { type: 'empty', raw, normalized }
  }

  if (normalized.startsWith(META_PREFIX)) {
    const cmdName = (normalized.split(/\s+/)[0] ?? '').slice(1)
    if (metaCommandNames.includes(cmdName)) {
      return { type: 'meta', raw, normalized }
    }
  }

  // Before the SQL rules, so nothing in the line can reclassify it — a trailing
  // `;`, which is habit for anyone typing SQL all day, used to send it back down
  // the SQL path.
  if (normalized.startsWith(COMMAND_PREFIX)) {
    return { type: 'command', raw, normalized }
  }

  const firstWord = (normalized.split(/\s+/)[0] ?? '').toUpperCase()

  if (sqlKeywordSet.has(firstWord)) {
    return { type: 'sql', raw, normalized }
  }

  if (normalized.endsWith(SQL_TERMINATOR)) {
    return { type: 'sql', raw, normalized }
  }

  return { type: 'command', raw, normalized }
}
