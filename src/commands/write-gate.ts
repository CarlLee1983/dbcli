/**
 * How hard a statement is to confirm.
 *
 * Two tiers. Tier one is any write: a summary and a yes/no, which an automated
 * caller may skip with `--yes` because a person deciding to run a hundred
 * routine updates should not have to answer a hundred questions. Tier two is
 * the shape that destroys a table in one keystroke — an UPDATE or DELETE with
 * no WHERE, a DROP, a TRUNCATE — and it has no flag. The operator types the
 * target table name, or nothing runs.
 *
 * The escape route for tier two is deliberately not a flag but the statement
 * itself: adding `WHERE 1=1` or a `LIMIT` says the same thing a flag would, and
 * has one property a flag does not — it cannot be applied uniformly. Appending
 * it to a statement that already has a WHERE is a syntax error, so the habit of
 * "just add it everywhere" breaks on the first ordinary statement and never
 * becomes muscle memory. Any future proposal to simplify this back into a flag
 * should be weighed against that property rather than against convenience.
 *
 * This module answers only what the statement is. Whether anyone is watching,
 * what the connection is permitted to do, and how the question is worded are
 * decided by the caller.
 */

import {
  classifyStatement,
  containsMultipleStatements,
  findWriteKeyword,
  type SqlDialect,
  type StatementType,
} from '@/core/permission-guard'
import { stripCommentsAndStrings } from '@/core/permission/sql-analysis'

export type WriteGateTier = 'none' | 'one' | 'two'

export type WriteGateReason =
  /** UPDATE or DELETE that would touch every row. */
  | 'no_where'
  /** DROP or TRUNCATE — destruction with no WHERE clause to qualify it. */
  | 'ddl_destruction'
  /** The parser could not read it, so it is assumed to be the worse case. */
  | 'unparseable'
  /** Several statements in one string: the tier of the tail cannot be read off the head. */
  | 'multiple_statements'
  /** A structured update/delete whose WHERE selects by nothing unique. */
  | 'non_unique_where'

export interface WriteGateVerdict {
  tier: WriteGateTier
  reason?: WriteGateReason
  /** The table the statement would change, when one can be named. */
  table?: string
  /** What the statement was understood to be, for the summary a person reads. */
  operation?: StatementType
  /** What the operator must type to satisfy tier two. Never translated. */
  confirmationPhrase: string
}

/**
 * What to type when no single table can be named.
 *
 * Stays English in every locale on purpose: a table name is an identifier and
 * carries no language, and the moment a locale setting decides what a person
 * must type to stop a destructive write is the moment a confirmation can be
 * rejected for reasons that have nothing to do with intent.
 */
export const WRITE_GATE_FALLBACK_PHRASE = 'CONFIRM'

const PARSER_DIALECTS: Record<SqlDialect, string> = {
  mysql: 'MySQL',
  mariadb: 'MariaDB',
  postgresql: 'Postgresql',
}

const WRITE_TYPES = new Set<StatementType>([
  'INSERT',
  'UPDATE',
  'DELETE',
  'TRUNCATE',
  'DROP',
  'ALTER',
  'CREATE',
])

/**
 * The single table a `DROP TABLE` / `TRUNCATE` names, or nothing.
 *
 * Deliberately narrow. A loose match returned the first word after the keyword,
 * which meant `DROP DATABASE prod` asked the operator to type `DATABASE` and
 * `DROP INDEX i ON users` asked for `INDEX` — a phrase that can be produced
 * without reading what the statement targets is not a confirmation. Anything
 * this does not match (a database, an index, a view, a multi-table drop) gets
 * the fallback phrase and an untargeted warning instead of a wrong name.
 */
const DDL_TARGET =
  /\b(?:DROP\s+TABLE|TRUNCATE(?:\s+TABLE)?)\s+(?:IF\s+EXISTS\s+)?([`"[\]\w$.]+)\s*;?\s*$/i

/**
 * Classify a raw SQL statement against the two-tier gate.
 *
 * The first pass reuses the permission guard's classifier — the one place that
 * already knows how to strip comments and string literals and how to find the
 * write inside a CTE — so the gate and the permission system can never disagree
 * about whether a statement writes.
 *
 * The AST parser is loaded only once a statement is known to be an UPDATE or
 * DELETE, which is what keeps ordinary reads from paying for it.
 */
export async function classifySqlWriteGate(
  sql: string,
  options: { dialect?: SqlDialect } = {}
): Promise<WriteGateVerdict> {
  const { dialect } = options
  const classification = classifyStatement(sql)
  const hiddenWrite = findWriteKeyword(sql, dialect ? [dialect] : undefined)

  const type: StatementType | undefined = WRITE_TYPES.has(classification.type)
    ? classification.type
    : hiddenWrite
      ? keywordToType(hiddenWrite)
      : undefined

  if (type === undefined) return { tier: 'none', confirmationPhrase: WRITE_GATE_FALLBACK_PHRASE }

  // A semicolon-separated string is one statement to the classifier and several
  // to the driver. `SELECT 1; DELETE FROM users` would otherwise be read off its
  // head and pass as tier one while the tail empties a table. The permission
  // guard already refuses this below admin; the gate refuses it at every level,
  // because "which tier is this" has no single answer for a list.
  if (containsMultipleStatements(sql, dialect)) {
    return verdict('two', 'multiple_statements', undefined, type)
  }

  if (type === 'DROP' || type === 'TRUNCATE') {
    const matched = DDL_TARGET.exec(sql)?.[1]
    const table = matched ? matched.replace(/[`"[\]]/g, '') : undefined
    return verdict('two', 'ddl_destruction', table, type)
  }

  if (type !== 'UPDATE' && type !== 'DELETE') return verdict('one', undefined, undefined, type)

  return await classifyQualification(sql, dialect, type)
}

