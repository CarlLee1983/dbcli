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
import { t_vars } from '@/i18n/message-loader'
import { IDENTIFIER_CONTINUATION, dollarQuoteDelimiterAt } from '@/utils/sql-lexical'

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
// HELPER FUNCTIONS - SQL Analysis
// ============================================================================

/**
 * Normalize SQL by removing comments and compressing whitespace
 * Uses regex-based approach for speed and simplicity
 */
export function normalizeSQL(sql: string): string {
  return (
    sql
      // Remove line comments (-- comment)
      .replace(/--[^\n]*\n/g, '\n')
      // Remove block comments (/* comment */)
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      // Remove leading/trailing whitespace
      .trim()
      // Compress multiple spaces into one
      .replace(/\s+/g, ' ')
  )
}

/**
 * Strip comments AND string literals using character-by-character state machine
 * More reliable than regex for handling escape sequences
 */
export function stripCommentsAndStrings(
  sql: string,
  options: { dialect?: 'postgresql' | 'mysql' | 'mariadb' } = {}
): string {
  let result = ''
  let i = 0

  while (i < sql.length) {
    const char = sql[i]

    // Line comment: -- until newline. MySQL/MariaDB require whitespace or a
    // control character after the second dash; without it, the text remains
    // executable and must stay visible to permission analysis.
    const mysqlDialect = options.dialect === 'mysql' || options.dialect === 'mariadb'
    const dashFollowerCode = sql.charCodeAt(i + 2)
    const dashStartsComment =
      char === '-' &&
      sql[i + 1] === '-' &&
      (!mysqlDialect ||
        sql[i + 2] === undefined ||
        dashFollowerCode <= 0x20 ||
        dashFollowerCode === 0x7f)
    if (dashStartsComment) {
      while (i < sql.length && sql[i] !== '\n') {
        i++
      }
      if (i < sql.length) {
        result += '\n'
        i++
      }
      continue
    }

    // MySQL/MariaDB also use # for line comments.
    if (mysqlDialect && char === '#') {
      while (i < sql.length && sql[i] !== '\n') i++
      if (i < sql.length) {
        result += '\n'
        i++
      }
      continue
    }

    // Block comment: /* ... */
    if (char === '/' && sql[i + 1] === '*') {
      const executableMysqlComment =
        mysqlDialect && (sql.startsWith('/*!', i) || sql.startsWith('/*M!', i))
      if (executableMysqlComment) {
        const prefixLength = sql.startsWith('/*M!', i) ? 4 : 3
        const closingIndex = sql.indexOf('*/', i + prefixLength)
        const bodyEnd = closingIndex === -1 ? sql.length : closingIndex
        const executableBody = sql
          .slice(i + prefixLength, bodyEnd)
          // MySQL/MariaDB consume an immediately adjacent leading version
          // number as comment metadata, even when the payload has no space.
          .replace(/^\d+/, ' ')
        result += ' ' + stripCommentsAndStrings(executableBody, options) + ' '
        i = closingIndex === -1 ? sql.length : closingIndex + 2
        continue
      }
      // PostgreSQL block comments nest: `/* a /* b */ still comment */`.
      // Stopping at the first `*/` would leave the tail of the comment visible
      // and its semicolons counted as separators.
      const nests = options.dialect === 'postgresql'
      let depth = 1
      i += 2
      while (i < sql.length && depth > 0) {
        if (nests && sql[i] === '/' && sql[i + 1] === '*') {
          depth++
          i += 2
          continue
        }
        if (sql[i] === '*' && sql[i + 1] === '/') {
          depth--
          i += 2
          continue
        }
        i++
      }
      result += ' ' // Replace comment with space to preserve structure
      continue
    }

    // PostgreSQL dollar-quoted string: $$...$$ or $tag$...$tag$.
    // The closing delimiter is case-sensitive and may contain SQL-looking
    // text or semicolons that must not participate in permission analysis.
    if (options.dialect === 'postgresql' && char === '$') {
      // A dollar-quote only opens at a token boundary. PostgreSQL identifiers
      // may contain `$` from the second character on, so in `SELECT 1 AS a$q$`
      // the `$q$` belongs to the identifier `a$q$` and quotes nothing — reading
      // it as a quote would hide everything up to the next `$q$` from analysis
      // while the server still executes it.
      // The tag itself follows identifier rules too, so `$é$` is a real quote;
      // an ASCII-only tag pattern left its body visible and let a `'` inside it
      // desynchronise the scan.
      const delimiter = dollarQuoteDelimiterAt(sql, i)
      if (delimiter) {
        i += delimiter.length
        const closingIndex = sql.indexOf(delimiter, i)
        i = closingIndex === -1 ? sql.length : closingIndex + delimiter.length
        result += ' '
        continue
      }
    }

    // MySQL/MariaDB backtick-quoted identifier. Doubled backticks escape a
    // literal backtick; SQL-looking text inside remains non-executable.
    if (mysqlDialect && char === '`') {
      i++
      while (i < sql.length) {
        if (sql[i] === '`') {
          if (sql[i + 1] === '`') {
            i += 2
            continue
          }
          i++
          break
        }
        i++
      }
      result += ' '
      continue
    }

    // String literal or quoted identifier. Doubled quotes are unambiguous in
    // every supported dialect. Backslash-quote is mode-dependent, so fan-out
    // treats it as an escape only for PostgreSQL's explicit E'...' syntax;
    // callers without a dialect retain the historical generic behavior.
    if (char === "'" || char === '"') {
      const quote = char
      const quoteIndex = i
      const postgresEscapeString =
        options.dialect === 'postgresql' &&
        quote === "'" &&
        /[eE]/.test(sql[quoteIndex - 1] ?? '') &&
        !IDENTIFIER_CONTINUATION.test(sql[quoteIndex - 2] ?? '')
      const backslashEscapes = options.dialect === undefined || postgresEscapeString
      i++
      while (i < sql.length) {
        if (sql[i] === quote) {
          if (sql[i + 1] === quote) {
            i += 2
            continue
          }
          i++
          break
        }
        if (backslashEscapes && sql[i] === '\\') {
          i += 2
          continue
        }
        i++
      }
      result += ' ' // Replace string with space to preserve structure
      continue
    }

    result += char
    i++
  }

  return result
}

