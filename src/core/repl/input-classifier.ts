// src/core/repl/input-classifier.ts
import type { ClassifiedInput } from './types'
import { SQL_KEYWORDS_FOR_DETECTION, DBCLI_COMMANDS, META_COMMANDS } from './types'

const META_PREFIX = '.'
const SQL_TERMINATOR = ';'

const sqlKeywordSet = new Set(SQL_KEYWORDS_FOR_DETECTION)
const dbcliCommandSet = new Set(DBCLI_COMMANDS)
const metaCommandNames = META_COMMANDS.map((m) => m.slice(1))

export function classifyInput(raw: string): ClassifiedInput {
  const normalized = raw.trim()

  if (normalized === '') {
    return { type: 'empty', raw, normalized }
  }

  if (normalized.startsWith(META_PREFIX)) {
    const cmdName = normalized.split(/\s+/)[0].slice(1)
    if (metaCommandNames.includes(cmdName)) {
      return { type: 'meta', raw, normalized }
    }
  }

  const firstWord = normalized.split(/\s+/)[0].toUpperCase()

  if (sqlKeywordSet.has(firstWord)) {
    return { type: 'sql', raw, normalized }
  }

  if (normalized.endsWith(SQL_TERMINATOR)) {
    return { type: 'sql', raw, normalized }
  }

  return { type: 'command', raw, normalized }
}
