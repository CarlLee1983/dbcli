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
  /**
   * The write brings in a second table, so whether it is limited to particular
   * rows is not a property of the statement at all.
   */
  | 'multi_table'
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
 * A LIMIT qualifies it outright. A WHERE qualifies it only when the WHERE is
 * about the table being written — see `narrowsTarget`, and #80 for the
 * measurement that made the distinction necessary. Anything else, including a
 * statement the parser rejects, does not: failing to parse resolves towards tier
 * two because the cost of being wrong is asymmetric — a needlessly typed table
 * name against a table needlessly emptied.
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

  const statement = (Array.isArray(ast) ? ast[0] : ast) as ParsedWrite | null

  // The classifier said this writes, so anything the parser hands back that is
  // not the write itself is a statement this path cannot judge. `WITH z AS
  // (UPDATE p SET c = 1 RETURNING *) SELECT count(*) FROM z` parses as a SELECT
  // whose `limit` is an empty object rather than null — enough to satisfy the
  // row-cap branch below and wave through a write of every row.
  if (!statement || (statement.type !== 'update' && statement.type !== 'delete')) {
    return unparseable(sql, dialect, type)
  }

  const scope = [...(statement.table ?? []), ...(statement.from ?? [])]
  // The same table fills both slots for a plain `DELETE FROM t`, so sources are
  // counted by identity — schema included, since two schemas hold the same table
  // name — and an unnamed source (a function, a derived table) gets its own key.
  const sources = new Set(scope.map((ref, index) => refIdentity(ref) ?? `#unnamed-${index}`))

  if (sources.size > 1) {
    // Whether a multi-table write is limited to particular rows is not decidable
    // from the statement: `DELETE p FROM p JOIN o ON p.id = o.ref WHERE o.x > 0`
    // deleted 2 of 5 rows against one dataset and all 2000 against another. Five
    // rounds of measurement were spent trying to read it off the syntax, and each
    // criterion that seemed to work was defeated by the next ordinary spelling —
    // a join's ON necessarily names the target, so it is evidence of nothing.
    // The tier is therefore decided by what the statement is, which is knowable,
    // rather than by what it will touch, which is not.
    return verdict('two', 'multi_table', undefined, type)
  }

  const target = normaliseRef(statement.table?.[0] ?? scope[0])
  const table = tableName(target)

  // A row cap bounds the write whatever it selects, so it qualifies on its own.
  if (statement.limit != null) return verdict('one', undefined, table, type)

  if (statement.where != null && narrowsTarget(statement.where, refNames(target))) {
    return verdict('one', undefined, table, type)
  }

  return verdict('two', 'no_where', table, type)
}

interface ColumnRef {
  type?: string
  table?: string | null
}

interface TableRef {
  db?: string | null
  table?: string
  as?: string | null
  on?: unknown
}

interface ParsedWrite {
  type?: string
  where?: unknown
  limit?: unknown
  table?: TableRef[]
  from?: TableRef[]
}

/**
 * The reference as the rest of the statement sees it.
 *
 * PostgreSQL's `ONLY` — "do not descend into child tables" — is read by the
 * parser as the table name, putting the real name in the alias slot. Left alone
 * it made every `ONLY` source share one identity, so `UPDATE ONLY p SET c = 1
 * FROM ONLY o WHERE total = 1` counted as single-table and let the unqualified
 * `total`, which exists only on `o`, pass as evidence about `p`. It rewrote all
 * 2000 rows.
 */
function normaliseRef(ref: TableRef | undefined): TableRef | undefined {
  if (ref?.table?.toUpperCase() !== 'ONLY') return ref
  // A real table can be called `only` — it is not reserved in MySQL and can be
  // quoted in PostgreSQL — and then there is no alias holding the real name.
  // Rewriting it anyway refused `UPDATE "only" SET c = 'x' WHERE "only".id = 1`,
  // a single-row write by primary key.
  if (typeof ref.as !== 'string' || ref.as.length === 0) return ref
  // The alias slot holds the real name, so it becomes the name and the reference
  // is left without an alias.
  return {
    db: ref.db,
    on: ref.on,
    as: null,
    table: typeof ref.as === 'string' ? ref.as : undefined,
  }
}

/**
 * A table reference's own name, schema included, lowercased.
 *
 * Qualified, because two schemas routinely hold the same table name and reading
 * them as one table made `UPDATE s1.t SET … FROM s2.t AS y WHERE y.k = 1` look
 * single-table — which let `y`, an alias of the *joined* table, pass as evidence
 * about the target. It rewrote all 2000 rows.
 */
function refIdentity(reference: TableRef | undefined): string | undefined {
  const ref = normaliseRef(reference)
  if (typeof ref?.table !== 'string') return undefined
  return (ref.db ? `${ref.db}.${ref.table}` : ref.table).toLowerCase()
}

