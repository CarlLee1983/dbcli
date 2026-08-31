import { describe, test, expect } from 'bun:test'
import {
  classifyStatement,
  checkPermission,
  enforcePermission,
  PermissionError,
  permissionAtLeast,
} from '@/core/permission-guard'
import { classifyRedisCommand, enforceRedisPermission } from '@/core/permission/redis'
import {
  classifyElasticsearchRequest,
  enforceElasticsearchPermission,
} from '@/core/permission/elasticsearch'

// ============================================================================
// Suite 1: Basic Statement Classification
// ============================================================================

test('classifyStatement: basic SELECT', () => {
  const result = classifyStatement('SELECT * FROM users')
  expect(result.type).toBe('SELECT')
  expect(result.isDangerous).toBe(false)
  expect(result.isComposite).toBe(false)
  expect(result.confidence).toBe('HIGH')
})

test('classifyStatement: SELECT with WHERE', () => {
  const result = classifyStatement('SELECT id, name FROM users WHERE age > 18')
  expect(result.type).toBe('SELECT')
  expect(result.isDangerous).toBe(false)
})

test('classifyStatement: INSERT statement', () => {
  const result = classifyStatement('INSERT INTO users (name, email) VALUES ($1, $2)')
  expect(result.type).toBe('INSERT')
  expect(result.isDangerous).toBe(false)
  expect(result.confidence).toBe('HIGH')
})

test('classifyStatement: UPDATE statement', () => {
  const result = classifyStatement('UPDATE users SET active = true WHERE id = $1')
  expect(result.type).toBe('UPDATE')
  expect(result.isDangerous).toBe(false)
  expect(result.confidence).toBe('HIGH')
})

test('classifyStatement: DELETE statement', () => {
  const result = classifyStatement('DELETE FROM users WHERE created_at < NOW() - INTERVAL 1 YEAR')
  expect(result.type).toBe('DELETE')
  expect(result.isDangerous).toBe(true)
  expect(result.confidence).toBe('HIGH')
})

test('classifyStatement: DROP TABLE', () => {
  const result = classifyStatement('DROP TABLE users')
  expect(result.type).toBe('DROP')
  expect(result.isDangerous).toBe(true)
  expect(result.confidence).toBe('MEDIUM')
})

test('classifyStatement: ALTER TABLE', () => {
  const result = classifyStatement('ALTER TABLE users ADD COLUMN age INT')
  expect(result.type).toBe('ALTER')
  expect(result.isDangerous).toBe(true)
  expect(result.confidence).toBe('MEDIUM')
})

test('classifyStatement: CREATE TABLE', () => {
  const result = classifyStatement('CREATE TABLE users (id INT PRIMARY KEY, name VARCHAR(100))')
  expect(result.type).toBe('CREATE')
  expect(result.isDangerous).toBe(true)
  expect(result.confidence).toBe('MEDIUM')
})

test('classifyStatement: TRUNCATE TABLE', () => {
  const result = classifyStatement('TRUNCATE TABLE users')
  expect(result.type).toBe('TRUNCATE')
  expect(result.isDangerous).toBe(true)
})

test('classifyStatement: SHOW TABLES', () => {
  const result = classifyStatement('SHOW TABLES')
  expect(result.type).toBe('SHOW')
  expect(result.isDangerous).toBe(false)
  expect(result.confidence).toBe('HIGH')
})

test('classifyStatement: DESCRIBE table', () => {
  const result = classifyStatement('DESCRIBE users')
  expect(result.type).toBe('DESCRIBE')
  expect(result.isDangerous).toBe(false)
  expect(result.confidence).toBe('HIGH')
})

test('classifyStatement: EXPLAIN SELECT', () => {
  const result = classifyStatement('EXPLAIN SELECT * FROM users WHERE id = 1')
  expect(result.type).toBe('EXPLAIN')
  expect(result.isDangerous).toBe(false)
  expect(result.confidence).toBe('HIGH')
})

test('classifyStatement: MariaDB ANALYZE SELECT is treated as EXPLAIN', () => {
  const result = classifyStatement(
    "ANALYZE SELECT COUNT(*) FROM betting_logs WHERE settled_at >= '2026-03-01'"
  )
  expect(result.type).toBe('EXPLAIN')
  expect(result.isDangerous).toBe(false)
  expect(result.confidence).toBe('HIGH')
})

test('classifyStatement: PostgreSQL EXPLAIN (ANALYZE, BUFFERS) SELECT', () => {
  const result = classifyStatement('EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM users WHERE id = 1')
  expect(result.type).toBe('EXPLAIN')
  expect(result.isDangerous).toBe(false)
})

test('checkPermission: ANALYZE SELECT allowed in query-only', () => {
  const result = checkPermission('ANALYZE SELECT * FROM users', 'query-only')
  expect(result.allowed).toBe(true)
  expect(result.classification.type).toBe('EXPLAIN')
})

test('classifyStatement: empty string returns UNKNOWN', () => {
  const result = classifyStatement('')
  expect(result.type).toBe('UNKNOWN')
  expect(result.isDangerous).toBe(false)
})

test('classifyStatement: whitespace-only string returns UNKNOWN', () => {
  const result = classifyStatement('   \n\t  ')
  expect(result.type).toBe('UNKNOWN')
  expect(result.isDangerous).toBe(false)
})