/**
 * Detect composite patterns: WITH clause, subqueries, UNION
 */
export function detectCompositePatterns(sql: string): {
  hasWithClause: boolean
  hasSubquery: boolean
  hasUnion: boolean
} {
  const upper = sql.toUpperCase()

  return {
    hasWithClause: /\bWITH\b/.test(upper),
    hasSubquery: /\(\s*SELECT\b/i.test(upper),
    hasUnion: /\bUNION\b/.test(upper),
  }
}

/**
 * Extract first SQL keyword from statement
 * Skips empty tokens and parameter markers
 * For WITH clauses, finds the outer operation keyword
 */
export function extractFirstKeyword(sql: string): string {
  const cleaned = removeParameterMarkers(sql)
  const tokens = cleaned.split(/\s+/).filter((token) => token.length > 0)

  let firstKeyword = 'UNKNOWN'

  for (const token of tokens) {
    // Skip parameter markers (shouldn't be present after removeParameterMarkers, but safe check)
    if (token.startsWith('$') || token === '?') {
      continue
    }
    firstKeyword = token.toUpperCase()
    break
  }

  // If first keyword is WITH (CTE), find the outer operation keyword
  if (firstKeyword === 'WITH') {
    // Look for the main operation keyword after the closing parenthesis of the CTE
    const upper = cleaned.toUpperCase()
    // Find pattern: ") KEYWORD" where KEYWORD is the outer operation
    const outerMatch = upper.match(/\)\s+(SELECT|INSERT|UPDATE|DELETE|WITH)/i)
    if (outerMatch && outerMatch[1]) {
      return outerMatch[1].toUpperCase()
    }
  }

  return firstKeyword
}