/**
 * Does this UPDATE/DELETE limit what it touches?
 *
 * A WHERE clause or a LIMIT qualifies it; anything else — including a statement
 * the parser rejects — does not. Failing to parse resolves towards tier two
 * rather than tier one because the cost of being wrong is asymmetric: a
 * needlessly typed table name against a table needlessly emptied.
 */
async function classifyQualification(
  sql: string,
  dialect: SqlDialect | undefined,
  type: StatementType
): Promise<WriteGateVerdict> {
  const { sqlParser } = await import('@/core/sql-parser')

  let ast: unknown
  try {
    ast = sqlParser().astify(sql, { database: PARSER_DIALECTS[dialect ?? 'mysql'] })
  } catch {
    return unparseable(sql, dialect, type)
  }

  const statement = (Array.isArray(ast) ? ast[0] : ast) as {
    where?: unknown
    limit?: unknown
    table?: Array<{ db?: string | null; table?: string }>
    from?: Array<{ db?: string | null; table?: string }>
  } | null

  if (!statement) return unparseable(sql, dialect, type)

  const table = tableName(statement.from?.[0] ?? statement.table?.[0])

  if (statement.where != null || statement.limit != null) {
    return verdict('one', undefined, table, type)
  }

  return verdict('two', 'no_where', table, type)
}

/**
 * What to do with a statement the parser rejected.
 *
 * "Unreadable" resolves to tier two, but not when the text plainly contains a
 * `WHERE` or `LIMIT` outside comments and string literals. The parser's grammar
 * is narrower than the dialects dbcli connects to — PostgreSQL's
 * `DELETE … USING …` and a CTE-wrapped `DELETE` are both valid, both qualified,
 * and both rejected — and a correct statement with no reachable escape route
 * would leave unattended callers permanently locked out of ordinary work. The
 * gate exists to catch statements that touch everything, and one of these does
 * not.
 */
function unparseable(
  sql: string,
  dialect: SqlDialect | undefined,
  type: StatementType
): WriteGateVerdict {
  const executable = stripCommentsAndStrings(sql, dialect ? { dialect } : {})
  if (/\bWHERE\b|\bLIMIT\b/i.test(executable)) return verdict('one', undefined, undefined, type)
  return verdict('two', 'unparseable', undefined, type)
}

/** Just enough of a table schema to say whether a set of columns identifies a row. */
export interface UniquenessFacts {
  primaryKey?: string[] | string
  columns?: Array<{ name: string; primaryKey?: boolean }>
  indexes?: Array<{ columns: string[]; unique: boolean }>
}

/**
 * The tier for a structured `update` / `delete`.
 *
 * Their WHERE is mandatory, so the raw-SQL criterion ("is there a WHERE at
 * all") can never fire. What matters instead is whether the conditions pin the
 * write to particular rows: matching on a primary key or a unique index does,
 * matching on a status column does not, however much it reads like a filter.
 *
 * Synchronous and parser-free — the conditions arrive already parsed and the
 * schema is already in hand at the only call site.
 */
export function classifyStructuredWriteGate(request: {
  table: string
  where: Record<string, unknown>
  schema: UniquenessFacts
}): WriteGateVerdict {
  const conditions = new Set(Object.keys(request.where).map((key) => key.toLowerCase()))

  const identifies = uniqueSelectors(request.schema).some(
    (selector) =>
      selector.length > 0 && selector.every((column) => conditions.has(column.toLowerCase()))
  )

  if (identifies) return verdict('one', undefined, request.table)
  return verdict('two', 'non_unique_where', request.table)
}

/**
 * Every column set that identifies at most one row: the primary key, and each
 * unique index. A composite key counts only when the conditions cover all of
 * its columns — half a composite key selects a range.
 */
function uniqueSelectors(schema: UniquenessFacts): string[][] {
  const declared = schema.primaryKey
  const primaryKey = Array.isArray(declared)
    ? declared
    : typeof declared === 'string'
      ? [declared]
      : (schema.columns ?? []).filter((column) => column.primaryKey).map((column) => column.name)

  const unique = (schema.indexes ?? [])
    .filter((index) => index.unique)
    .map((index) => index.columns)

  return [primaryKey, ...unique]
}

function tableName(ref: { db?: string | null; table?: string } | undefined): string | undefined {
  if (!ref?.table) return undefined
  return ref.db ? `${ref.db}.${ref.table}` : ref.table
}

function keywordToType(keyword: string): StatementType | undefined {
  const upper = keyword.toUpperCase()
  if (WRITE_TYPES.has(upper as StatementType)) return upper as StatementType
  // MERGE, UPSERT, REPLACE, GRANT, RENAME and friends write, but none of them
  // has the shape tier two exists to catch. They get the ordinary gate.
  return 'INSERT'
}

function verdict(
  tier: WriteGateTier,
  reason?: WriteGateReason,
  table?: string,
  operation?: StatementType
): WriteGateVerdict {
  return {
    tier,
    ...(reason && { reason }),
    ...(table && { table }),
    ...(operation && { operation }),
    confirmationPhrase: table ?? WRITE_GATE_FALLBACK_PHRASE,
  }
}