test('classifyStatement: case-insensitive keywords', () => {
  const lower = classifyStatement('select * from users')
  const upper = classifyStatement('SELECT * FROM users')
  const mixed = classifyStatement('SeLeCt * FrOm users')

  expect(lower.type).toBe('SELECT')
  expect(upper.type).toBe('SELECT')
  expect(mixed.type).toBe('SELECT')
})

// ============================================================================
// Suite 2: Comment and String Handling
// ============================================================================

test('classifyStatement: SQL with line comment', () => {
  const sql = `-- DELETE FROM users
SELECT * FROM logs`
  const result = classifyStatement(sql)
  expect(result.type).toBe('SELECT')
  expect(result.isDangerous).toBe(false)
})

test('classifyStatement: SQL with block comment', () => {
  const sql = `/* DELETE FROM users */ SELECT * FROM logs`
  const result = classifyStatement(sql)
  expect(result.type).toBe('SELECT')
  expect(result.isDangerous).toBe(false)
})

test('classifyStatement: SELECT with DELETE in string literal', () => {
  const sql = `INSERT INTO logs (action) VALUES ('DELETE FROM users')`
  const result = classifyStatement(sql)
  expect(result.type).toBe('INSERT')
  expect(result.isDangerous).toBe(false)
})

test('classifyStatement: string with escaped quote', () => {
  const sql = `INSERT INTO messages (text) VALUES ('It''s a test')`
  const result = classifyStatement(sql)
  expect(result.type).toBe('INSERT')
})

test('classifyStatement: multiple strings in one statement', () => {
  const sql = `INSERT INTO posts (title, content) VALUES ('Hello', 'DELETE FROM users')`
  const result = classifyStatement(sql)
  expect(result.type).toBe('INSERT')
})

test('classifyStatement: block comment with inner delimiters', () => {
  // Standard SQL doesn't support nested block comments
  // /* ... */ is a single comment block, ends at first */
  const sql = `/* outer */ SELECT * FROM users`
  const result = classifyStatement(sql)
  expect(result.type).toBe('SELECT')
})

test('classifyStatement: mixed comments and strings', () => {
  const sql = `/* block */ SELECT -- line comment
'DELETE' as dangerous FROM users`
  const result = classifyStatement(sql)
  expect(result.type).toBe('SELECT')
})

test('classifyStatement: string with DELETE keyword in comment inside', () => {
  const sql = `INSERT INTO logs VALUES ('/* DELETE FROM users */')`
  const result = classifyStatement(sql)
  expect(result.type).toBe('INSERT')
})

test('classifyStatement: SQL with extra whitespace and comments', () => {
  const sql = `
    -- Initialize
    /* Main query */
    SELECT    *
    FROM      users
    WHERE     age > 18
  `
  const result = classifyStatement(sql)
  expect(result.type).toBe('SELECT')
})

test('classifyStatement: double-quoted string', () => {
  const sql = `INSERT INTO logs (action) VALUES ("DELETE FROM users")`
  const result = classifyStatement(sql)
  expect(result.type).toBe('INSERT')
})

// ============================================================================
// Suite 3: Composite Patterns (CTE, Subqueries, UNION)
// ============================================================================

test('classifyStatement: CTE with SELECT', () => {
  const sql = `WITH ranked_users AS (
    SELECT id, ROW_NUMBER() OVER (ORDER BY id) FROM users
  ) SELECT * FROM ranked_users`
  const result = classifyStatement(sql)
  expect(result.type).toBe('SELECT')
  expect(result.isComposite).toBe(true)
  expect(result.isDangerous).toBe(false)
})

test('classifyStatement: CTE with DELETE', () => {
  const sql = `WITH to_delete AS (
    SELECT id FROM users WHERE created < NOW() - INTERVAL 1 YEAR
  ) DELETE FROM users WHERE id IN (SELECT id FROM to_delete)`
  const result = classifyStatement(sql)
  expect(result.type).toBe('DELETE')
  expect(result.isComposite).toBe(true)
  expect(result.isDangerous).toBe(true)
})

test('classifyStatement: Subquery in SELECT', () => {
  const sql = `SELECT (SELECT COUNT(*) FROM orders) as order_count FROM users`
  const result = classifyStatement(sql)
  expect(result.type).toBe('SELECT')
  expect(result.isComposite).toBe(true)
})

test('classifyStatement: Subquery in DELETE', () => {
  const sql = `DELETE FROM users WHERE id IN (SELECT user_id FROM inactive_accounts)`
  const result = classifyStatement(sql)
  expect(result.type).toBe('DELETE')
  expect(result.isComposite).toBe(true)
  expect(result.isDangerous).toBe(true)
})

test('classifyStatement: UNION of SELECT statements', () => {
  const sql = `SELECT id, name FROM users UNION SELECT id, name FROM archived_users`
  const result = classifyStatement(sql)
  expect(result.type).toBe('SELECT')
  expect(result.isDangerous).toBe(false)
})

test('classifyStatement: nested subqueries', () => {
  const sql = `SELECT * FROM (SELECT * FROM (SELECT * FROM users WHERE active = true) WHERE age > 18) WHERE created_at > NOW()`
  const result = classifyStatement(sql)
  expect(result.type).toBe('SELECT')
  expect(result.isComposite).toBe(true)
})

test('classifyStatement: CTE + UNION', () => {
  const sql = `WITH users_recent AS (SELECT * FROM users WHERE created_at > NOW() - INTERVAL 7 DAY)
SELECT * FROM users_recent UNION SELECT * FROM archived_users`
  const result = classifyStatement(sql)
  expect(result.type).toBe('SELECT')
  expect(result.isComposite).toBe(true)
})

