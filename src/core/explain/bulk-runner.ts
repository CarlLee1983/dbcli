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
 * Strip -- and block comments, then split on `;`. Ignores empty trailing.
 * Naive — does not handle `;` inside string literals. Acceptable for
 * EXPLAIN-only workflows where the SQL is read by a human, not generated.
 */
function splitSqlStatements(text: string): string[] {
  const noLineComments = text.replace(/--[^\n]*\n?/g, '\n')
  const noBlockComments = noLineComments.replace(/\/\*[\s\S]*?\*\//g, ' ')
  return noBlockComments
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}
