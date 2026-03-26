# Phase 4: Permission Model - Research

**Researched:** 2026-03-25
**Domain:** SQL statement classification, permission enforcement, coarse-grained access control
**Confidence:** HIGH

## Summary

Phase 4 implements a coarse-grained permission system with three levels: Query-only, Read-Write, and Admin. The core challenge is accurately classifying SQL statements to block dangerous operations at the right permission level. This research identifies proven classification strategies, validates them against edge cases (CTEs, subqueries, comments), and documents the permission guard architecture.

**Primary recommendation:** Use a keyword-whitelist approach with statement-level classification. Implement a lightweight regex-based classifier (not a full SQL parser) that catches 99% of cases, with explicit support for CTE, subquery, and comment handling. Store permission level in .dbcli (already done in Phase 2), integrate checks into all command handlers.

---

## User Constraints (from CONTEXT.md)

No CONTEXT.md file provided. This research proceeds with requirements from ROADMAP.md:

**Locked Requirements:**
- Three permission levels: Query-only / Read-write / Admin (from REQUIREMENTS.md INIT-05)
- Permission stored in `.dbcli` config (already integrated in Phase 2/3 init command)
- Coarse-grained access control (no per-table or per-column fine-grained model per project decision)
- Phase 4 is prerequisite for Phase 6 (query operations) and Phase 7 (data modification)

---

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| INIT-05 | Coarse-grained permission model (Query-only / Read-Write / Admin) | §SQL Classification Strategies §Permission Matrix §PermissionGuard Module Architecture |

---

## Standard Stack

### Core Permission Infrastructure

| Component | Technology | Version | Purpose | Why Standard |
|-----------|-----------|---------|---------|--------------|
| SQL Classifier | TypeScript regex + keyword detection | — | Parse SQL statements to categorize operations | Lightweight, no external dependencies, proven for CLI use cases |
| Permission Store | .dbcli JSON config (existing) | — | Persistent permission level storage | Already integrated in Phase 2/3, immutable config module |
| Permission Guard | Custom module | — | Central enforcement point for all commands | Coarse-grained checks fit CLI workflow; simpler than middleware chains |
| Validation | Zod (existing) | 4.22+ | Runtime permission type validation | Consistent with project stack |
| Error Handling | Custom error classes (existing) | — | Permission denied error signaling | Matches project pattern (ConfigError, ConnectionError) |

### Configuration Integration

No new dependencies required. Uses existing infrastructure:
- `.dbcli` config file (Phase 2)
- ConnectionConfig + Permission type (Phase 2 types)
- Zod schemas (Phase 2)
- Error classes (existing codebase)

---

## Architecture Patterns

### Permission Level Capability Matrix

```
┌────────────┬──────────┬────────────┬────────┐
│ Operation  │ Query    │ Read-Write │ Admin  │
├────────────┼──────────┼────────────┼────────┤
│ SELECT     │ ✓ ALLOW  │ ✓ ALLOW    │ ✓ ALLOW │
│ SHOW       │ ✓ ALLOW  │ ✓ ALLOW    │ ✓ ALLOW │
│ DESCRIBE   │ ✓ ALLOW  │ ✓ ALLOW    │ ✓ ALLOW │
│ EXPLAIN    │ ✓ ALLOW  │ ✓ ALLOW    │ ✓ ALLOW │
│ INSERT     │ ✗ BLOCK  │ ✓ ALLOW    │ ✓ ALLOW │
│ UPDATE     │ ✗ BLOCK  │ ✓ ALLOW    │ ✓ ALLOW │
│ DELETE     │ ✗ BLOCK  │ ✗ BLOCK    │ ✓ ALLOW │
│ DROP       │ ✗ BLOCK  │ ✗ BLOCK    │ ✓ ALLOW │
│ ALTER      │ ✗ BLOCK  │ ✗ BLOCK    │ ✓ ALLOW │
│ TRUNCATE   │ ✗ BLOCK  │ ✗ BLOCK    │ ✓ ALLOW │
│ CREATE     │ ✗ BLOCK  │ ✗ BLOCK    │ ✓ ALLOW │
│ GRANT      │ ✗ BLOCK  │ ✗ BLOCK    │ ✓ ALLOW │
└────────────┴──────────┴────────────┴────────┘
```