test('classifyStatement: CTE + subquery + main query', () => {
  const sql = `WITH recent AS (SELECT * FROM users WHERE created_at > NOW() - INTERVAL 1 DAY)
  SELECT * FROM (SELECT * FROM recent WHERE active = true) WHERE age > 18`
  const result = classifyStatement(sql)
  expect(result.type).toBe('SELECT')
  expect(result.isComposite).toBe(true)
})

// ============================================================================
// Suite 4: Parameterized Query Handling
// ============================================================================

test('classifyStatement: PostgreSQL style parameterized query', () => {
  const sql = `SELECT * FROM users WHERE id = $1`
  const result = classifyStatement(sql)
  expect(result.type).toBe('SELECT')
})

test('classifyStatement: MySQL style parameterized query', () => {
  const sql = `SELECT * FROM users WHERE id = ? AND name = ?`
  const result = classifyStatement(sql)
  expect(result.type).toBe('SELECT')
})

test('classifyStatement: DELETE with parameterized query', () => {
  const sql = `DELETE FROM users WHERE id = $1 AND age > $2`
  const result = classifyStatement(sql)
  expect(result.type).toBe('DELETE')
  expect(result.isDangerous).toBe(true)
})

test('classifyStatement: INSERT with parameterized values', () => {
  const sql = `INSERT INTO logs (message) VALUES ($1)`
  const result = classifyStatement(sql)
  expect(result.type).toBe('INSERT')
})

test('classifyStatement: UPDATE with parameterized query', () => {
  const sql = `UPDATE users SET name = $1 WHERE id = $2`
  const result = classifyStatement(sql)
  expect(result.type).toBe('UPDATE')
})

// ============================================================================
// Suite 5: Permission Checks - Query-only Mode
// ============================================================================

test('checkPermission: SELECT allowed in query-only', () => {
  const result = checkPermission('SELECT * FROM users', 'query-only')
  expect(result.allowed).toBe(true)
  expect(result.reason).toContain('query-only')
})

test('checkPermission: SHOW allowed in query-only', () => {
  const result = checkPermission('SHOW TABLES', 'query-only')
  expect(result.allowed).toBe(true)
})

test('checkPermission: DESCRIBE allowed in query-only', () => {
  const result = checkPermission('DESCRIBE users', 'query-only')
  expect(result.allowed).toBe(true)
})

test('checkPermission: EXPLAIN allowed in query-only', () => {
  const result = checkPermission('EXPLAIN SELECT * FROM users', 'query-only')
  expect(result.allowed).toBe(true)
})

test('checkPermission: INSERT blocked in query-only', () => {
  const result = checkPermission('INSERT INTO users (name) VALUES ($1)', 'query-only')
  expect(result.allowed).toBe(false)
  expect(result.reason).toContain('INSERT')
})

test('checkPermission: UPDATE blocked in query-only', () => {
  const result = checkPermission('UPDATE users SET active = true', 'query-only')
  expect(result.allowed).toBe(false)
})

test('checkPermission: DELETE blocked in query-only', () => {
  const result = checkPermission('DELETE FROM users WHERE id = 1', 'query-only')
  expect(result.allowed).toBe(false)
})

test('checkPermission: DROP blocked in query-only', () => {
  const result = checkPermission('DROP TABLE users', 'query-only')
  expect(result.allowed).toBe(false)
})

test('checkPermission: UNKNOWN denial mentions current level and asks for issue report', () => {
  const result = checkPermission('FOO BAR BAZ', 'query-only')
  expect(result.allowed).toBe(false)
  expect(result.classification.type).toBe('UNKNOWN')
  expect(result.reason).toContain('current level: query-only')
  expect(result.reason.toLowerCase()).toContain('unknown')
  expect(result.reason).toContain('issue')
})

// ============================================================================
// Suite 6: Permission Checks - Read-Write Mode
// ============================================================================

test('checkPermission: SELECT allowed in read-write', () => {
  const result = checkPermission('SELECT * FROM users', 'read-write')
  expect(result.allowed).toBe(true)
})

test('checkPermission: INSERT allowed in read-write', () => {
  const result = checkPermission('INSERT INTO users (name) VALUES ($1)', 'read-write')
  expect(result.allowed).toBe(true)
})

test('checkPermission: UPDATE allowed in read-write', () => {
  const result = checkPermission('UPDATE users SET active = true', 'read-write')
  expect(result.allowed).toBe(true)
})

test('checkPermission: SHOW allowed in read-write', () => {
  const result = checkPermission('SHOW TABLES', 'read-write')
  expect(result.allowed).toBe(true)
})

test('checkPermission: DESCRIBE allowed in read-write', () => {
  const result = checkPermission('DESCRIBE users', 'read-write')
  expect(result.allowed).toBe(true)
})

test('checkPermission: EXPLAIN allowed in read-write', () => {
  const result = checkPermission('EXPLAIN SELECT * FROM users', 'read-write')
  expect(result.allowed).toBe(true)
})

test('checkPermission: DELETE blocked in read-write', () => {
  const result = checkPermission('DELETE FROM users WHERE id = 1', 'read-write')
  expect(result.allowed).toBe(false)
})

test('checkPermission: DROP blocked in read-write', () => {
  const result = checkPermission('DROP TABLE users', 'read-write')
  expect(result.allowed).toBe(false)
})

