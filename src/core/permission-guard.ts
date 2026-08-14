/**
 * Permission Guard Module — SQL classification and permission enforcement
 *
 * Responsibility: Classify SQL statements and enforce permission rules
 * before command execution.
 *
 * Safety principle: Whitelist approach — only allow explicitly safe operations.
 * If classification is uncertain, block with clear error message.
 */

import type { Permission } from '@/types'
import { t, t_vars } from '@/i18n/message-loader'
import {
  normalizeSQL,
  stripCommentsAndStrings,
  detectCompositePatterns,
  extractFirstKeyword,
  mapKeywordToType,
  isDestructiveOperation,
  extractAllKeywords,
  determineConfidence,
} from '@/core/permission/sql-analysis'

/**
 * SQL statement type enumeration
 */
export type StatementType =
  | 'SELECT'
  | 'INSERT'
  | 'UPDATE'
  | 'DELETE'
  | 'ALTER'
  | 'DROP'
  | 'CREATE'
  | 'TRUNCATE'
  | 'SHOW'
  | 'DESCRIBE'
  | 'EXPLAIN'
  | 'UNKNOWN'

/**
 * Classification result for a SQL statement
 */
export interface StatementClassification {
  type: StatementType
  isDangerous: boolean
  keywords: string[]
  isComposite: boolean
  confidence: 'HIGH' | 'MEDIUM' | 'LOW'
  /**
   * Set when a read-looking statement was re-classified because it contains an
   * executable write. Holds that keyword, so a refusal can say what was found
   * rather than reporting the statement as unrecognised.
   */
  escalatedFrom?: string
}

/**
 * Permission check result with classification
 */
export interface PermissionCheckResult {
  allowed: boolean
  reason: string
  classification: StatementClassification

  /**
   * The lowest level that would have allowed this, on a refusal.
   *
   * Every command prints it as `required:` above the reason, and the throw
   * sites used to pass the level the caller already had — so a query-only user
   * read `required: query-only` directly above a sentence saying the statement
   * needs admin. The branch that decides the refusal is the only place that
   * knows the answer (a hidden write needs admin whatever its type says, an
   * unrecognised statement needs read-write, an ordinary type needs its tier),
   * so it is decided there and carried out with the verdict rather than
   * re-derived by whoever throws.
   */
  requiredPermission?: Permission
}

/**
 * Permission denied error with classification details
 */
export class PermissionError extends Error {
  constructor(
    message: string,
    public classification: StatementClassification,
    public requiredPermission: Permission
  ) {
    super(message)
    this.name = 'PermissionError'
    // Ensure proper prototype chain for instanceof checks
    Object.setPrototypeOf(this, PermissionError.prototype)
  }
}

// ============================================================================
// MAIN API FUNCTIONS
// ============================================================================

/**
 * Classify SQL statement into operation type
 * Uses whitelist approach: only return confident classifications
 */
export function classifyStatement(sql: string): StatementClassification {
  const normalized = normalizeSQL(sql)
  const stripped = stripCommentsAndStrings(normalized)
  const upper = stripped.toUpperCase()

  // MariaDB/MySQL: 'ANALYZE SELECT ...' is a read-only EXPLAIN variant.
  // PostgreSQL uses 'EXPLAIN (ANALYZE ...) SELECT ...' which is handled by
  // the regular EXPLAIN keyword classifier; this branch only handles the
  // MariaDB form where ANALYZE is the leading keyword.
  if (/^\s*ANALYZE\s+SELECT\b/i.test(stripped)) {
    return {
      type: 'EXPLAIN',
      isDangerous: false,
      keywords: extractAllKeywords(stripped),
      isComposite: false,
      confidence: 'HIGH',
    }
  }

  const composite = detectCompositePatterns(upper)
  const firstKeyword = extractFirstKeyword(stripped)

  // Map keyword to statement type
  const type = mapKeywordToType(firstKeyword)

  return {
    type,
    isDangerous: isDestructiveOperation(type),
    keywords: extractAllKeywords(stripped),
    isComposite: composite.hasWithClause || composite.hasSubquery,
    confidence: determineConfidence(type, firstKeyword, upper),
  }
}

/**
 * Keywords that write or change schema. Used by every path that has to prove a
 * statement is read-only despite a read-looking leading keyword — data-modifying
 * CTEs, `SELECT … INTO`, and `EXPLAIN ANALYZE` of a write.
 */