/**
 * Map SQL keyword to statement type
 */
export function mapKeywordToType(keyword: string): StatementType {
  const upper = keyword.toUpperCase()

  // Read operations
  if (upper === 'SELECT') return 'SELECT'
  if (upper === 'SHOW') return 'SHOW'
  if (upper === 'DESCRIBE') return 'DESCRIBE'
  if (upper === 'EXPLAIN') return 'EXPLAIN'

  // Write operations
  if (upper === 'INSERT') return 'INSERT'
  if (upper === 'UPDATE') return 'UPDATE'

  // Destructive operations
  if (upper === 'DELETE') return 'DELETE'
  if (upper === 'DROP') return 'DROP'
  if (upper === 'ALTER') return 'ALTER'
  if (upper === 'TRUNCATE') return 'TRUNCATE'
  if (upper === 'CREATE') return 'CREATE'
  if (upper === 'GRANT') return 'DROP' // Treat as destructive (permission change)

  // Composite patterns - these are not statements themselves
  if (upper === 'WITH') return 'UNKNOWN' // CTE needs outer keyword determination

  return 'UNKNOWN'
}

/**
 * Determine if a statement type is destructive
 */
export function isDestructiveOperation(type: StatementType): boolean {
  return ['DELETE', 'DROP', 'ALTER', 'TRUNCATE', 'CREATE', 'GRANT'].includes(type)
}

/**
 * Extract all SQL keywords from statement (deduplicated, sorted)
 */
export function extractAllKeywords(sql: string): string[] {
  const upper = sql.toUpperCase()
  // Match SQL keywords - word boundaries, at least 2 chars
  const keywords = new Set<string>()

  // Common SQL keywords to check for
  const commonKeywords = [
    'SELECT',
    'INSERT',
    'UPDATE',
    'DELETE',
    'DROP',
    'ALTER',
    'CREATE',
    'TRUNCATE',
    'WITH',
    'UNION',
    'WHERE',
    'FROM',
    'JOIN',
    'INNER',
    'LEFT',
    'RIGHT',
    'FULL',
    'CROSS',
    'GROUP',
    'ORDER',
    'HAVING',
    'LIMIT',
    'OFFSET',
    'DISTINCT',
    'CASE',
    'WHEN',
    'THEN',
    'ELSE',
    'END',
  ]

  for (const keyword of commonKeywords) {
    if (new RegExp(`\\b${keyword}\\b`, 'i').test(upper)) {
      keywords.add(keyword.toUpperCase())
    }
  }

  return Array.from(keywords).sort()
}

/**
 * Determine confidence level of classification
 */
export function determineConfidence(
  type: StatementType,
  _keyword: string,
  _sql: string
): 'HIGH' | 'MEDIUM' | 'LOW' {
  // Standard SQL operations - high confidence
  const highConfidenceTypes = [
    'SELECT',
    'INSERT',
    'UPDATE',
    'DELETE',
    'WITH',
    'UNION',
    'SHOW',
    'DESCRIBE',
    'EXPLAIN',
  ]

  if (highConfidenceTypes.includes(type)) {
    return 'HIGH'
  }

  // Schema operations - medium confidence
  const mediumConfidenceTypes = ['CREATE', 'ALTER', 'DROP', 'TRUNCATE']

  if (mediumConfidenceTypes.includes(type)) {
    return 'MEDIUM'
  }

  // Unknown or uncommon operations - low confidence
  return 'LOW'
}

/**
 * Remove parameter markers ($1, $2, ?, etc.) from SQL
 * These are used in parameterized queries for SQL injection prevention
 */
export function removeParameterMarkers(sql: string): string {
  return sql
    .replace(/\$\d+/g, '') // PostgreSQL: $1, $2, ...
    .replace(/\?/g, '') // MySQL: ?
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
      reason:
        'SQL containing multiple statements is refused below admin permission, because only ' +
        'the first statement determines the permission check. Run each statement separately.',
      classification,
    }
  }

  return checkPermissionForClassification(classification, permission)
}