test('checkPermission: ALTER blocked in read-write', () => {
  const result = checkPermission('ALTER TABLE users ADD COLUMN age INT', 'read-write')
  expect(result.allowed).toBe(false)
})

test('checkPermission: CREATE blocked in read-write', () => {
  const result = checkPermission('CREATE TABLE users (id INT)', 'read-write')
  expect(result.allowed).toBe(false)
})

test('checkPermission: TRUNCATE blocked in read-write', () => {
  const result = checkPermission('TRUNCATE TABLE users', 'read-write')
  expect(result.allowed).toBe(false)
})

// ============================================================================
// Suite 6.5: Permission Checks - Data-Admin Mode
// ============================================================================

test('checkPermission: SELECT allowed in data-admin', () => {
  const result = checkPermission('SELECT * FROM users', 'data-admin')
  expect(result.allowed).toBe(true)
})

test('checkPermission: INSERT allowed in data-admin', () => {
  const result = checkPermission('INSERT INTO users (name) VALUES ($1)', 'data-admin')
  expect(result.allowed).toBe(true)
})

test('checkPermission: UPDATE allowed in data-admin', () => {
  const result = checkPermission('UPDATE users SET active = true', 'data-admin')
  expect(result.allowed).toBe(true)
})

test('checkPermission: DELETE allowed in data-admin', () => {
  const result = checkPermission('DELETE FROM users WHERE id = 1', 'data-admin')
  expect(result.allowed).toBe(true)
})

test('checkPermission: SHOW allowed in data-admin', () => {
  const result = checkPermission('SHOW TABLES', 'data-admin')
  expect(result.allowed).toBe(true)
})

test('checkPermission: DESCRIBE allowed in data-admin', () => {
  const result = checkPermission('DESCRIBE users', 'data-admin')
  expect(result.allowed).toBe(true)
})

test('checkPermission: EXPLAIN allowed in data-admin', () => {
  const result = checkPermission('EXPLAIN SELECT * FROM users', 'data-admin')
  expect(result.allowed).toBe(true)
})

test('checkPermission: DROP blocked in data-admin', () => {
  const result = checkPermission('DROP TABLE users', 'data-admin')
  expect(result.allowed).toBe(false)
})

test('checkPermission: ALTER blocked in data-admin', () => {
  const result = checkPermission('ALTER TABLE users ADD COLUMN age INT', 'data-admin')
  expect(result.allowed).toBe(false)
})

test('checkPermission: CREATE blocked in data-admin', () => {
  const result = checkPermission('CREATE TABLE users (id INT)', 'data-admin')
  expect(result.allowed).toBe(false)
})

test('checkPermission: TRUNCATE blocked in data-admin', () => {
  const result = checkPermission('TRUNCATE TABLE users', 'data-admin')
  expect(result.allowed).toBe(false)
})

// ============================================================================
// Suite 7: Permission Checks - Admin Mode
// ============================================================================

test('checkPermission: SELECT allowed in admin', () => {
  const result = checkPermission('SELECT * FROM users', 'admin')
  expect(result.allowed).toBe(true)
})

test('checkPermission: INSERT allowed in admin', () => {
  const result = checkPermission('INSERT INTO users (name) VALUES ($1)', 'admin')
  expect(result.allowed).toBe(true)
})

test('checkPermission: UPDATE allowed in admin', () => {
  const result = checkPermission('UPDATE users SET active = true', 'admin')
  expect(result.allowed).toBe(true)
})

test('checkPermission: DELETE allowed in admin', () => {
  const result = checkPermission('DELETE FROM users WHERE id = 1', 'admin')
  expect(result.allowed).toBe(true)
})

test('checkPermission: DROP allowed in admin', () => {
  const result = checkPermission('DROP TABLE users', 'admin')
  expect(result.allowed).toBe(true)
})

test('checkPermission: ALTER allowed in admin', () => {
  const result = checkPermission('ALTER TABLE users ADD COLUMN age INT', 'admin')
  expect(result.allowed).toBe(true)
})

test('checkPermission: CREATE allowed in admin', () => {
  const result = checkPermission('CREATE TABLE users (id INT)', 'admin')
  expect(result.allowed).toBe(true)
})

test('checkPermission: TRUNCATE allowed in admin', () => {
  const result = checkPermission('TRUNCATE TABLE users', 'admin')
  expect(result.allowed).toBe(true)
})

// ============================================================================
// Suite 8: Error Messages and Types
// ============================================================================

test('enforcePermission: throws PermissionError on denial', () => {
  expect(() => {
    enforcePermission('DELETE FROM users', 'query-only')
  }).toThrow(PermissionError)
})

test('enforcePermission: error contains classification details', () => {
  try {
    enforcePermission('DELETE FROM users', 'query-only')
  } catch (error) {
    if (error instanceof PermissionError) {
      expect(error.classification.type).toBe('DELETE')
      expect(error.classification.isDangerous).toBe(true)
      // The level that would work, not the one that did not. This asserted
      // 'query-only' — the caller's own level — which every command then
      // printed as `required:` above a message saying DELETE needs data-admin.
      expect(error.requiredPermission).toBe('data-admin')
    }
  }
})

test('enforcePermission: error message is user-friendly', () => {
  try {
    enforcePermission('DELETE FROM users', 'query-only')
  } catch (error) {
    if (error instanceof PermissionError) {
      expect(error.message).toContain('DELETE')
      expect(error.message).not.toContain('Internal')
    }
  }
})

