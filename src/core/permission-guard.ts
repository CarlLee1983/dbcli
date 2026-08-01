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
        result +=
          ' ' +
          stripCommentsAndStrings(executableBody, options) +
          ' '
        i = closingIndex === -1 ? sql.length : closingIndex + 2
        continue
      }
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

    // PostgreSQL dollar-quoted string: $$...$$ or $tag$...$tag$.
    // The closing delimiter is case-sensitive and may contain SQL-looking
    // text or semicolons that must not participate in permission analysis.
    if (options.dialect === 'postgresql' && char === '$') {
      const delimiter = sql.slice(i).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/)?.[0]
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
        !/[A-Za-z0-9_$]/.test(sql[quoteIndex - 2] ?? '')
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
 * Check if statement is allowed under given permission level
 */
export function checkPermission(sql: string, permission: Permission): PermissionCheckResult {
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
      reason: `${classification.type} operation requires admin permission`,
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
    const isUnknown = classification.type === 'UNKNOWN'
    return {
      allowed: false,
      reason: isUnknown
        ? `Unrecognised SQL statement (current level: query-only). Security policy requires read-write+ for unknown statements. If this is a legitimate read-only statement, please open an issue at https://github.com/CarlLee1983/dbcli/issues.`
        : `${classification.type} operation requires read-write or admin permission`,
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
export function enforcePermission(sql: string, permission: Permission): StatementClassification {
  const result = checkPermission(sql, permission)

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
