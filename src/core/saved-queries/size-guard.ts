import { stripCommentsAndStrings } from './parser'

const GUARD_LIMIT = 1000

export interface GuardOptions {
  noLimit: boolean
}

export function applySnippetGuard(sqlBody: string, opts: GuardOptions): string {
  const trimmed = sqlBody.trim().replace(/;\s*$/, '')
  if (opts.noLimit) return trimmed

  const masked = stripCommentsAndStrings(trimmed)
  const literal = matchOuterLiteralLimit(masked)
  if (literal !== null && literal < GUARD_LIMIT) return trimmed

  return `SELECT * FROM (${trimmed}) AS _dbcli_guard LIMIT ${GUARD_LIMIT}`
}

function matchOuterLiteralLimit(masked: string): number | null {
  const m = masked.match(/\bLIMIT\s+(\d+)\s*$/i)
  return m ? parseInt(m[1]!, 10) : null
}
