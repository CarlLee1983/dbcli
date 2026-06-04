// src/proxy/sql-metadata.ts

const KNOWN_KEYWORDS = [
  'SELECT', 'INSERT', 'UPDATE', 'DELETE',
  'CREATE', 'ALTER', 'DROP', 'TRUNCATE',
  'BEGIN', 'COMMIT', 'ROLLBACK', 'SET', 'SHOW', 'USE',
] as const
type KnownKeyword = (typeof KNOWN_KEYWORDS)[number]
export type StatementType = KnownKeyword | 'OTHER'
const KNOWN: ReadonlySet<string> = new Set(KNOWN_KEYWORDS)

/** Best-effort statement-type detection from the leading keyword. */
export function detectStatement(sql: string): StatementType {
  const m = sql.trim().match(/^([a-zA-Z]+)/)
  if (!m || !m[1]) return 'OTHER'
  const kw = m[1].toUpperCase()
  return KNOWN.has(kw) ? (kw as StatementType) : 'OTHER'
}

const TABLE_RE =
  /\b(?:FROM|JOIN|INTO|UPDATE)\s+["'`]?([A-Za-z_]\w*)["'`]?(?:\.["'`]?([A-Za-z_]\w*)["'`]?)?/gi

/** Best-effort table extraction. Returns deduped, schema-stripped names. */
export function extractTables(sql: string): string[] {
  const seen = new Set<string>()
  for (const m of sql.matchAll(TABLE_RE)) {
    const name = m[2] ?? m[1]
    if (name) seen.add(name)
  }
  return [...seen]
}

/** Replace single-quoted strings and numeric literals with '?'. Identifiers untouched. */
export function redactLiterals(sql: string): string {
  const noStrings = sql.replace(/'(?:[^']|'')*'/g, '?')
  return noStrings.replace(/\b\d+(?:\.\d+)?\b/g, '?')
}