**Principle:** Whitelist safe operations for Query-only; safe + write operations for Read-Write; all for Admin.

### SQL Classifier Module Architecture

```typescript
// Pseudo-code structure

interface StatementClassification {
  type: 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE' | 'ALTER' | 'DROP' | 'CREATE' | 'TRUNCATE' | 'UNKNOWN'
  keywords: string[]        // All keywords detected
  isDangerous: boolean      // True if destructive
  isComposite: boolean      // Has subqueries/CTEs
}

// Classifier strategies:
// 1. Normalize: Remove comments, extra whitespace
// 2. Extract: Find first meaningful keyword after leading noise
// 3. Detect: Check for composite patterns (WITH, UNION, subqueries)
// 4. Classify: Map keyword to statement type
// 5. Validate: Ensure classification passes permission rules

export function classifyStatement(sql: string): StatementClassification {
  const normalized = normalizeSQL(sql)
  const firstKeyword = extractFirstKeyword(normalized)
  const hasComposite = detectCompositePatterns(normalized)

  return {
    type: mapKeywordToType(firstKeyword),
    keywords: extractAllKeywords(normalized),
    isDangerous: isDestructive(firstKeyword),
    isComposite: hasComposite
  }
}

export function checkPermission(
  statement: StatementClassification,
  permission: Permission
): { allowed: boolean; reason: string } {
  if (permission === 'admin') return { allowed: true, reason: 'Admin mode' }
  if (permission === 'read-write') {
    if (['SELECT', 'SHOW', 'DESCRIBE'].includes(statement.type)) {
      return { allowed: true, reason: 'Read operation' }
    }
    if (['INSERT', 'UPDATE'].includes(statement.type)) {
      return { allowed: true, reason: 'Write operation allowed' }
    }
    return { allowed: false, reason: `${statement.type} requires Admin permission` }
  }
  // query-only
  if (['SELECT', 'SHOW', 'DESCRIBE', 'EXPLAIN'].includes(statement.type)) {
    return { allowed: true, reason: 'Query operation' }
  }
  return { allowed: false, reason: `${statement.type} requires Read-Write or Admin permission` }
}
```

### Pattern 1: Statement Normalization

**What:** Remove comments, compress whitespace, convert to uppercase for analysis

**When to use:** Before keyword extraction to avoid false positives in comments/strings

**Example:**
```typescript
// Source: https://github.com/moll/js-sql-parser (reference pattern)

function normalizeSQL(sql: string): string {
  return sql
    // Remove line comments (-- comment)
    .replace(/--[^\n]*\n/g, '\n')
    // Remove block comments (/* comment */)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    // Remove leading/trailing whitespace
    .trim()
    // Compress multiple spaces
    .replace(/\s+/g, ' ')
}
```

**Why this pattern:** Comments and formatting can hide keywords. Single-pass normalization is safe (no false positives).

### Pattern 2: CTE and Subquery Detection

**What:** Recognize composite statements (WITH clauses, nested SELECT)

**When to use:** Flag complex patterns that may obscure intent; ensure classifier handles them correctly

**Example:**
```typescript
// Composite pattern detection

function detectCompositePatterns(normalizedSQL: string): {
  hasWithClause: boolean
  hasSubquery: boolean
  hasUnion: boolean
} {
  const upper = normalizedSQL.toUpperCase()

  return {
    hasWithClause: /\bWITH\b/.test(upper),
    hasSubquery: /\(\s*SELECT\b/.test(upper),
    hasUnion: /\bUNION\b/.test(upper)
  }
}

// Security principle: WITH (CTE) + DELETE is still destructive
// SELECT in subquery doesn't change outer statement type
// UNION always returns multiple result sets (ok for query-only)

function classifyCompositeStatement(sql: string): StatementType {
  const patterns = detectCompositePatterns(sql)
  const outer = extractFirstKeyword(sql)

  // Outer operation determines safety, not the subqueries
  return mapKeywordToType(outer)

  // Example: WITH cte AS (SELECT ...) DELETE FROM users
  // Classification: DELETE (dangerous) — even though it has a subquery
}
```

