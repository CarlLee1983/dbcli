import { stripCommentsAndStrings } from './parser'

/** Row cap the snippet guard enforces when the snippet does not cap itself. */
export const SNIPPET_GUARD_LIMIT = 1000

export interface GuardOptions {
  noLimit: boolean
}

export interface GuardResult {
  sql: string
  /**
   * Set only when dbcli owns the cap. The wrapped SQL fetches one extra row so
   * the caller can tell "exactly N rows" from "cut down to N rows"; callers
   * trim the lookahead with trimAppliedLimit().
   */
  guardLimit?: number
}

export function applySnippetGuard(sqlBody: string, opts: GuardOptions): GuardResult {
  const trimmed = sqlBody.trim().replace(/;\s*$/, '')
  if (opts.noLimit) return { sql: trimmed }

  const masked = stripCommentsAndStrings(trimmed)
  const literal = matchOuterLiteralLimit(masked)
  if (literal !== null && literal < SNIPPET_GUARD_LIMIT) return { sql: trimmed }

  return {
    sql: `SELECT * FROM (${trimmed}) AS _dbcli_guard LIMIT ${SNIPPET_GUARD_LIMIT + 1}`,
    guardLimit: SNIPPET_GUARD_LIMIT,
  }
}

function matchOuterLiteralLimit(masked: string): number | null {
  const m = masked.match(/\bLIMIT\s+(\d+)\s*$/i)
  return m ? parseInt(m[1]!, 10) : null
}