/**
 * What a reference can be addressed by in the rest of the statement.
 *
 * An alias replaces the name rather than adding to it — `UPDATE users AS x …
 * WHERE users.id = 1` is an error, not a reference to the target. Keeping both
 * meant a joined table aliased to the target's real name
 * (`UPDATE users AS x SET … FROM orders AS users WHERE users.id = 1`) supplied
 * evidence about the target and rewrote every row.
 */
function refNames(reference: TableRef | undefined): string[] {
  const ref = normaliseRef(reference)
  const name = typeof ref?.as === 'string' && ref.as.length > 0 ? ref.as : ref?.table
  return typeof name === 'string' ? [name.toLowerCase()] : []
}

/**
 * Does this WHERE actually restrict the table being written?
 *
 * "Is there a WHERE" and "does the WHERE narrow this write" are different
 * questions, and the gate used to ask the first one (#80, #93). This asks the
 * second, for the case where it is answerable: one table, so a condition either
 * says something about it or says nothing about it.
 *
 * The evidence is a reference to the target — a column of it named in the WHERE,
 * or a correlated reference to it from inside a subquery. An unqualified column
 * counts, because with one table in scope it can only be the target's. A WHERE
 * that lives entirely inside a subquery does not: `UPDATE p SET c = (SELECT …
 * WHERE …)` has a WHERE and touches every row, and
 * `DELETE FROM p WHERE EXISTS (SELECT 1 FROM o WHERE o.id = 1)` deleted all 2000.
 *
 * A condition that names no column at all — `WHERE 1=1` — still qualifies. That
 * is the escape route ADR 0010 deliberately chose over a flag: it is a statement
 * of intent, typed into the statement itself, and it says nothing about any
 * table precisely because it is not trying to.
 *
 * This is a lower bound, not a proof. `WHERE id IS NOT NULL` names the target and
 * still touches every row; no static check settles that, and the gate is not
 * trying to. What it rules out is the class where nothing in the condition is
 * about the table being written.
 */
function narrowsTarget(where: unknown, targetNames: string[]): boolean {
  const names = new Set(targetNames)
  const { owners, correlated, skippedSubquery } = scanCondition(where)

  if (owners.length === 0 && correlated.length === 0) return !skippedSubquery
  return (
    owners.some((owner) => owner === null || names.has(owner)) ||
    correlated.some((owner) => names.has(owner))
  )
}

interface ConditionScan {
  /** Tables owning the columns named at this level; `null` for an unqualified one. */
  owners: Array<string | null>
  /**
   * Tables named by columns inside a subquery, qualified ones only.
   *
   * A correlated reference to the target — `EXISTS (SELECT 1 FROM o WHERE
   * o.tid = t.id)` — is exactly the evidence this criterion asks for, and
   * refusing to look inside refused the standard "delete the matching rows"
   * idiom. An unqualified column inside a subquery is dropped, because it
   * resolves against the subquery's own tables and says nothing about the write.
   */
  correlated: string[]
  /** Whether a subquery was stepped over on the way. */
  skippedSubquery: boolean
}

const EMPTY_SCAN: ConditionScan = { owners: [], correlated: [], skippedSubquery: false }

function mergeScans(scans: ConditionScan[]): ConditionScan {
  return {
    owners: scans.flatMap((scan) => scan.owners),
    correlated: scans.flatMap((scan) => scan.correlated),
    skippedSubquery: scans.some((scan) => scan.skippedSubquery),
  }
}

/**
 * Which tables a condition's columns belong to, and whether it hid a subquery.
 *
 * A subquery's own conditions restrict the rows the subquery returns, not the
 * rows this statement writes — `UPDATE p SET c = (SELECT … WHERE …)` has a WHERE
 * and touches every row — so its columns are collected separately and only the
 * qualified ones are kept. That the subquery was there at all is reported too,
 * because a condition consisting only of one names no column at this level and
 * must not be read as the deliberate `WHERE 1=1`.
 */
function scanCondition(node: unknown, bound?: Set<string>): ConditionScan {
  if (node === null || typeof node !== 'object') return EMPTY_SCAN
  const record = node as Record<string, unknown>

  // A nested SELECT, in either of the shapes the parser produces for one.
  const inner = (record.ast ?? (record.type === 'select' ? record : undefined)) as
    | Record<string, unknown>
    | undefined
  const nested = inner !== undefined

  if (record.type === 'column_ref') {
    const owner = (record as ColumnRef).table
    const name = owner == null ? null : String(owner).toLowerCase()
    if (bound === undefined) return { owners: [name], correlated: [], skippedSubquery: false }
    // Inside a subquery. A qualifier the subquery binds itself is not a
    // correlation, however much it looks like the target: `EXISTS (SELECT 1 FROM
    // o AS p WHERE p.id = 1)` and `EXISTS (SELECT 1 FROM p WHERE p.id = 1)` are
    // both entirely about the subquery, and both deleted every row while the
    // gate read them as evidence about `p`.
    if (name === null || bound.has(name)) return EMPTY_SCAN
    return { owners: [], correlated: [name], skippedSubquery: false }
  }

  const scope = nested ? new Set([...(bound ?? []), ...boundNames(inner)]) : bound
  const scans = Object.values(record).map((value) =>
    Array.isArray(value)
      ? mergeScans(value.map((item) => scanCondition(item, scope)))
      : scanCondition(value, scope)
  )
  const merged = mergeScans(scans)
  return nested ? { ...merged, skippedSubquery: true } : merged
}

