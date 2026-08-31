import type { DatabaseSystem } from '../adapters/types'
import { checkPermissionForClassification, classifyStatement } from '@/core/permission-guard'

/**
 * Common regex for extracting table name from SQL.
 * Supports:
 * - SELECT ... FROM table
 * - INSERT INTO table
 * - UPDATE table
 * - DELETE FROM table
 */
/**
 * Extract the primary table name from a SQL query.
 *
 * Scanned, not regex-matched. A single regex over the raw text let the operator
 * choose the name: `/* FROM audit_decoy *\/ DELETE FROM users` recorded
 * `audit_decoy`, and `SELECT 'INTO decoy' AS note FROM salaries` recorded
 * `decoy`. `target` is the field auditors filter on — `audit show`, `recover`
 * and `inspect` all lead with it — so a record filed under a name of the
 * writer's choosing is a record that will not be found. Not found and not
 * written are the same thing afterwards.
 *
 * The scan also fixes two everyday mis-readings: `public.users` recorded as
 * `public` (the schema), and `SELECT EXTRACT(MONTH FROM created_at) FROM
 * salaries` recorded as `created_at` (a column), because the keyword inside the
 * function call came first.
 *
 * This answers "which name does this statement lead with", not "every table it
 * touches" — those are different questions and the second one has its own
 * enumerator in `sql-tables.ts`.
 */
export function extractTableName(sql: string): string | null {
  const text = blankCommentsAndLiterals(sql)
  let depth = 0
  let index = 0

  const readIdentifier = (from: number): { name: string; end: number } | null => {
    let i = from
    while (i < text.length && /\s/.test(text[i]!)) i += 1
    if (i >= text.length) return null

    const quote = text[i]
    if (quote === '"' || quote === '`') {
      const close = text.indexOf(quote, i + 1)
      if (close === -1) return null
      return { name: text.slice(i + 1, close), end: close + 1 }
    }

    // Unquoted: letters, digits, `_`, `$`, and `.` so a schema-qualified name
    // stays whole rather than being cut at the dot.
    const match = /^[a-zA-Z_][a-zA-Z0-9_$.]*/.exec(text.slice(i))
    if (match === null) return null
    return { name: match[0], end: i + match[0].length }
  }

  while (index < text.length) {
    const char = text[index]!
    if (char === '(') depth += 1
    else if (char === ')') depth = Math.max(0, depth - 1)
    else if (depth === 0 && /[a-zA-Z]/.test(char)) {
      const word = /^[a-zA-Z]+/.exec(text.slice(index))![0]
      if (['FROM', 'INTO', 'UPDATE'].includes(word.toUpperCase())) {
        // Depth 0 only: the `FROM` in `EXTRACT(MONTH FROM created_at)` names a
        // column, and it comes before the statement's own `FROM`.
        const identifier = readIdentifier(index + word.length)
        if (identifier !== null) return identifier.name
      }
      index += word.length
      continue
    }
    index += 1
  }
  return null
}

/**
 * Blank out comments and string literals, keeping quoted identifiers.
 *
 * **Not** `stripCommentsAndStrings` from `@/core/permission/sql-analysis`, and
 * the difference is deliberate rather than an oversight — this file has spent
 * eight review rounds on the hazard of two functions answering one question,
 * so the divergence is stated:
 *
 * - That one blanks quoted identifiers too. Correct for permission analysis,
 *   wrong here: `DELETE FROM "user-accounts"` needs the identifier to survive,
 *   because it *is* the answer.
 * - That one does not nest block comments. Harmless there — it leaves more text
 *   visible, so a statement can only classify as *more* dangerous — but here
 *   leaving text visible is what lets `/* a /* b *\/ FROM decoy *\/` choose the
 *   recorded name.
 *
 * If those two needs ever converge, merge into the canonical one; do not grow a
 * third.
 */