test('enforcePermission: returns classification when allowed', () => {
  const result = enforcePermission('SELECT * FROM users', 'query-only')
  expect(result.type).toBe('SELECT')
  expect(result.isDangerous).toBe(false)
})

test('checkPermission: includes classification in result', () => {
  const result = checkPermission('DELETE FROM users', 'query-only')
  expect(result.classification).toBeDefined()
  expect(result.classification.type).toBe('DELETE')
})

test('checkPermission: error message includes operation type', () => {
  const result = checkPermission('INSERT INTO users VALUES ($1)', 'query-only')
  expect(result.reason).toContain('INSERT')
})

// ============================================================================
// Suite 9: Edge Cases
// ============================================================================

test('classifyStatement: very long SQL statement', () => {
  const longSql = `SELECT ${Array(100).fill('col').join(', ')} FROM users WHERE ${Array(50).fill('x > 1').join(' AND ')}`
  const result = classifyStatement(longSql)
  expect(result.type).toBe('SELECT')
})

test('classifyStatement: SQL with Unicode characters', () => {
  const sql = `INSERT INTO users (name) VALUES ('用户名')`
  const result = classifyStatement(sql)
  expect(result.type).toBe('INSERT')
})

test('classifyStatement: SQL with only comments', () => {
  const sql = `-- Just a comment
/* Another comment */`
  const result = classifyStatement(sql)
  expect(result.type).toBe('UNKNOWN')
})

test('classifyStatement: SQL with tabs and newlines', () => {
  const sql = `SELECT\t*\nFROM\tusers\nWHERE\tid = 1`
  const result = classifyStatement(sql)
  expect(result.type).toBe('SELECT')
})

test('classifyStatement: keywords array contains expected values', () => {
  const result = classifyStatement('SELECT id, name FROM users WHERE age > 18 ORDER BY created_at')
  expect(result.keywords).toContain('SELECT')
  expect(result.keywords).toContain('WHERE')
  expect(result.keywords).toContain('ORDER')
})

test('classifyStatement: keywords are deduplicated', () => {
  const result = classifyStatement('SELECT * FROM users WHERE id IN (SELECT id FROM orders)')
  const selectCount = result.keywords.filter((k) => k === 'SELECT').length
  expect(selectCount).toBe(1)
})

// ============================================================================
// Suite 10: Integration - Complex Real-World Scenarios
// ============================================================================

test('integration: Query-only blocks dangerous CTE', () => {
  const sql = `WITH to_delete AS (SELECT id FROM users WHERE id > 1000) DELETE FROM users WHERE id IN (SELECT id FROM to_delete)`

  const result = checkPermission(sql, 'query-only')
  expect(result.allowed).toBe(false)
  expect(result.classification.type).toBe('DELETE')
})

test('integration: Read-Write allows safe data modification', () => {
  const queries = [
    'SELECT * FROM users WHERE active = true',
    'INSERT INTO logs (action, timestamp) VALUES ($1, NOW())',
    'UPDATE users SET last_login = NOW() WHERE id = $1',
  ]

  for (const query of queries) {
    const result = checkPermission(query, 'read-write')
    expect(result.allowed).toBe(true)
  }
})

test('integration: Data-Admin allows full DML but blocks DDL', () => {
  const allowedQueries = [
    'SELECT * FROM users',
    'INSERT INTO users (name) VALUES ($1)',
    'UPDATE users SET active = true',
    'DELETE FROM users WHERE id = 1',
  ]

  for (const query of allowedQueries) {
    const result = checkPermission(query, 'data-admin')
    expect(result.allowed).toBe(true)
  }

  const blockedQueries = [
    'DROP TABLE users',
    'ALTER TABLE users ADD COLUMN age INT',
    'CREATE TABLE new_table (id INT)',
    'TRUNCATE TABLE users',
  ]

  for (const query of blockedQueries) {
    const result = checkPermission(query, 'data-admin')
    expect(result.allowed).toBe(false)
  }
})

test('integration: Admin allows everything', () => {
  const queries = [
    'SELECT * FROM users',
    'INSERT INTO users (name) VALUES ($1)',
    'UPDATE users SET active = true',
    'DELETE FROM users WHERE id = 1',
    'DROP TABLE users',
    'ALTER TABLE users ADD COLUMN age INT',
    'CREATE TABLE new_table (id INT)',
  ]

  for (const query of queries) {
    const result = checkPermission(query, 'admin')
    expect(result.allowed).toBe(true)
  }
})

test('integration: Error handling preserves classification', () => {
  try {
    enforcePermission('DROP TABLE users', 'read-write')
  } catch (error) {
    if (error instanceof PermissionError) {
      expect(error.classification.type).toBe('DROP')
      expect(error.classification.isDangerous).toBe(true)
      expect(error.classification.confidence).toBe('MEDIUM')
    }
  }
})

test('integration: Mixed comments, strings, and parameterized queries', () => {
  const sql = `
    -- Fetch user data
    INSERT INTO audit_log (action, details) VALUES (
      'DELETE FROM users',
      'User attempted: DELETE /* bypassed */ FROM users WHERE id = $1'
    )`

  const result = classifyStatement(sql)
  expect(result.type).toBe('INSERT')
  expect(result.isDangerous).toBe(false)
})

// ============================================================================
// Suite: Redis Command Classification & Enforcement
// ============================================================================

