/**
 * --bulk input resolver.
 *
 * Input forms (in this order of resolution):
 *   @file/path.sql        → read file, split on `;`, strip comments
 *   @name (no `*`)        → saved-query lookup; falls back to file path
 *   @glob/* (contains *)  → saved-query glob, then filesystem-glob expansion
 *   anything else         → raw SQL string
 *
 * IO/store access is injected so the runner stays unit-testable.
 */

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { existsSync } from 'node:fs'

export interface BulkInput {
  /** Optional human-readable label — used as queryLabel in ExplainPlan. */
  label?: string
  sql: string
}

export interface BulkDeps {
  /**
   * Resolve a saved-query name or glob pattern to an array of { name, sql }.
   * Returns null when the name does not exist in the saved-queries store.
   */
  loadFromSavedQueries: (nameOrGlob: string) => Promise<{ name: string; sql: string }[] | null>
}

export async function resolveBulkInputs(inputs: string[], deps: BulkDeps): Promise<BulkInput[]> {
  const out: BulkInput[] = []
  for (const raw of inputs) {
    if (!raw.startsWith('@')) {
      out.push({ sql: raw })
      continue
    }
    const ref = raw.slice(1) // strip leading @
    if (ref.includes('*')) {
      // Preserve saved-query glob precedence, then fall back to filesystem
      // globs such as @queries/*.sql.
      const hits = await deps.loadFromSavedQueries(ref)
      if (hits !== null) {
        for (const h of hits) {
          out.push({ label: h.name, sql: h.sql })
        }
        continue
      }

      const glob = new Bun.Glob(ref)
      const filePaths: string[] = []
      for await (const filePath of glob.scan({ absolute: true, onlyFiles: true })) {
        filePaths.push(filePath)
      }
      filePaths.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
      if (filePaths.length === 0) {
        throw new Error(`No saved queries or files match glob '${ref}'`)
      }
      for (const filePath of filePaths) {
        appendFileInputs(out, filePath, await Bun.file(filePath).text())
      }
      continue
    }
    // First try saved-query store
    const hits = await deps.loadFromSavedQueries(ref)
    if (hits !== null) {
      for (const h of hits) {
        out.push({ label: h.name, sql: h.sql })
      }
      continue
    }
    // Fallback: treat as file path
    if (!existsSync(ref)) {
      throw new Error(`No such file or saved query: '${ref}'`)
    }
    appendFileInputs(out, ref, await readFile(ref, 'utf-8'))
  }
  return out
}

function appendFileInputs(out: BulkInput[], filePath: string, text: string): void {
  const statements = splitSqlStatements(text)
  const base = path.basename(filePath)
  statements.forEach((sql, index) => {
    out.push({ label: `${base}#${index + 1}`, sql })
  })
}

/**
 * Split SQL files without treating semicolons in literals, quoted identifiers,
 * comments, or PostgreSQL dollar-quoted bodies as statement boundaries.
 * Comments remain attached to their statement so parser-relevant directives
 * and source context are not discarded.
 */
export function splitSqlStatements(text: string): string[] {
  const statements: string[] = []
  let current = ''
  let hasCode = false
  let mode:
    | 'normal'
    | 'single'
    | 'double'
    | 'backtick'
    | 'line-comment'
    | 'block-comment'
    | 'dollar' = 'normal'
  let blockDepth = 0
  let dollarDelimiter = ''

  const flush = () => {
    const statement = current.trim()
    if (hasCode && statement.length > 0) statements.push(statement)
    current = ''
    hasCode = false
  }

  for (let index = 0; index < text.length; index++) {
    const char = text[index]!
    const next = text[index + 1]

    if (mode === 'line-comment') {
      current += char
      if (char === '\n' || char === '\r') mode = 'normal'
      continue
    }

    if (mode === 'block-comment') {
      if (char === '/' && next === '*') {
        current += '/*'
        blockDepth++
        index++
      } else if (char === '*' && next === '/') {
        current += '*/'
        blockDepth--
        index++
        if (blockDepth === 0) mode = 'normal'
      } else {
        current += char
      }
      continue
    }

    if (mode === 'dollar') {
      if (text.startsWith(dollarDelimiter, index)) {
        current += dollarDelimiter
        index += dollarDelimiter.length - 1
        mode = 'normal'
      } else {
        current += char
      }
      continue
    }

    if (mode !== 'normal') {
      current += char
      const quote =
        mode === 'single' ? "'" : mode === 'double' ? '"' : '`'
      if (char === '\\' && next !== undefined) {
        current += next
        index++
      } else if (char === quote && next === quote) {
        current += next
        index++
      } else if (char === quote) {
        mode = 'normal'
      }
      continue
    }

    if (char === '-' && next === '-') {
      current += '--'
      mode = 'line-comment'
      index++
      continue
    }
    if (char === '#') {
      current += char
      mode = 'line-comment'
      continue
    }
    if (char === '/' && next === '*') {
      current += '/*'
      mode = 'block-comment'
      blockDepth = 1
      index++
      continue
    }
    if (char === "'" || char === '"' || char === '`') {
      current += char
      hasCode = true
      mode =
        char === "'" ? 'single' : char === '"' ? 'double' : 'backtick'
      continue
    }
    if (char === '$') {
      const delimiter = text
        .slice(index)
        .match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/)?.[0]
      if (delimiter) {
        current += delimiter
        hasCode = true
        dollarDelimiter = delimiter
        mode = 'dollar'
        index += delimiter.length - 1
        continue
      }
    }
    if (char === ';') {
      flush()
      continue
    }

    current += char
    if (!/\s/.test(char)) hasCode = true
  }

  flush()
  return statements
}