/** Types each tier adds to the one below it. */
const TIER_GRANTS: ReadonlyArray<{ permission: Permission; types: readonly string[] }> = [
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
      reason:
        `This statement opens as a read but contains an executable ` +
        `${classification.escalatedFrom}. A write hidden inside a read statement ` +
        `requires admin permission (current level: ${permission}).`,
      classification,
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

  // Data-Admin allows SELECT, INSERT, UPDATE, DELETE (full DML, no DDL)
  if (permission === 'data-admin') {
    const allowedTypes = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'SHOW', 'DESCRIBE', 'EXPLAIN']
    if (allowedTypes.includes(classification.type)) {
      return {
        allowed: true,
        reason: `${classification.type} operation allowed in data-admin mode`,
        classification,
      }
    }
    return {
      allowed: false,
      reason: refusalReason(classification.type, permission),
      classification,
    }
  }

  // Read-Write allows SELECT, INSERT, UPDATE
  if (permission === 'read-write') {
    const allowedTypes = ['SELECT', 'INSERT', 'UPDATE', 'SHOW', 'DESCRIBE', 'EXPLAIN']
    if (allowedTypes.includes(classification.type)) {
      return {
        allowed: true,
        reason: `${classification.type} operation allowed in read-write mode`,
        classification,
      }
    }
    return {
      allowed: false,
      reason: refusalReason(classification.type, permission),
      classification,
    }
  }

  // Query-only allows SELECT, SHOW, DESCRIBE, EXPLAIN
  if (permission === 'query-only') {
    const allowedTypes = ['SELECT', 'SHOW', 'DESCRIBE', 'EXPLAIN']
    if (allowedTypes.includes(classification.type)) {
      return {
        allowed: true,
        reason: `${classification.type} operation allowed in query-only mode`,
        classification,
      }
    }
    const isUnknown = classification.type === 'UNKNOWN'
    return {
      allowed: false,
      reason: isUnknown
        ? `Unrecognised SQL statement (current level: query-only). Security policy requires read-write+ for unknown statements. If this is a legitimate read-only statement, please open an issue at https://github.com/CarlLee1983/dbcli/issues.`
        : refusalReason(classification.type, permission),
      classification,
    }
  }

  // Fallback (unreachable if types are correct)
  return {
    allowed: false,
    reason: `Unknown permission level: ${permission}`,
    classification,
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
    throw new PermissionError(result.reason, result.classification, permission)
  }

  return result.classification
}

// ============================================================================
// REDIS CLASSIFICATION
// ============================================================================

/**
 * Mapping from Redis command (uppercased) to the lowest permission tier
 * that may run it. Anything not in this map is denied by default.
 */