describe('classifyRedisCommand', () => {
  test('classifies GET as query-only/SELECT', () => {
    const c = classifyRedisCommand('GET foo')
    expect(c.command).toBe('GET')
    expect(c.requiredPermission).toBe('query-only')
    expect(c.type).toBe('SELECT')
    expect(c.isDangerous).toBe(false)
  })

  test('classifies SET as read-write/UPDATE', () => {
    const c = classifyRedisCommand('SET k v')
    expect(c.requiredPermission).toBe('read-write')
    expect(c.type).toBe('UPDATE')
  })

  test('classifies DEL as data-admin/DELETE and dangerous', () => {
    const c = classifyRedisCommand('DEL key1 key2')
    expect(c.requiredPermission).toBe('data-admin')
    expect(c.type).toBe('DELETE')
    expect(c.isDangerous).toBe(true)
  })

  test('classifies FLUSHDB as admin/DROP and dangerous', () => {
    const c = classifyRedisCommand('FLUSHDB')
    expect(c.requiredPermission).toBe('admin')
    expect(c.type).toBe('DROP')
    expect(c.isDangerous).toBe(true)
  })

  test('classifies KEYS as admin (forces SCAN for non-admins)', () => {
    const c = classifyRedisCommand('KEYS *')
    expect(c.requiredPermission).toBe('admin')
  })

  test('returns unknown for non-whitelisted commands', () => {
    const c = classifyRedisCommand('NOTACOMMAND foo')
    expect(c.requiredPermission).toBe('unknown')
    expect(c.type).toBe('UNKNOWN')
  })

  test('is case-insensitive', () => {
    expect(classifyRedisCommand('get foo').command).toBe('GET')
    expect(classifyRedisCommand('Set k v').requiredPermission).toBe('read-write')
  })
})

describe('permissionAtLeast', () => {
  test('admin satisfies any tier', () => {
    expect(permissionAtLeast('admin', 'query-only')).toBe(true)
    expect(permissionAtLeast('admin', 'read-write')).toBe(true)
    expect(permissionAtLeast('admin', 'data-admin')).toBe(true)
    expect(permissionAtLeast('admin', 'admin')).toBe(true)
  })

  test('query-only does not satisfy higher tiers', () => {
    expect(permissionAtLeast('query-only', 'read-write')).toBe(false)
    expect(permissionAtLeast('query-only', 'data-admin')).toBe(false)
    expect(permissionAtLeast('query-only', 'admin')).toBe(false)
  })

  test('read-write satisfies query-only and itself', () => {
    expect(permissionAtLeast('read-write', 'query-only')).toBe(true)
    expect(permissionAtLeast('read-write', 'read-write')).toBe(true)
    expect(permissionAtLeast('read-write', 'data-admin')).toBe(false)
  })
})

