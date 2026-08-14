import type { StatementType } from '@/core/permission-guard'
import { IDENTIFIER_CONTINUATION, dollarQuoteDelimiterAt } from '@/utils/sql-lexical'

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
