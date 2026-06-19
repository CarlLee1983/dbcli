import { boundedReason, tableRefsMatch } from './scenario'

/** Remove single- and double-quoted string literals so delimiters inside them don't trip checks. */
function stripStringLiterals(sql: string): string {
  return sql.replace(/'(?:[^']|'')*'/g, ' ').replace(/"(?:[^"]|"")*"/g, ' ')
}

/** True when the DDL is a single statement (a single trailing `;` is allowed). */
export function isSingleStatement(sql: string): boolean {
  const stripped = stripStringLiterals(sql).trim().replace(/;\s*$/, '')
  return !stripped.includes(';')
}

/** True when the trimmed statement begins with `ALTER TABLE` (case-insensitive). */
export function isAlterTableDdl(sql: string): boolean {
  return /^\s*ALTER\s+TABLE\b/i.test(stripStringLiterals(sql))
}

/**
 * Extract the (possibly schema-qualified) ALTER TABLE target straight from the SQL.
 * Handles optional `IF EXISTS` and `ONLY`, quoted and schema-qualified names.
 */
export function extractAlterTableTarget(sql: string): string | null {
  const match = sql.match(
    /\bALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?((?:[`"[]?[\w]+[`"\]]?\.){0,2}[`"[]?[\w]+[`"\]]?)/i
  )
  return match?.[1] ?? null
}

/** The migration is only safe when the DDL target matches --table, schema-aware. */
export function ddlTargetMatchesTable(ddl: string, table: string): boolean {
  const target = extractAlterTableTarget(ddl)
  if (!target) return false
  return tableRefsMatch(target, table)
}

/**
 * Classify the proposed migration DDL for the MVP: single-statement ALTER TABLE only.
 * Never executes anything; returns a bounded reason on rejection.
 */
export function classifyMigrationDdl(sql: string): { ok: boolean; reason?: string } {
  if (!isSingleStatement(sql)) {
    return { ok: false, reason: boundedReason('--ddl must be a single statement (no `;`-separated statements).') }
  }
  if (!isAlterTableDdl(sql)) {
    return {
      ok: false,
      reason: boundedReason('--ddl must be an ALTER TABLE statement; the MVP blocks CREATE/DROP/INDEX and other DDL.'),
    }
  }
  return { ok: true }
}