/** SQL dialects whose quoting rules differ in ways that affect statement splitting. */
export const SQL_DIALECTS = ['postgresql', 'mysql', 'mariadb'] as const
export type SqlDialect = (typeof SQL_DIALECTS)[number]

/** The SQL dialect of a connection system, or undefined for a non-SQL engine. */
export function toSqlDialect(system: string | undefined): SqlDialect | undefined {
  return SQL_DIALECTS.find((dialect) => dialect === system)
}

export const SQL_WRITE_OR_DDL_KEYWORDS =
  /(?<![.\w])(INSERT|UPDATE|DELETE|MERGE|UPSERT|REPLACE|TRUNCATE|DROP|ALTER|CREATE|GRANT|REVOKE|RENAME|INTO)\b(?!\s*\()/i

/**
 * `FOR UPDATE` and `FOR SHARE` take row locks. They read, and the `UPDATE`
 * inside them must not be mistaken for a write.
 */
const SQL_LOCK_CLAUSE = /\bFOR\s+(?:NO\s+KEY\s+)?UPDATE\b|\bFOR\s+(?:KEY\s+)?SHARE\b/gi

/**
 * The write or DDL keyword a statement would actually execute, or undefined if
 * it proves read-only. Comments, string literals and quoted identifiers are
 * removed per dialect first, so `SELECT \`update\` FROM t` and `# drop this`
 * are reads while `WITH x AS (DELETE …)` is not.
 *
 * With several candidate dialects the check fails closed: a keyword executable
 * under any of them counts, since the body may run under any of them.
 */
export function findWriteKeyword(
  sql: string,
  dialects?: readonly SqlDialect[]
): string | undefined {
  const candidates = dialects && dialects.length > 0 ? dialects : SQL_DIALECTS
  for (const dialect of candidates) {
    const executable = stripCommentsAndStrings(sql, { dialect }).replace(SQL_LOCK_CLAUSE, ' ')
    const match = executable.match(SQL_WRITE_OR_DDL_KEYWORDS)
    if (match?.[1]) return match[1].toUpperCase()
  }
  return undefined
}

/**
 * True when the SQL holds more than one statement, ignoring semicolons inside
 * comments and string literals and a single trailing separator.
 */
export function containsMultipleStatements(sql: string, dialect?: SqlDialect): boolean {
  // Strip the raw SQL. Running a string-blind comment pass first (normalizeSQL)
  // would let `SELECT 'x--' ; DELETE …` lose its tail before it is counted.
  const statementCount = (candidate: SqlDialect): number =>
    stripCommentsAndStrings(sql, { dialect: candidate })
      .split(';')
      .filter((part) => part.trim().length > 0).length

  if (dialect) return statementCount(dialect) > 1

  // Quoting differs per dialect: $$…$$ and $tag$…$tag$ are strings only in
  // PostgreSQL, backticks quote identifiers only in MySQL/MariaDB, and `#`
  // starts a comment in MySQL/MariaDB while PostgreSQL reads it as an operator.
  // Without a dialect to judge by, fail closed — any reading that finds a
  // separator wins, because the alternative hides a separator the real dialect
  // would execute.
  return SQL_DIALECTS.some((candidate) => statementCount(candidate) > 1)
}

/**
 * Read-looking statement types that can nevertheless carry an executable write:
 * a `SELECT` through a CTE or `INTO`, an `EXPLAIN` through `ANALYZE`. `SHOW` and
 * `DESCRIBE` take no subquery, so `SHOW CREATE TABLE users` is a read whose text
 * merely contains a keyword.
 */
const ESCALATABLE_READ_TYPES = new Set<StatementType>(['SELECT', 'EXPLAIN', 'DESCRIBE'])

/**
 * Re-classify a read-looking statement by the write it actually performs, so the
 * permission tiers judge what runs rather than what the statement opens with.
 * Returns the classification unchanged when the statement really is a read.
 */
function escalateHiddenWrite(
  sql: string,
  classification: StatementClassification,
  dialect: SqlDialect | undefined
): StatementClassification {
  if (!ESCALATABLE_READ_TYPES.has(classification.type)) return classification

  // `EXPLAIN` without `ANALYZE` only plans; it never runs the statement it
  // describes, so a write keyword inside it is not executed either. `DESCRIBE`
  // and `DESC` are synonyms for `EXPLAIN` on MySQL and MariaDB and take the same
  // `ANALYZE` form.
  const plansOnly = classification.type === 'EXPLAIN' || classification.type === 'DESCRIBE'
  if (plansOnly && !/\bANALYZE\b/i.test(sql)) return classification

  const hidden = findWriteKeyword(sql, dialect ? [dialect] : undefined)
  if (!hidden) return classification

  // A statement that claims to read and does not is judged admin-only, rather
  // than by the tier of the keyword found. Ranking the keyword invited two
  // rounds of defects: the leftmost write laundered a stricter one, and the
  // textual exceptions needed to rank `INTO` correctly interacted with each
  // other to erase the write completely. A writable CTE below admin is a rare
  // shape; treating every one of them as admin-only costs little and removes
  // the whole class.
  return {
    ...classification,
    type: 'UNKNOWN',
    isDangerous: true,
    confidence: 'HIGH',
    escalatedFrom: hidden,
  }
}

/**
 * Check if statement is allowed under given permission level
 */
export function checkPermission(
  sql: string,
  permission: Permission,
  dialect?: SqlDialect
): PermissionCheckResult {
  // A read-looking leading keyword does not make a statement a read: a CTE can
  // carry DELETE/UPDATE/INSERT … RETURNING, `SELECT … INTO` creates a table, and
  // `EXPLAIN ANALYZE <write>` executes the write it explains. Judging the
  // statement by the write it performs lets the ordinary tiers decide, instead
  // of this proof living only on the multi-connection path as it used to.
  const classification = escalateHiddenWrite(sql, classifyStatement(sql), dialect)

  // Classification describes one statement, but drivers using the simple query
  // protocol (PostgreSQL) execute every semicolon-separated statement in the
  // string. A stacked statement would therefore be judged by its first keyword
  // alone and smuggle a trailing write past the permission level. Admin already
  // permits every statement type, so stacking grants it nothing.
  if (permission !== 'admin' && containsMultipleStatements(sql, dialect)) {
    return {
      allowed: false,
      reason: t('errors.multiple_statements_refused'),
      classification,
      requiredPermission: 'admin',
    }
  }

  return checkPermissionForClassification(classification, permission)
}

/** Types each tier adds to the one below it. */
const TIER_GRANTS: ReadonlyArray<{ permission: Permission; types: readonly StatementType[] }> = [
  { permission: 'query-only', types: ['SELECT', 'SHOW', 'DESCRIBE', 'EXPLAIN'] },
  { permission: 'read-write', types: ['INSERT', 'UPDATE'] },
  { permission: 'data-admin', types: ['DELETE'] },
]

/**
 * The lowest level that permits this statement type.
 *
 * Refusals used to name whichever tier sat one step above the one refusing,
 * which is only right when that tier actually grants the type. It told a
 * query-only user that DELETE "requires read-write", and read-write users that
 * DDL "requires data-admin" — neither of which would have worked. Deriving the
 * answer from the same table the decision uses keeps the advice true.
 */
export function minimumPermissionFor(type: StatementType): Permission {
  return TIER_GRANTS.find((tier) => tier.types.includes(type))?.permission ?? 'admin'
}

/**
 * Say no in the user's language.
 *
 * A refusal is read by whoever was refused, so it goes through the catalogue
 * like every other sentence the CLI puts in front of a person. The permission
 * names themselves are interpolated verbatim: they are the values written in
 * the config file, and translating them would name a level nobody could set.
 */
function refusalReason(type: StatementType, permission: Permission): string {
  return t_vars('errors.permission_requires_level', {
    type,
    minimum: minimumPermissionFor(type),
    permission,
  })
}

/**
 * Decide a classified statement against a permission level.
 *
 * Split out of checkPermission so that callers who already know what they are
 * running — the structured insert/update/delete commands build their own SQL —
 * can reach the same tier rules without round-tripping a statement through the
 * classifier. The guards that precede this in checkPermission (stacked
 * statements, hidden writes) only apply to SQL supplied by a user; a statement
 * this process assembled has neither.
 */
export function checkPermissionForClassification(
  classification: StatementClassification,
  permission: Permission
): PermissionCheckResult {
  // A statement re-classified because it hides a write is refused with what was
  // actually found. The generic messages below name the next tier up, which is
  // wrong here: every tier short of admin refuses it.
  if (permission !== 'admin' && classification.escalatedFrom) {
    return {
      allowed: false,
      reason: t_vars('errors.escalated_write_requires_admin', {
        keyword: classification.escalatedFrom,
        permission,
      }),
      classification,
      requiredPermission: 'admin',
    }
  }

  // Admin allows everything
  if (permission === 'admin') {
    return {
      allowed: true,
      reason: 'Admin permission: all operations allowed',
      classification,
    }
  }

  // Each non-admin tier permits its own types plus everything the tiers below
  // it grant — derived from TIER_GRANTS rather than repeated as a literal per
  // tier, so the two can no longer drift apart.
  const tierIndex = TIER_GRANTS.findIndex((tier) => tier.permission === permission)
  if (tierIndex !== -1) {
    const allowedTypes = TIER_GRANTS.slice(0, tierIndex + 1).flatMap((tier) => tier.types)
    if (allowedTypes.includes(classification.type)) {
      return {
        allowed: true,
        reason: `${classification.type} operation allowed in ${permission} mode`,
        classification,
      }
    }
    const isUnknown = permission === 'query-only' && classification.type === 'UNKNOWN'
    return {
      allowed: false,
      reason: isUnknown
        ? t('errors.unknown_statement_query_only')
        : refusalReason(classification.type, permission),
      classification,
      // The unknown-statement sentence promises read-write+, so the header
      // above it has to say the same thing.
      requiredPermission: isUnknown ? 'read-write' : minimumPermissionFor(classification.type),
    }
  }

  // Fallback (unreachable if types are correct)
  return {
    allowed: false,
    reason: `Unknown permission level: ${permission}`,
    classification,
    requiredPermission: 'admin',
  }
}

/**
 * The classification of a statement this process assembled itself.
 *
 * Nothing has to be discovered: the caller chose the operation, so the type is
 * known, the statement is single, and confidence is not in question. Shared so
 * that the three callers who need such a classification — the two functions
 * below and the delete command's pre-connection check — cannot describe the
 * same statement differently.
 */
export function classificationForType(type: StatementType): StatementClassification {
  return {
    type,
    isDangerous: isDestructiveOperation(type),
    keywords: [type],
    isComposite: false,
    confidence: 'HIGH',
  }
}

/**
 * Whether this level permits this operation type, without throwing.
 *
 * For callers that need the verdict early — before opening a connection — while
 * still reporting it in their own words. They get the rule from here so it stays
 * single-sourced; only the message is theirs.
 */
export function permitsOperation(type: StatementType, permission: Permission): boolean {
  return checkPermissionForClassification(classificationForType(type), permission).allowed
}

/**
 * Throws PermissionError if an operation of this type is not allowed.
 *
 * For callers that assembled the statement themselves and therefore know its
 * type with certainty. Passing a synthetic statement string to enforcePermission
 * instead — which DataExecutor used to do — asks the classifier to rediscover
 * something the caller already knew, and passing the *real* generated statement
 * is worse still: it would force the SQL to be built, and its columns validated,
 * before the caller is known to be authorised at all.
 */
export function enforcePermissionForType(type: StatementType, permission: Permission): void {
  const classification = classificationForType(type)
  const result = checkPermissionForClassification(classification, permission)

  if (!result.allowed) {
    // The third argument is the level that *would* work, not the one that did
    // not. `PermissionError.requiredPermission` is printed as `required:` by
    // every command that catches it, so passing the caller's current level —
    // which this function used to do — produced a header telling a query-only
    // user that INSERT "required: query-only", directly above a message saying
    // it requires read-write. The Redis enforcer has always passed the level
    // that would work; this path now agrees with it.
    throw new PermissionError(result.reason, classification, minimumPermissionFor(type))
  }
}

/**
 * Throws PermissionError if statement not allowed, otherwise returns classification
 * Use in command handlers before execution
 */
export function enforcePermission(
  sql: string,
  permission: Permission,
  dialect?: SqlDialect
): StatementClassification {
  const result = checkPermission(sql, permission, dialect)

  if (!result.allowed) {
    throw new PermissionError(
      result.reason,
      result.classification,
      result.requiredPermission ?? 'admin'
    )
  }

  return result.classification
}

/** Permission ordering helper. Higher rank = more powerful tier. */
const PERMISSION_RANK: Record<Permission, number> = {
  'query-only': 1,
  'read-write': 2,
  'data-admin': 3,
  admin: 4,
}

export function permissionAtLeast(actual: Permission, required: Permission): boolean {
  return PERMISSION_RANK[actual] >= PERMISSION_RANK[required]
}