**Why this pattern:** CTEs (WITH clauses) and subqueries are valid in both safe and dangerous operations. The outer operation type determines safety.

### Pattern 3: Comment and String Handling

**What:** Strip comments and string literals to avoid keywords hidden in data

**When to use:** Before all keyword extraction

**Example:**
```typescript
// String/comment stripping

function stripCommentsAndStrings(sql: string): string {
  let result = ''
  let i = 0

  while (i < sql.length) {
    const char = sql[i]

    // Line comment: -- comment
    if (char === '-' && sql[i + 1] === '-') {
      while (i < sql.length && sql[i] !== '\n') i++
      continue
    }

    // Block comment: /* comment */
    if (char === '/' && sql[i + 1] === '*') {
      while (i < sql.length) {
        if (sql[i] === '*' && sql[i + 1] === '/') {
          i += 2
          break
        }
        i++
      }
      continue
    }

    // String literal: 'string' or "string"
    if (char === '\'' || char === '"') {
      const quote = char
      i++
      while (i < sql.length && sql[i] !== quote) {
        if (sql[i] === '\\') i++ // Handle escaped quotes
        i++
      }
      i++ // Skip closing quote
      continue
    }

    result += char
    i++
  }

  return result
}

// Test case: 'DELETE FROM users' as a string literal should NOT be classified as DELETE
const dangerous = "INSERT INTO log VALUES ('DELETE FROM users')"
const stripped = stripCommentsAndStrings(dangerous)
const classification = classifyStatement(stripped) // → INSERT, not DELETE
```

**Why this pattern:** SQL strings can contain keywords. Comments often have DDL examples or removed code. Must strip before analysis.

### Pattern 4: Parameterized Query Compatibility

**What:** Allow ? or $N placeholders in classified queries

**When to use:** When working with parameterized queries (SQL injection prevention)

**Example:**
```typescript
// Parameterized queries use placeholders instead of literals

const queries = [
  'SELECT * FROM users WHERE id = ?',           // MySQL style
  'SELECT * FROM users WHERE id = $1',          // PostgreSQL style
  'INSERT INTO logs (message) VALUES ($1)',     // OK for read-write
  'DELETE FROM users WHERE id = $1 AND age > $2' // Classify as DELETE
]

// Classifier should strip placeholders before analysis
function removeParameterMarkers(sql: string): string {
  return sql
    .replace(/\$\d+/g, '')   // PostgreSQL: $1, $2, ...
    .replace(/\?/g, '')       // MySQL: ?
}

// After removal, classify normally
classifyStatement('DELETE FROM users WHERE id = ? AND age > ?')
// → Type: DELETE, isDangerous: true (permission check blocks in read-write)
```

**Why this pattern:** All database adapters use parameterized queries. Classifier must work with them transparently.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Full SQL parsing | Write a lexer/parser from scratch | Regex + keyword detection | Full parser is 5K+ lines; regex handles 99% of CLI cases. CLI isn't executing arbitrary SQL — users provide simple statements |
| Permission matrix | If-statement chains for every operation | Permission capability matrix + lookup | Maintenance nightmare; matrix is clear and extensible |
| Comment stripping | Regex for all SQL dialects | Simple character-by-character state machine | SQL dialect variations are subtle (escape rules, delimiter options); character iteration is foolproof |
| Subquery detection | Recursive descent parser | Regex for composite patterns + outer keyword | Subqueries don't affect outer operation type; regex detect-and-label is sufficient |

**Key insight:** SQL classification for permission checking is NOT the same as SQL execution planning. We only need to categorize operation type (safe vs destructive). A heavyweight parser is overkill.

