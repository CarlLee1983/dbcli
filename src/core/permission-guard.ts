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
  return sql
    // Remove line comments (-- comment)
    .replace(/--[^\n]*\n/g, '\n')
    // Remove block comments (/* comment */)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    // Remove leading/trailing whitespace
    .trim()
    // Compress multiple spaces into one
    .replace(/\s+/g, ' ')
}

/**
 * Strip comments AND string literals using character-by-character state machine
 * More reliable than regex for handling escape sequences
 */
export function stripCommentsAndStrings(sql: string): string {
  let result = ''
  let i = 0

  while (i < sql.length) {
    const char = sql[i]

    // Line comment: -- until newline
    if (char === '-' && sql[i + 1] === '-') {
      while (i < sql.length && sql[i] !== '\n') {
        i++
      }
      if (i < sql.length) {
        result += '\n'
        i++
      }
      continue
    }

    // Block comment: /* ... */
    if (char === '/' && sql[i + 1] === '*') {
      i += 2
      while (i < sql.length) {
        if (sql[i] === '*' && sql[i + 1] === '/') {
          i += 2
          break
        }
        i++
      }
      result += ' ' // Replace comment with space to preserve structure
      continue
    }

    // String literal: 'string' or "string" with escape handling
    if (char === "'" || char === '"') {
      const quote = char
      i++
      while (i < sql.length && sql[i] !== quote) {
        // Handle escaped quotes (backslash escapes)
        if (sql[i] === '\\') {
          i++ // Skip escape character
        }
        i++
      }
      if (i < sql.length) {
        i++ // Skip closing quote
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
export function detectCompositePatterns(
  sql: string
): {
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
  return ['DELETE', 'DROP', 'ALTER', 'TRUNCATE', 'CREATE', 'GRANT'].includes(
    type
  )
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
  keyword: string,
  sql: string
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
  const mediumConfidenceTypes = [
    'CREATE',
    'ALTER',
    'DROP',
    'TRUNCATE',
  ]

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
 * Check if statement is allowed under given permission level
 */
export function checkPermission(
  sql: string,
  permission: Permission
): PermissionCheckResult {
  const classification = classifyStatement(sql)

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
    const allowedTypes = [
      'SELECT',
      'INSERT',
      'UPDATE',
      'DELETE',
      'SHOW',
      'DESCRIBE',
      'EXPLAIN',
    ]
    if (allowedTypes.includes(classification.type)) {
      return {
        allowed: true,
        reason: `${classification.type} operation allowed in data-admin mode`,
        classification,
      }
    }
    return {
      allowed: false,
      reason: `${classification.type} operation requires admin permission`,
      classification,
    }
  }

  // Read-Write allows SELECT, INSERT, UPDATE
  if (permission === 'read-write') {
    const allowedTypes = [
      'SELECT',
      'INSERT',
      'UPDATE',
      'SHOW',
      'DESCRIBE',
      'EXPLAIN',
    ]
    if (allowedTypes.includes(classification.type)) {
      return {
        allowed: true,
        reason: `${classification.type} operation allowed in read-write mode`,
        classification,
      }
    }
    return {
      allowed: false,
      reason: `${classification.type} operation requires data-admin or admin permission`,
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
    return {
      allowed: false,
      reason: `${classification.type} operation requires read-write or admin permission`,
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
 * Throws PermissionError if statement not allowed, otherwise returns classification
 * Use in command handlers before execution
 */
export function enforcePermission(
  sql: string,
  permission: Permission
): StatementClassification {
  const result = checkPermission(sql, permission)

  if (!result.allowed) {
    throw new PermissionError(result.reason, result.classification, permission)
  }

  return result.classification
}
