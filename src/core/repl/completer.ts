// src/core/repl/completer.ts
import type { ReplContext } from './types'
import { SQL_KEYWORDS_FOR_COMPLETION, SQL_KEYWORDS_FOR_DETECTION, DBCLI_COMMANDS, META_COMMANDS } from './types'

type CompleterFn = (line: string) => [string[], string]

const TABLE_POSITION_KEYWORDS = new Set([
  'FROM', 'JOIN', 'INNER', 'LEFT', 'RIGHT', 'OUTER', 'CROSS',
  'INTO', 'UPDATE', 'TABLE',
])

const COMMANDS_TAKING_TABLE_ARG = new Set([
  'schema', 'insert', 'update', 'delete', 'check',
])

export function createCompleter(ctx: ReplContext): CompleterFn {
  const allTableNames = ctx.tableNames
  const allColumns = Object.values(ctx.columnsByTable).flat()
  const uniqueColumns = [...new Set(allColumns)]

  return function completer(line: string): [string[], string] {
    const trimmed = line.trimStart()

    if (trimmed.startsWith('.')) {
      return completeMetaCommands(trimmed)
    }

    const lastWord = getLastWord(trimmed)
    const upperLine = trimmed.toUpperCase()
    const prevWord = getPreviousWord(trimmed)
    const prevWordUpper = prevWord.toUpperCase()

    // After FROM/JOIN/INTO/UPDATE/TABLE → complete table names
    if (TABLE_POSITION_KEYWORDS.has(prevWordUpper)) {
      return matchWithSuffix(allTableNames, lastWord)
    }

    // If first word matches a SQL keyword start, complete SQL keywords
    const firstWordUpper = getFirstWord(trimmed).toUpperCase()
    const sqlKeywordSet = new Set(SQL_KEYWORDS_FOR_DETECTION.map(k => k.toUpperCase()))

    if (sqlKeywordSet.has(firstWordUpper) || firstWordUpper === '') {
      // Inside SQL context — always include SQL keywords, plus context-aware table/column completions
      const sqlHits = matchWithSuffix([...SQL_KEYWORDS_FOR_COMPLETION], lastWord)
      const tableHits = matchWithSuffix(allTableNames, lastWord)

      // Only add column completions when in a column position context
      const colHits = isColumnPosition(upperLine)
        ? (() => {
            const tableName = extractTableFromLine(trimmed, allTableNames)
            if (tableName && ctx.columnsByTable[tableName]) {
              return matchWithSuffix([...ctx.columnsByTable[tableName]], lastWord)
            }
            return matchWithSuffix(uniqueColumns, lastWord)
          })()
        : [[] as string[], lastWord] as [string[], string]

      const merged = [...new Set([...sqlHits[0], ...tableHits[0], ...colHits[0]])]
      return [merged, lastWord]
    }

    // dbcli command context
    const words = trimmed.split(/\s+/)
    if (words.length === 1) {
      // Completing the command name itself
      const cmdHits = matchWithSuffix([...DBCLI_COMMANDS], lastWord)
      const sqlHits = matchWithSuffix([...SQL_KEYWORDS_FOR_COMPLETION], lastWord)
      return [[...cmdHits[0], ...sqlHits[0]], lastWord]
    }

    // After a command that takes a table arg → complete table names
    const cmdName = words[0]
    if (COMMANDS_TAKING_TABLE_ARG.has(cmdName)) {
      return matchWithSuffix(allTableNames, lastWord)
    }

    // Fallback: complete table names
    return matchWithSuffix(allTableNames, lastWord)
  }
}

function completeMetaCommands(line: string): [string[], string] {
  const hits = META_COMMANDS
    .filter(m => m.startsWith(line.split(/\s+/)[0].toLowerCase()))
    .map(m => m + ' ')
  return [hits, line.split(/\s+/)[0]]
}

function getLastWord(line: string): string {
  const parts = line.split(/\s+/)
  return parts[parts.length - 1] || ''
}

function getFirstWord(line: string): string {
  const parts = line.split(/\s+/)
  return parts[0] || ''
}

function getPreviousWord(line: string): string {
  const parts = line.trimEnd().split(/\s+/)
  if (line.endsWith(' ') || line.endsWith('\t')) {
    return parts[parts.length - 1] || ''
  }
  return parts.length >= 2 ? parts[parts.length - 2] : ''
}

function isColumnPosition(upperLine: string): boolean {
  const columnKeywords = ['WHERE ', 'AND ', 'OR ', 'ON ', 'SET ', 'SELECT ']
  return columnKeywords.some(k => upperLine.includes(k))
}

function extractTableFromLine(line: string, tableNames: readonly string[]): string | undefined {
  const upper = line.toUpperCase()
  const fromIdx = upper.lastIndexOf('FROM ')
  if (fromIdx >= 0) {
    const afterFrom = line.slice(fromIdx + 5).trim().split(/\s+/)[0]
    const candidate = afterFrom.replace(/[;,]/g, '').toLowerCase()
    return tableNames.find(t => t.toLowerCase() === candidate)
  }
  return undefined
}

function matchWithSuffix(candidates: readonly string[], prefix: string): [string[], string] {
  const lower = prefix.toLowerCase()
  const hits = candidates
    .filter(c => c.toLowerCase().startsWith(lower))
    .map(c => c + ' ')
  return [hits, prefix]
}