function blankCommentsAndLiterals(sql: string): string {
  const out = sql.split('')
  let i = 0
  const blank = (from: number, to: number): void => {
    for (let k = from; k < to && k < out.length; k += 1) {
      if (out[k] !== '\n') out[k] = ' '
    }
  }

  while (i < sql.length) {
    const two = sql.slice(i, i + 2)
    if (two === '--') {
      const end = sql.indexOf('\n', i)
      blank(i, end === -1 ? sql.length : end)
      i = end === -1 ? sql.length : end
      continue
    }
    if (two === '/*') {
      // Nested block comments: PostgreSQL supports them, and a nested one would
      // otherwise end the scan early and expose the text after it.
      let depth = 1
      let k = i + 2
      while (k < sql.length && depth > 0) {
        if (sql.slice(k, k + 2) === '/*') {
          depth += 1
          k += 2
        } else if (sql.slice(k, k + 2) === '*/') {
          depth -= 1
          k += 2
        } else k += 1
      }
      blank(i, k)
      i = k
      continue
    }
    if (sql[i] === "'") {
      let k = i + 1
      while (k < sql.length) {
        if (sql[k] === "'" && sql[k + 1] === "'") k += 2
        else if (sql[k] === "'") break
        else k += 1
      }
      blank(i, Math.min(k + 1, sql.length))
      i = k + 1
      continue
    }
    if (sql[i] === '"' || sql[i] === '`') {
      const close = sql.indexOf(sql[i]!, i + 1)
      i = close === -1 ? sql.length : close + 1
      continue
    }
    i += 1
  }
  return out.join('')
}

/**
 * The side-effect tier a statement deserves, when it differs from its command's.
 *
 * `writeAuditEntry` falls back to the *command's* capability tier, and `query`
 * is `readonly` because most queries read. So every DML executed through
 * `dbcli query` — `DELETE`, `UPDATE`, `INSERT`, `CREATE TABLE AS` — was filed as
 * `readonly`, while the `DROP` and `TRUNCATE` that the write gate *refused* were
 * filed as `db-write` by `recordGateDecision`. Filtering the audit log by tier
 * for destructive operations — the obvious first filter — found the ones that
 * were blocked and missed the ones that happened.
 *
 * ADR-0014 records the same defect on the Elasticsearch path ("one destructive
 * operation filed under three tiers depending on which command reached it").
 * This is the SQL half of it, which that fix did not cover.
 *
 * Returns `undefined` for reads, so the command's own capability still applies.
 */
export function sideEffectTierForStatement(sql: string): 'db-write' | undefined {
  // 「讀」的定義取自既有的 tier 語意，而不是另外列一份唯讀清單：在
  // `query-only` 下被允許的就是讀。少列一個型別（`EXPLAIN`、`SHOW`…）會讓
  // 那個型別被錯誤標成寫入，而多一份需要同步的清單正是這條分支反覆修掉的形狀。
  const classification = classifyStatement(sql)
  return checkPermissionForClassification(classification, 'query-only').allowed
    ? undefined
    : 'db-write'
}

/**
 * Standardize operation target across different database engines.
 */
export function getOperationTarget(
  system: DatabaseSystem,
  command: string,
  options: { collection?: string; index?: string; [key: string]: unknown },
  sql?: string
): string {
  // 1. Explicit collection/index for MongoDB/ES
  if (system === 'mongodb') {
    return options.collection || '<unknown-collection>'
  }
  if (system === 'elasticsearch') {
    return options.index || options.collection || '<unknown-index>'
  }

  // 2. Redis typically uses the first positional arg as the target (handled by caller)
  // but if we have a table-like arg, we can use it.
  if (system === 'redis') {
    return (options.table as string) || (options.key as string) || '<unknown-key>'
  }

  // 3. SQL: Extract from body if provided
  if (sql) {
    const table = extractTableName(sql)
    if (table) return table
  }

  // 4. Fallback to command-specific option
  return (options.table as string) || '<unknown-target>'
}
