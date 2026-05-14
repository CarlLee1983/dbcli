/**
 * Builds planner-only SQL strings from validated DML inputs for use by
 * `analyzeQueryRisk()`. The returned SQL is an analysis artifact: it
 * preserves operation, target table, written column names, and WHERE
 * presence/columns well enough for the analyzer's regex extractors,
 * but it is NOT intended for execution.
 *
 * Values are never embedded; placeholders (`?`) are used so analysis
 * stays deterministic and never leaks sensitive data.
 */

const IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/

function assertIdentifier(value: string, role: 'table' | 'column'): void {
  if (!value || !IDENTIFIER_RE.test(value)) {
    throw new Error(
      `Invalid ${role} identifier: ${JSON.stringify(value)}. ` +
        `${role === 'table' ? 'Table' : 'Column'} names must match /^[A-Za-z_][A-Za-z0-9_]*$/.`
    )
  }
}

function normalizeTable(table: string): string {
  if (!table || table.trim() === '') {
    throw new Error('Table name required for plan SQL')
  }
  const trimmed = table.trim()
  assertIdentifier(trimmed, 'table')
  return trimmed
}

function normalizeColumns(data: Record<string, unknown>, role: 'data' | 'set'): string[] {
  const keys = Object.keys(data)
  if (keys.length === 0) {
    throw new Error(
      role === 'data'
        ? 'INSERT plan requires at least one column in --data'
        : 'UPDATE plan requires at least one column in --set'
    )
  }
  for (const key of keys) {
    assertIdentifier(key, 'column')
  }
  return keys
}

export function buildInsertPlanSql(table: string, data: Record<string, unknown>): string {
  const t = normalizeTable(table)
  const columns = normalizeColumns(data, 'data')
  const placeholders = columns.map(() => '?').join(', ')
  return `INSERT INTO ${t} (${columns.join(', ')}) VALUES (${placeholders})`
}