/** Every identifier a SELECT introduces in its own FROM clause, lowercased. */
function boundNames(select: Record<string, unknown> | undefined): string[] {
  const from = (select?.from ?? []) as TableRef[]
  return Array.isArray(from) ? from.flatMap((ref) => refNames(ref)) : []
}

/**
 * The statement with every parenthesised group removed.
 *
 * A keyword inside parentheses is not at statement level: `SUBSTRING(name FROM
 * 2 FOR 3)` and `AGAINST ('a' WITH QUERY EXPANSION)` carry a `FROM` and a `WITH`
 * that have nothing to do with a second table.
 */
function stripParenthesised(text: string): string {
  let previous = text
  for (;;) {
    const next = previous.replace(/\([^()]*\)/g, ' ')
    if (next === previous) return next
    previous = next
  }
}

/**
 * A statement the text can show is a write to exactly one table.
 *
 * `UPDATE <name> SET …` or `DELETE FROM <name> …`, with nothing between the
 * keyword and the name but PostgreSQL's `ONLY`, and no comma after it. Anything
 * else — a second name, a list — fails to match and resolves upwards.
 */
const SINGLE_TARGET =
  /^\s*(?:UPDATE\s+(?:ONLY\s+)?[\w`"[\]$.]+\s+SET\b|DELETE\s+FROM\s+(?:ONLY\s+)?[\w`"[\]$.]+(?!\s*,)(?:\s|$))/i

/**
 * The keywords that can start a query, and the ones that join one.
 *
 * A subquery in SQL begins with `SELECT`, `TABLE` or `VALUES` — that is the
 * complete set, which is what makes this a bound rather than a list of the
 * spellings someone thought of. Four rounds of review defeated the previous
 * denylist one keyword at a time: `USING`, then `JOIN`, then a CTE, then a
 * subquery, then `TABLE` as a subquery. Grounding it in the grammar's own set of
 * query openers is what stops that.
 */
const SECOND_SOURCE_ANYWHERE = /\b(?:SELECT|TABLE|VALUES|JOIN|USING)\b/i

/**
 * The two that need the parenthesis-stripped text instead.
 *
 * `WITH` opens a CTE at statement level and modifies a fulltext match inside
 * parentheses (`AGAINST ('a' WITH QUERY EXPANSION)`); `FROM` joins an UPDATE at
 * statement level and slices a string inside them (`SUBSTRING(x FROM 2)`).
 * Testing them where they mean what this scan is asking about is what separates
 * the two, and it is why the CTE spellings that defeated a narrowed `WITH`
 * pattern — `WITH c (x) AS (…)`, `WITH"c"AS(…)` — cannot defeat this one.
 */
const SECOND_SOURCE_AT_STATEMENT_LEVEL = [/\bWITH\b/i, /\bUPDATE\b[\s\S]*?\bFROM\b/i]

function unparseable(
  sql: string,
  dialect: SqlDialect | undefined,
  type: StatementType
): WriteGateVerdict {
  const executable = stripCommentsAndStrings(sql, dialect ? { dialect } : {})

  // Written as an allowlist. The rule this path has to enforce is the same one
  // the parsed path enforces — one table, and a WHERE about it — and with no
  // parse tree the only honest way to apply it is to require the statement to
  // *look* like nothing else. Asking instead which second tables are present can
  // only ever rule out the shapes someone remembered.
  const statementLevel = stripParenthesised(executable)
  const singleTable =
    SINGLE_TARGET.test(executable) &&
    !SECOND_SOURCE_ANYWHERE.test(executable) &&
    !SECOND_SOURCE_AT_STATEMENT_LEVEL.some((pattern) => pattern.test(statementLevel))
  if (!singleTable) return verdict('two', 'unparseable', undefined, type)

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
  // UPSERT, REPLACE, GRANT, RENAME and friends write, but none of them has the
  // shape tier two exists to catch, so they get the ordinary gate.
  //
  // MERGE does have it, and this line is why it is not caught: measured against
  // a 2000-row table, `MERGE INTO p USING (SELECT 1 AS x) s ON true WHEN MATCHED
  // THEN DELETE` deleted all 2000 as tier one. Left as it is here rather than
  // half-fixed — a MERGE carries a whole list of actions and needs its own
  // classification, not a keyword substitution (#95).
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