const REDIS_COMMAND_PERMISSION: Record<string, Permission> = {
  GET: 'query-only',
  MGET: 'query-only',
  STRLEN: 'query-only',
  EXISTS: 'query-only',
  TTL: 'query-only',
  PTTL: 'query-only',
  TYPE: 'query-only',
  SCAN: 'query-only',
  HGET: 'query-only',
  HGETALL: 'query-only',
  HKEYS: 'query-only',
  HVALS: 'query-only',
  HLEN: 'query-only',
  HEXISTS: 'query-only',
  HMGET: 'query-only',
  LRANGE: 'query-only',
  LLEN: 'query-only',
  LINDEX: 'query-only',
  SMEMBERS: 'query-only',
  SCARD: 'query-only',
  SISMEMBER: 'query-only',
  ZRANGE: 'query-only',
  ZREVRANGE: 'query-only',
  ZRANGEBYSCORE: 'query-only',
  ZCARD: 'query-only',
  ZSCORE: 'query-only',
  PING: 'query-only',
  ECHO: 'query-only',
  SET: 'read-write',
  SETEX: 'read-write',
  SETNX: 'read-write',
  PSETEX: 'read-write',
  MSET: 'read-write',
  MSETNX: 'read-write',
  APPEND: 'read-write',
  INCR: 'read-write',
  INCRBY: 'read-write',
  DECR: 'read-write',
  DECRBY: 'read-write',
  HSET: 'read-write',
  HSETNX: 'read-write',
  HMSET: 'read-write',
  HINCRBY: 'read-write',
  LPUSH: 'read-write',
  RPUSH: 'read-write',
  LPOP: 'read-write',
  RPOP: 'read-write',
  LSET: 'read-write',
  LREM: 'read-write',
  SADD: 'read-write',
  SREM: 'read-write',
  ZADD: 'read-write',
  ZREM: 'read-write',
  XADD: 'read-write',
  XDEL: 'data-admin',
  XLEN: 'query-only',
  XREAD: 'query-only',
  XRANGE: 'query-only',
  XREVRANGE: 'query-only',
  EXPIRE: 'read-write',
  EXPIREAT: 'read-write',
  PEXPIRE: 'read-write',
  PERSIST: 'read-write',
  RENAME: 'read-write',
  DEL: 'data-admin',
  UNLINK: 'data-admin',
  HDEL: 'data-admin',
  FLUSHDB: 'admin',
  FLUSHALL: 'admin',
  CONFIG: 'admin',
  INFO: 'admin',
  CLIENT: 'admin',
  DEBUG: 'admin',
  SHUTDOWN: 'admin',
  KEYS: 'admin',
  MONITOR: 'admin',
  SAVE: 'admin',
  BGSAVE: 'admin',
  BGREWRITEAOF: 'admin',
  REPLICAOF: 'admin',
  SLAVEOF: 'admin',
  ACL: 'admin',
}

/** Statement-style classification for a Redis command. */
export interface RedisCommandClassification {
  command: string
  requiredPermission: Permission | 'unknown'
  type: StatementType
  isDangerous: boolean
}

/**
 * Classify a Redis command into the minimum permission tier required.
 * Returns 'unknown' when the command is not whitelisted.
 */