describe('enforceRedisPermission', () => {
  test('allows GET under query-only', () => {
    expect(() => enforceRedisPermission('GET foo', 'query-only')).not.toThrow()
  })

  test('rejects SET under query-only', () => {
    let caught: unknown
    try {
      enforceRedisPermission('SET k v', 'query-only')
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(PermissionError)
    expect((caught as PermissionError).requiredPermission).toBe('read-write')
  })

  test('rejects DEL under read-write (needs data-admin)', () => {
    let caught: unknown
    try {
      enforceRedisPermission('DEL key', 'read-write')
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(PermissionError)
    expect((caught as PermissionError).requiredPermission).toBe('data-admin')
  })

  test('rejects FLUSHDB under data-admin (needs admin)', () => {
    let caught: unknown
    try {
      enforceRedisPermission('FLUSHDB', 'data-admin')
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(PermissionError)
    expect((caught as PermissionError).requiredPermission).toBe('admin')
  })

  test('rejects unknown commands even under admin', () => {
    let caught: unknown
    try {
      enforceRedisPermission('SOMERANDOMCMD foo', 'admin')
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(PermissionError)
    expect((caught as PermissionError).message).toContain('not whitelisted')
  })
})

// ============================================================================
// Suite 5: Elasticsearch Permission Enforcement
// ============================================================================

describe('Elasticsearch Permission Guard', () => {
  test('classify: _search is SELECT', () => {
    const result = classifyElasticsearchRequest({
      method: 'POST',
      rawPath: '/users/_search',
      body: '{}',
    })
    expect(result.type).toBe('SELECT')
    expect(result.isDangerous).toBe(false)
  })

  test('classify: GET _doc is SELECT', () => {
    const result = classifyElasticsearchRequest({ method: 'GET', rawPath: '/users/_doc/1' })
    expect(result.type).toBe('SELECT')
  })

  test('classify: PUT _doc is INSERT', () => {
    const result = classifyElasticsearchRequest({
      method: 'PUT',
      rawPath: '/users/_doc/1',
      body: '{}',
    })
    expect(result.type).toBe('INSERT')
  })

  test('classify: POST _update is UPDATE', () => {
    const result = classifyElasticsearchRequest({
      method: 'POST',
      rawPath: '/users/_update/1',
      body: '{}',
    })
    expect(result.type).toBe('UPDATE')
  })

  test('classify: DELETE _doc is DELETE', () => {
    const result = classifyElasticsearchRequest({ method: 'DELETE', rawPath: '/users/_doc/1' })
    expect(result.type).toBe('DELETE')
    expect(result.isDangerous).toBe(true)
  })

  test('classify: _bulk with mixed operations is highest tier', () => {
    const bulkBody = [
      '{ "index": { "_index": "test", "_id": "1" } }',
      '{ "field": "value" }',
      '{ "delete": { "_index": "test", "_id": "2" } }',
      '',
    ].join('\n')
    const result = classifyElasticsearchRequest({
      method: 'POST',
      rawPath: '/_bulk',
      body: bulkBody,
    })
    expect(result.type).toBe('DELETE') // delete is higher than index
  })

  test('enforce: query-only blocks bulk delete', () => {
    const bulkBody = '{ "delete": { "_index": "test", "_id": "2" } }\n'
    expect(() =>
      enforceElasticsearchPermission(
        { method: 'POST', rawPath: '/_bulk', body: bulkBody },
        'query-only'
      )
    ).toThrow(PermissionError)
  })

  test('enforce: admin allows everything', () => {
    expect(() =>
      enforceElasticsearchPermission(
        { method: 'POST', rawPath: '/_all/_settings', body: '{}' },
        'admin'
      )
    ).not.toThrow()
  })
})

// ============================================================================
// Suite: Redis Hardening (success-path returns, danger commands, edges)
// ============================================================================

describe('classifyRedisCommand hardening', () => {
  test('high-risk admin commands map to admin/DROP and isDangerous=true', () => {
    for (const cmd of ['SHUTDOWN', 'CONFIG SET maxmemory 0', 'ACL WHOAMI', 'DEBUG SLEEP 5']) {
      const c = classifyRedisCommand(cmd)
      expect(c.requiredPermission).toBe('admin')
      expect(c.type).toBe('DROP')
      expect(c.isDangerous).toBe(true)
    }
  })

  test('data-admin commands include DEL/UNLINK/HDEL and are dangerous', () => {
    for (const cmd of ['DEL k', 'UNLINK k1 k2', 'HDEL h f']) {
      const c = classifyRedisCommand(cmd)
      expect(c.requiredPermission).toBe('data-admin')
      expect(c.isDangerous).toBe(true)
    }
  })

  test('unknown command yields requiredPermission=unknown and not dangerous', () => {
    const c = classifyRedisCommand('TOTALLYNOTACMD x y z')
    expect(c.requiredPermission).toBe('unknown')
    expect(c.type).toBe('UNKNOWN')
    expect(c.isDangerous).toBe(false)
  })

  test('handles leading/trailing whitespace and multiple spaces', () => {
    const c = classifyRedisCommand('   GET    foo   ')
    expect(c.command).toBe('GET')
    expect(c.requiredPermission).toBe('query-only')
  })

  test('empty and whitespace-only inputs classify as unknown', () => {
    expect(classifyRedisCommand('').requiredPermission).toBe('unknown')
    expect(classifyRedisCommand('   ').requiredPermission).toBe('unknown')
    expect(classifyRedisCommand('\t\n').requiredPermission).toBe('unknown')
  })
})

describe('permissionAtLeast full matrix', () => {
  test('data-admin satisfies query-only/read-write/data-admin but not admin', () => {
    expect(permissionAtLeast('data-admin', 'query-only')).toBe(true)
    expect(permissionAtLeast('data-admin', 'read-write')).toBe(true)
    expect(permissionAtLeast('data-admin', 'data-admin')).toBe(true)
    expect(permissionAtLeast('data-admin', 'admin')).toBe(false)
  })

  test('read-write does not satisfy data-admin or admin', () => {
    expect(permissionAtLeast('read-write', 'data-admin')).toBe(false)
    expect(permissionAtLeast('read-write', 'admin')).toBe(false)
  })
})

describe('enforceRedisPermission success paths', () => {
  test('returns classification when same-tier permission grants access', () => {
    const result = enforceRedisPermission('SET k v', 'read-write')
    expect(result.command).toBe('SET')
    expect(result.requiredPermission).toBe('read-write')
    expect(result.type).toBe('UPDATE')
  })

  test('admin can run KEYS / FLUSHDB / SHUTDOWN', () => {
    expect(() => enforceRedisPermission('KEYS *', 'admin')).not.toThrow()
    expect(() => enforceRedisPermission('FLUSHDB', 'admin')).not.toThrow()
    expect(() => enforceRedisPermission('SHUTDOWN', 'admin')).not.toThrow()
  })

  test('higher tier may run lower-tier commands', () => {
    expect(() => enforceRedisPermission('GET k', 'admin')).not.toThrow()
    expect(() => enforceRedisPermission('DEL k', 'admin')).not.toThrow()
    expect(() => enforceRedisPermission('SET k v', 'data-admin')).not.toThrow()
  })

  test('PermissionError on unknown carries admin as the required tier', () => {
    let caught: unknown
    try {
      enforceRedisPermission('NOPECMD', 'query-only')
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(PermissionError)
    expect((caught as PermissionError).requiredPermission).toBe('admin')
  })
})

// ============================================================================
// Suite: Elasticsearch Hardening (bulk variants, default-admin paths, tiers)
// ============================================================================

describe('Elasticsearch classify hardening', () => {
  test('_count, _mapping, _settings, _alias all classify as SELECT', () => {
    for (const rawPath of [
      '/users/_count',
      '/users/_mapping',
      '/users/_settings',
      '/users/_alias',
    ]) {
      const result = classifyElasticsearchRequest({ method: 'GET', rawPath })
      expect(result.type).toBe('SELECT')
      expect(result.isDangerous).toBe(false)
    }
  })

  test('PUT _create classifies as INSERT', () => {
    const result = classifyElasticsearchRequest({
      method: 'PUT',
      rawPath: '/users/_create/1',
      body: '{}',
    })
    expect(result.type).toBe('INSERT')
  })

  test('_bulk with only index/create operations classifies as INSERT', () => {
    const body = [
      '{ "index": { "_index": "test", "_id": "1" } }',
      '{ "field": "value" }',
      '{ "create": { "_index": "test", "_id": "2" } }',
      '{ "field": "value2" }',
      '',
    ].join('\n')
    const result = classifyElasticsearchRequest({
      method: 'POST',
      rawPath: '/_bulk',
      body,
    })
    expect(result.type).toBe('INSERT')
    expect(result.isComposite).toBe(true)
  })

  test('_bulk with index + update (no delete) classifies as UPDATE', () => {
    const body = [
      '{ "index": { "_index": "test", "_id": "1" } }',
      '{ "field": "value" }',
      '{ "update": { "_index": "test", "_id": "2" } }',
      '{ "doc": { "field": "v2" } }',
      '',
    ].join('\n')
    const result = classifyElasticsearchRequest({
      method: 'POST',
      rawPath: '/_bulk',
      body,
    })
    expect(result.type).toBe('UPDATE')
  })

  // This asserted the opposite until 4.0.0: an empty or unreadable bulk body
  // classified as a non-dangerous SELECT. Because the bulk branch is selected
  // by the path alone, that made it a general-purpose downgrade —
  // `DELETE /orders?filter_path=_bulk` was classified as a read and executed at
  // query-only. Nothing readable means nothing proven.
  test('_bulk with an empty or unreadable body is the destructive tier', () => {
    const empty = classifyElasticsearchRequest({ method: 'POST', rawPath: '/_bulk', body: '' })
    expect(empty.type).toBe('DROP')
    expect(empty.isDangerous).toBe(true)

    const garbage = classifyElasticsearchRequest({
      method: 'POST',
      rawPath: '/_bulk',
      body: 'not json\nnot json either\n',
    })
    expect(garbage.type).toBe('DROP')
  })

  test('_bulk delete short-circuits to DELETE even if other ops follow', () => {
    const body = [
      '{ "delete": { "_index": "test", "_id": "1" } }',
      '{ "index": { "_index": "test", "_id": "2" } }',
      '{ "field": "value" }',
      '',
    ].join('\n')
    const result = classifyElasticsearchRequest({
      method: 'POST',
      rawPath: '/_bulk',
      body,
    })
    expect(result.type).toBe('DELETE')
    expect(result.isDangerous).toBe(true)
  })

  test('unrecognised cluster/schema operation defaults to DROP/admin/dangerous', () => {
    const result = classifyElasticsearchRequest({
      method: 'POST',
      rawPath: '/_cluster/reroute',
      body: '{}',
    })
    expect(result.type).toBe('DROP')
    expect(result.isDangerous).toBe(true)
    expect(result.confidence).toBe('LOW')
  })
})

describe('enforceElasticsearchPermission tiers', () => {
  test('query-only allows _search and _count', () => {
    expect(() =>
      enforceElasticsearchPermission(
        { method: 'POST', rawPath: '/users/_search', body: '{}' },
        'query-only'
      )
    ).not.toThrow()
    expect(() =>
      enforceElasticsearchPermission({ method: 'GET', rawPath: '/users/_count' }, 'query-only')
    ).not.toThrow()
  })

  test('query-only blocks PUT _doc (INSERT)', () => {
    expect(() =>
      enforceElasticsearchPermission(
        { method: 'PUT', rawPath: '/users/_doc/1', body: '{}' },
        'query-only'
      )
    ).toThrow(PermissionError)
  })

  test('read-write allows INSERT/UPDATE but blocks DELETE', () => {
    expect(() =>
      enforceElasticsearchPermission(
        { method: 'PUT', rawPath: '/users/_doc/1', body: '{}' },
        'read-write'
      )
    ).not.toThrow()
    expect(() =>
      enforceElasticsearchPermission(
        { method: 'POST', rawPath: '/users/_update/1', body: '{}' },
        'read-write'
      )
    ).not.toThrow()
    expect(() =>
      enforceElasticsearchPermission({ method: 'DELETE', rawPath: '/users/_doc/1' }, 'read-write')
    ).toThrow(PermissionError)
  })

  test('data-admin allows DELETE but blocks cluster ops (DROP)', () => {
    expect(() =>
      enforceElasticsearchPermission({ method: 'DELETE', rawPath: '/users/_doc/1' }, 'data-admin')
    ).not.toThrow()
    expect(() =>
      enforceElasticsearchPermission(
        { method: 'POST', rawPath: '/_cluster/reroute', body: '{}' },
        'data-admin'
      )
    ).toThrow(PermissionError)
  })

  test('returns classification on success', () => {
    const result = enforceElasticsearchPermission(
      { method: 'POST', rawPath: '/users/_search', body: '{}' },
      'query-only'
    )
    expect(result.type).toBe('SELECT')
    expect(result.isDangerous).toBe(false)
  })

  test('PermissionError carries DELETE classification on a blocked DELETE', () => {
    let caught: unknown
    try {
      enforceElasticsearchPermission({ method: 'DELETE', rawPath: '/users/_doc/1' }, 'read-write')
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(PermissionError)
    expect((caught as PermissionError).classification.type).toBe('DELETE')
  })
})