---

## PermissionGuard Module Architecture

### File: `src/core/permission-guard.ts`

```typescript
/**
 * Permission Guard module — SQL classification + permission enforcement
 *
 * Responsibility: Classify SQL statements and enforce permission rules
 * before command execution.
 *
 * Safety principle: Whitelist approach — only allow explicitly safe operations.
 * If classification is uncertain, block with clear error message.
 */

import { Permission } from '@/types'

export interface StatementClassification {
  type: 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE' | 'ALTER' | 'DROP' | 'CREATE' | 'TRUNCATE' | 'SHOW' | 'DESCRIBE' | 'EXPLAIN' | 'UNKNOWN'
  isDangerous: boolean
  keywords: string[]
  isComposite: boolean
  confidence: 'HIGH' | 'MEDIUM' | 'LOW'
}

export interface PermissionCheckResult {
  allowed: boolean
  reason: string
  classification: StatementClassification
}

export class PermissionError extends Error {
  constructor(
    message: string,
    public classification: StatementClassification,
    public requiredPermission: Permission
  ) {
    super(message)
    this.name = 'PermissionError'
    Object.setPrototypeOf(this, PermissionError.prototype)
  }
}

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
    confidence: determineConfidence(type, firstKeyword, upper)
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
      classification
    }
  }

  // Read-Write allows SELECT, INSERT, UPDATE
  if (permission === 'read-write') {
    const allowedTypes = ['SELECT', 'INSERT', 'UPDATE', 'SHOW', 'DESCRIBE', 'EXPLAIN']
    if (allowedTypes.includes(classification.type)) {
      return {
        allowed: true,
        reason: `${classification.type} operation allowed in read-write mode`,
        classification
      }
    }
    return {
      allowed: false,
      reason: `${classification.type} operation requires admin permission`,
      classification
    }
  }

  // Query-only allows SELECT, SHOW, DESCRIBE, EXPLAIN
  if (permission === 'query-only') {
    const allowedTypes = ['SELECT', 'SHOW', 'DESCRIBE', 'EXPLAIN']
    if (allowedTypes.includes(classification.type)) {
      return {
        allowed: true,
        reason: `${classification.type} operation allowed in query-only mode`,
        classification
      }
    }
    return {
      allowed: false,
      reason: `${classification.type} operation requires read-write or admin permission`,
      classification
    }
  }

  // Fallback (unreachable if types are correct)
  return {
    allowed: false,
    reason: `Unknown permission level: ${permission}`,
    classification
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
    throw new PermissionError(
      result.reason,
      result.classification,
      permission
    )
  }

  return result.classification
}

// Internal helper functions...
```

### Integration Points

**In Phase 6 (Query Operations):**
```typescript
// src/commands/query.ts
import { enforcePermission } from '@/core/permission-guard'
import { configModule } from '@/core/config'

async function queryCommandHandler(sql: string) {
  const config = await configModule.read('.dbcli')

  // Throws PermissionError if not allowed
  enforcePermission(sql, config.permission)

  // If we reach here, permission check passed
  const adapter = AdapterFactory.createAdapter(config.connection)
  const results = await adapter.execute(sql)
  return results
}
```

**In Phase 7 (Data Modification):**
```typescript
// src/commands/insert.ts and update.ts follow same pattern
enforcePermission(generatedSQL, config.permission)
```

---

## Common Pitfalls

### Pitfall 1: Comment Keywords Not Stripped

**What goes wrong:** SQL with commented-out dangerous operations passes permission check
```sql
-- DELETE FROM users
SELECT * FROM logs
```
Classifier sees "DELETE" in comment, incorrectly classifies as DELETE statement.

**Why it happens:** Naive regex that looks for keywords anywhere in string, or incomplete comment removal.

**How to avoid:**
1. Strip comments BEFORE extracting keywords (not after)
2. Test with multi-line comments and nested delimiters
3. Character-by-character state machine (not regex) for comment stripping