export function classifyRedisCommand(command: string): RedisCommandClassification {
  const head = command.trim().split(/\s+/)[0]?.toUpperCase() ?? ''
  const required = REDIS_COMMAND_PERMISSION[head]

  let type: StatementType
  if (!required) type = 'UNKNOWN'
  else if (required === 'query-only') type = 'SELECT'
  else if (required === 'read-write') type = 'UPDATE'
  else if (required === 'data-admin') type = 'DELETE'
  else type = 'DROP'

  return {
    command: head,
    requiredPermission: required ?? 'unknown',
    type,
    isDangerous: required === 'admin' || required === 'data-admin',
  }
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

/**
 * Throw PermissionError if the Redis command is not allowed under the
 * given permission tier. Returns the classification on success.
 */
export function enforceRedisPermission(
  command: string,
  permission: Permission
): RedisCommandClassification {
  const classification = classifyRedisCommand(command)
  const required = classification.requiredPermission

  const stmt: StatementClassification = {
    type: classification.type,
    isDangerous: classification.isDangerous,
    keywords: [classification.command],
    isComposite: false,
    confidence: required === 'unknown' ? 'LOW' : 'HIGH',
  }

  if (required === 'unknown') {
    throw new PermissionError(
      `Redis command "${classification.command}" is not whitelisted; refusing to execute`,
      stmt,
      'admin'
    )
  }

  if (!permissionAtLeast(permission, required)) {
    throw new PermissionError(
      `Redis command "${classification.command}" requires ${required} permission`,
      stmt,
      required
    )
  }

  return classification
}

// ============================================================================
// ELASTICSEARCH CLASSIFICATION
// ============================================================================

export interface ElasticsearchRequest {
  method: string
  apiPath: string
  body?: string
}

/**
 * Classify an Elasticsearch REST request into a SQL-like statement type and risk.
 */
export function classifyElasticsearchRequest(
  request: ElasticsearchRequest
): StatementClassification {
  const method = request.method.toUpperCase()
  const path = request.apiPath.toLowerCase()

  // 1. Special case: _bulk NDJSON parsing
  if (path.includes('_bulk')) {
    return classifyElasticsearchBulk(request.body ?? '')
  }

  // 2. Read operations
  if (
    path.includes('_search') ||
    path.includes('_count') ||
    path.includes('_mapping') ||
    path.includes('_settings') ||
    path.includes('_alias') ||
    (method === 'GET' && (path.includes('_doc') || path.includes('_source')))
  ) {
    return {
      type: 'SELECT',
      isDangerous: false,
      keywords: [method, path],
      isComposite: false,
      confidence: 'HIGH',
    }
  }

  // 3. Write operations
  if (path.includes('_update') || (method === 'POST' && path.includes('_doc'))) {
    return {
      type: 'UPDATE',
      isDangerous: false,
      keywords: [method, path],
      isComposite: false,
      confidence: 'HIGH',
    }
  }

  if (method === 'PUT' && (path.includes('_doc') || path.includes('_create'))) {
    return {
      type: 'INSERT',
      isDangerous: false,
      keywords: [method, path],
      isComposite: false,
      confidence: 'HIGH',
    }
  }

  // 4. Destructive operations
  if (method === 'DELETE') {
    return {
      type: 'DELETE',
      isDangerous: true,
      keywords: [method, path],
      isComposite: false,
      confidence: 'HIGH',
    }
  }

  // 5. Schema/Cluster operations (default to admin)
  return {
    type: 'DROP',
    isDangerous: true,
    keywords: [method, path],
    isComposite: false,
    confidence: 'LOW',
  }
}

/**
 * Parse Elasticsearch _bulk body (NDJSON) and find the highest required permission.
 */
function classifyElasticsearchBulk(body: string): StatementClassification {
  const lines = body.split('\n').filter((l) => l.trim().length > 0)
  let highestType: StatementType = 'SELECT'
  let isDangerous = false

  for (const line of lines) {
    try {
      const action = JSON.parse(line)
      const op = Object.keys(action)[0]

      if (op === 'delete') {
        highestType = 'DELETE'
        isDangerous = true
        break // DELETE is highest for DML
      }
      if (op === 'update' && highestType !== 'DELETE') {
        highestType = 'UPDATE'
      }
      if ((op === 'index' || op === 'create') && !['DELETE', 'UPDATE'].includes(highestType)) {
        highestType = 'INSERT'
      }
    } catch {
      // Ignore invalid JSON lines in bulk (usually data lines)
    }
  }

  return {
    type: highestType,
    isDangerous,
    keywords: ['BULK'],
    isComposite: true,
    confidence: 'HIGH',
  }
}

/**
 * Throw PermissionError if the Elasticsearch request is not allowed under the
 * given permission tier.
 */
export function enforceElasticsearchPermission(
  request: ElasticsearchRequest,
  permission: Permission
): StatementClassification {
  const classification = classifyElasticsearchRequest(request)

  const result = checkElasticsearchPermission(classification, permission)

  if (!result.allowed) {
    throw new PermissionError(result.reason, classification, permission)
  }

  return classification
}

function checkElasticsearchPermission(
  classification: StatementClassification,
  permission: Permission
): { allowed: boolean; reason: string } {
  // Admin allows everything
  if (permission === 'admin') return { allowed: true, reason: 'Admin' }

  // Map ES types to the same rules as SQL
  if (permission === 'data-admin') {
    const allowed = ['SELECT', 'INSERT', 'UPDATE', 'DELETE']
    if (allowed.includes(classification.type)) return { allowed: true, reason: 'Data-Admin' }
  }

  if (permission === 'read-write') {
    const allowed = ['SELECT', 'INSERT', 'UPDATE']
    if (allowed.includes(classification.type)) return { allowed: true, reason: 'Read-Write' }
  }

  if (permission === 'query-only') {
    if (classification.type === 'SELECT') return { allowed: true, reason: 'Query-Only' }
  }

  return {
    allowed: false,
    reason: `Elasticsearch ${classification.type} operation requires higher permission tier`,
  }
}