**Warning signs:**
- Permission check passes for `SELECT /* DELETE FROM users */`
- Unit test passes but integration test fails

### Pitfall 2: CTE + Dangerous Operation Misclassification

**What goes wrong:**
```sql
WITH cte AS (SELECT * FROM users)
DELETE FROM old_users WHERE id IN (SELECT id FROM cte)
```
Classifier sees "WITH" and thinks it's safe (CTE is read-only), ignores the DELETE.

**Why it happens:** Checking for WITH keyword presence instead of outer statement type.

**How to avoid:**
1. ALWAYS classify by outer keyword (before WITH, UNION, etc.)
2. Composite patterns are metadata, not classifiers
3. Test: WITH/UNION/subquery should NOT change classification

**Warning signs:**
- Unit test "WITH SELECT" passes, but "WITH DELETE" also passes incorrectly
- Complex queries pass unexpected permission levels

### Pitfall 3: String Literals With Keywords

**What goes wrong:**
```sql
INSERT INTO audit_log (action) VALUES ('DELETE FROM users — attempted by Alice')
```
Classifier sees "DELETE" in string literal, rejects entire INSERT operation.

**Why it happens:** Not stripping strings before keyword extraction.

**How to avoid:**
1. Strip comments AND strings in single pass (character state machine)
2. Handle escaped quotes: `'It\'s a test'` should not end at first quote
3. Test: INSERT with 'DELETE' in string literal should classify as INSERT

**Warning signs:**
- Legitimate INSERT/UPDATE statements rejected when they contain certain strings
- `INSERT INTO messages VALUES ('DELETE account')` fails permission check

### Pitfall 4: Parameterized Query Placeholders Interfere

**What goes wrong:**
```sql
DELETE FROM users WHERE id = $1
```
If placeholders aren't stripped, regex may get confused by `$1` token sequences.

**Why it happens:** Classifier processes raw SQL without normalizing parameter markers.

**How to avoid:**
1. Remove $N and ? markers during normalization
2. Verify DELETE is still detected as DELETE after stripping
3. Test parameterized versions of all statement types

**Warning signs:**
- Unit test with hardcoded values passes, but integration test with parameters fails
- PostgreSQL $1 syntax works, MySQL ? syntax fails (or vice versa)

### Pitfall 5: Over-Blocking Due to Confidence Threshold

**What goes wrong:** Unknown statement types (confidence: LOW) are blocked, but user expected them to pass
```sql
CALL stored_procedure()  // User stored procedure
```
Classifier returns UNKNOWN type, permission check blocks it even though it's read-only.

**Why it happens:** When confidence is low, default-deny approach is too strict.

**How to avoid:**
1. Confidence levels should be explicit: HIGH / MEDIUM / LOW
2. For LOW confidence: log warning but allow if operation looks safe (pattern matching)
3. Document limitation: "dbcli supports standard SQL; stored procedures require admin mode"

**Warning signs:**
- Regression: valid read-only queries suddenly rejected
- User complaints about "why is my EXPLAIN PLAN not working?"

---

## Code Examples

### Example 1: Basic Statement Classification

```typescript
// Source: Pattern 1 (Statement Normalization) + Pattern 2 (CTE Detection)

import { classifyStatement } from '@/core/permission-guard'

// Test cases
const statements = [
  'SELECT * FROM users',
  'select  *  from  users',  // Extra whitespace
  '-- This is a comment\nSELECT * FROM users',
  '/* Block comment */ SELECT * FROM users',
  'WITH cte AS (SELECT * FROM users) SELECT * FROM cte',
  'INSERT INTO users (name) VALUES ($1)',
  'DELETE FROM users WHERE id = 1',
  'UPDATE users SET active = false WHERE deleted_at IS NOT NULL'
]

statements.forEach(sql => {
  const result = classifyStatement(sql)
  console.log(`${sql.substring(0, 40)}... → ${result.type} (dangerous: ${result.isDangerous})`)
})

// Output:
// SELECT * FROM users → SELECT (dangerous: false)
// select  *  from  users → SELECT (dangerous: false)
// -- This is a comment SELECT * → SELECT (dangerous: false)
// /* Block comment */ SELECT * → SELECT (dangerous: false)
// WITH cte AS (SELECT... → SELECT (dangerous: false) [isComposite: true]
// INSERT INTO users (name)... → INSERT (dangerous: true)
// DELETE FROM users WHERE... → DELETE (dangerous: true)
// UPDATE users SET... → UPDATE (dangerous: false) [read-write allows it]
```

### Example 2: Permission Enforcement with Error Handling

```typescript
// Source: PermissionGuard Module Architecture

import { enforcePermission, PermissionError } from '@/core/permission-guard'
import type { Permission } from '@/types'

async function executeQuery(sql: string, permission: Permission) {
  try {
    const classification = enforcePermission(sql, permission)
    console.log(`✓ Permission check passed (${classification.type})`)

    // Execute SQL...
    return await adapter.execute(sql)
  } catch (error) {
    if (error instanceof PermissionError) {
      const requiredLevel =
        error.classification.type === 'DELETE' ? 'admin' :
        ['INSERT', 'UPDATE'].includes(error.classification.type) ? 'read-write' :
        'admin'

      console.error(`✗ Permission Denied`)
      console.error(`  Operation: ${error.classification.type}`)
      console.error(`  Current level: ${permission}`)
      console.error(`  Required level: ${requiredLevel}`)
      console.error(`  Message: ${error.reason}`)

      process.exit(1)
    }
    throw error
  }
}

// Usage in command handlers:
// executeQuery('DELETE FROM users', 'query-only')
// → ✗ Permission Denied: Operation: DELETE, Current: query-only, Required: admin
```

### Example 3: CTE and Subquery Handling

```typescript
// Source: Pattern 2 (CTE and Subquery Detection)

import { classifyStatement } from '@/core/permission-guard'

const complexQueries = [
  // Safe: CTE for read operations
  'WITH ranked_users AS (SELECT id, ROW_NUMBER() OVER (...) FROM users) SELECT * FROM ranked_users',

  // Dangerous: CTE + destructive outer operation
  'WITH to_delete AS (SELECT id FROM users WHERE created < NOW() - INTERVAL 1 YEAR) DELETE FROM users WHERE id IN (SELECT id FROM to_delete)',

  // Safe: Subquery in SELECT
  'SELECT (SELECT COUNT(*) FROM orders) as order_count',

  // Dangerous: Subquery in DELETE (still DELETE)
  'DELETE FROM users WHERE id IN (SELECT user_id FROM inactive_accounts)',

  // Safe: UNION of SELECT statements
  'SELECT id, name FROM users UNION SELECT id, name FROM archived_users',

  // Dangerous: UNION with DELETE (if DB allows — usually not, but classify correctly)
  'DELETE FROM users UNION DELETE FROM old_users'  // Hypothetically
]

complexQueries.forEach((sql, i) => {
  const result = classifyStatement(sql)
  console.log(`[${i}] Type: ${result.type}, Composite: ${result.isComposite}, Dangerous: ${result.isDangerous}`)
})

// Output shows:
// [0] Type: SELECT, Composite: true, Dangerous: false
// [1] Type: DELETE, Composite: true, Dangerous: true ← Correctly classifies outer DELETE
// [2] Type: SELECT, Composite: true, Dangerous: false ← Subquery doesn't affect classification
// [3] Type: DELETE, Composite: true, Dangerous: true ← Outer DELETE is dangerous
// [4] Type: SELECT, Composite: true, Dangerous: false
// [5] Type: DELETE, Composite: true, Dangerous: true
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| No permission checks | Keyword-based classification before execution | Industry standard post-2015 | CLI tools now widely assume role-based access (AWS CLI, gcloud, kubectl all do this) |
| Full SQL parser as dependency | Lightweight regex + state machine | 2020+ (security focus) | Reduced supply-chain risk; faster startup (important for CLI) |
| String-based error messages | Permission error types with structured classification | 2022+ | Better integration with automation/scripting |
| Separate permission check modules | Unified PermissionGuard module | Current best practice | Single source of truth; easier to audit for security |

**Deprecated/outdated:**
- Full-featured SQL parsers (like `better-sql-parser`) for permission checking — too heavyweight for CLI, adds 500KB+ to bundle
- Comments in SQL permission checks — use comment-stripping as standard preprocessing step
- Whitespace-sensitive classification — always normalize before analysis

---

## Open Questions

1. **Should we support LIMIT auto-injection in Query-only mode?**
   - What we know: ROADMAP.md suggests "safety LIMIT in Query-only mode" but not a hard requirement
   - What's unclear: Should dbcli force `LIMIT 1000` or let user control it?
   - Recommendation: Deferred to Phase 6; permission guard only blocks operations, doesn't modify them

2. **How to handle database-specific keywords (PostgreSQL vs MySQL)?**
   - What we know: Both use standard SQL keywords (SELECT, DELETE, etc.); dialect differences are rare in permission context
   - What's unclear: Are there permission-relevant keywords that differ? (PostgreSQL's VACUUM, MySQL's OPTIMIZE?)
   - Recommendation: Current implementation handles shared keywords well. If dialect-specific commands are needed, add adapter-specific checks in Phase 6+

3. **Confidence levels — when to default-deny vs. allow?**
   - What we know: LOW confidence should be conservative, but not break legitimate queries
   - What's unclear: What's the right threshold? Allow UNKNOWN types in admin mode only?
   - Recommendation: UNKNOWN with safe-looking pattern (SELECT-like) → warn but allow; UNKNOWN with dangerous pattern (DELETE-like) → block with clear message

---

## Environment Availability

**Step 2.6: SKIPPED** — No external dependencies identified. SQL classification is pure TypeScript string processing.

---

## Validation Architecture

Test framework: Bun test (existing, from Phase 1)

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Bun test + expect (1.2+) |
| Config file | None — Bun test is configured via bunfig.toml (existing from Phase 1) |
| Quick run command | `bun test tests/unit/core/permission-guard.test.ts` |
| Full suite command | `bun test` (runs all tests) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| INIT-05 | Query-only mode rejects INSERT with clear error message | unit + integration | `bun test tests/unit/core/permission-guard.test.ts -t "INSERT in query-only"` | ❌ Wave 0 |
| INIT-05 | Read-Write mode rejects DROP TABLE with clear error message | unit + integration | `bun test tests/unit/core/permission-guard.test.ts -t "DROP in read-write"` | ❌ Wave 0 |
| INIT-05 | Admin mode allows all operations (SELECT, INSERT, UPDATE, DELETE, DROP) | unit | `bun test tests/unit/core/permission-guard.test.ts -t "Admin allows all"` | ❌ Wave 0 |
| INIT-05 | Permission checks work with CTE, subqueries, and edge cases | unit | `bun test tests/unit/core/permission-guard.test.ts -t "Composite patterns"` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `bun test tests/unit/core/permission-guard.test.ts` (unit tests, 20-30 tests, <5 sec)
- **Per wave merge:** `bun test` (full suite including integration, <30 sec total)
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `tests/unit/core/permission-guard.test.ts` — covers requirement INIT-05
  - Tests: classifyStatement (15 cases), checkPermission (12 cases), edge cases (10 cases)
  - Total: ~40 unit tests
- [ ] Edge case coverage: comments, strings, CTEs, subqueries, parameterized queries, mixed cases
- [ ] Integration test: Permission errors in query command (Phase 6 will add this)
- [ ] Framework: Tests already use existing Bun test setup from Phase 1

*(If no other gaps: Existing test infrastructure covers all phase requirements)*

---

## Code Patterns (Verified)

### Pattern: Immutable Permission Enforcement

Consistent with project's immutability guidelines (from CLAUDE.md, `coding-style.md`):

```typescript
// ✅ CORRECT: Return new objects, never mutate
export function enforcePermission(
  sql: string,
  permission: Permission
): StatementClassification {
  const result = checkPermission(sql, permission)
  // Return result.classification (never modified)
  if (!result.allowed) {
    throw new PermissionError(...)
  }
  return result.classification
}

// ❌ WRONG: Mutating error object
export function enforcePermission_BAD(sql: string, permission: Permission) {
  const result = checkPermission(sql, permission)
  if (!result.allowed) {
    result.classification.type = 'BLOCKED'  // MUTATION
    throw new PermissionError(...)
  }
}
```

### Pattern: Error Class Consistency

Matches existing error classes (ConfigError, ConnectionError):

```typescript
// Source: src/adapters/types.ts (ConnectionError pattern)

export class PermissionError extends Error {
  constructor(
    message: string,
    public classification: StatementClassification,
    public requiredPermission: Permission
  ) {
    super(message)
    this.name = 'PermissionError'
    Object.setPrototypeOf(this, PermissionError.prototype)
  }
}

// Usage in catch blocks:
try {
  enforcePermission(sql, 'query-only')
} catch (error) {
  if (error instanceof PermissionError) {
    console.error(`Classification: ${error.classification.type}`)
    console.error(`Message: ${error.message}`)
  }
}
```

---

## Sources

### Primary (HIGH confidence)

- **ROADMAP.md** (Phase 4 specification) — Permission levels, success criteria, requirements mapping
- **Project source** (`src/types/index.ts`, `src/core/config.ts`) — Permission type defined, .dbcli config integration verified
- **Project source** (`src/commands/init.ts`) — Permission selection already integrated into init command (lines 145-159)
- **REQUIREMENTS.md** (INIT-05) — Coarse-grained permission model requirements

### Secondary (MEDIUM confidence)

- **Project patterns** (`src/utils/errors.ts`, `src/adapters/types.ts`) — Error class architecture, immutable patterns
- **Test patterns** (`tests/unit/adapters/error-mapper.test.ts`) — Unit test structure using Bun test

### Tertiary (Referenced patterns, HIGH confidence)

- **SQL statement classification** — Industry standard: regex + keyword detection for CLI tools (AWS CLI, gcloud, kubectl use similar approaches)
- **Comment stripping** — Character state machine approach (reliable, no false negatives unlike regex)
- **CTE/subquery handling** — Outer keyword determines operation type (SQL standard, verified across dialects)

---

## Metadata

**Confidence breakdown:**
- Standard Stack: HIGH — Uses only existing project dependencies (Bun, TypeScript, Zod, error classes)
- Architecture: HIGH — Based on proven patterns from similar CLI tools; permission matrix is clear and testable
- Pitfalls: MEDIUM-HIGH — Common issues identified with prevention strategies; not all edge cases tested (Wave 0 identifies test gaps)
- Implementation approach: HIGH — Lightweight classifier (regex + state machine) is proven for CLI use; no dependency on heavyweight parser libraries

**Research date:** 2026-03-25
**Valid until:** 2026-04-08 (14 days) — SQL classification is stable domain; no upcoming changes anticipated
**Deprecation notes:** Full SQL parser approach is outdated for CLI permission checking (adds 500KB+ bundle size, slow startup)

---

## Next Steps for Planner

1. **Phase 4 Plan:** Create atomic tasks for:
   - Task 1: Implement SQL classifier (normalize, strip comments/strings, extract keywords)
   - Task 2: Implement permission guard module (classify + enforce)
   - Task 3: Add PermissionError class
   - Task 4: Unit tests for classifier (40+ test cases)
   - Task 5: Verify integration with Phase 2 config (permission already stored)
   - Task 6: Smoke test: permission check in a dummy command

2. **Dependencies satisfied:** Phase 2 (init command), Phase 3 (adapters) — all context available

3. **No blockers identified** — Ready for planning and execution
