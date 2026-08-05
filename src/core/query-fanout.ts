import type { QueryResult } from '@/types/query'
import { mapCliError, type CliErrorPresentation } from '@/utils/cli-error'
import {
  enforcePermission,
  stripCommentsAndStrings,
  SQL_WRITE_OR_DDL_KEYWORDS,
} from '@/core/permission-guard'

export type ConnectionQueryOutcome =
  | {
      connection: string
      status: 'ok'
      result: QueryResult<Record<string, unknown>>
    }
  | {
      connection: string
      status: 'error'
      error: CliErrorPresentation
    }

/** Run independent connection work concurrently while preserving selector order. */
export async function runQueryFanOut(
  connectionNames: readonly string[],
  execute: (connectionName: string) => Promise<QueryResult<Record<string, unknown>>>
): Promise<ConnectionQueryOutcome[]> {
  const settled = await Promise.allSettled(connectionNames.map((name) => execute(name)))

  return settled.map((outcome, index) => {
    const connection = connectionNames[index]!
    return outcome.status === 'fulfilled'
      ? { connection, status: 'ok' as const, result: outcome.value }
      : { connection, status: 'error' as const, error: mapCliError(outcome.reason) }
  })
}

export function aggregateFanOutExitCode(outcomes: readonly ConnectionQueryOutcome[]): 0 | 1 | 2 {
  const successCount = outcomes.filter((outcome) => outcome.status === 'ok').length
  if (successCount === outcomes.length) return 0
  if (successCount === 0) return 1
  return 2
}

/**
 * Fail closed around SQL shapes whose leading keyword looks read-only but can
 * execute writes, notably data-modifying CTEs and EXPLAIN ANALYZE writes.
 */
export function assertFanOutReadOnlySql(
  sql: string,
  dialect: 'postgresql' | 'mysql' | 'mariadb'
): void {
  // The dialect is known here, so the statement count is checked first and
  // reports the fan-out contract rather than the generic stacking message.
  const executableSql = stripCommentsAndStrings(sql, { dialect })
  const statements = executableSql
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean)
  if (statements.length !== 1) {
    throw new Error('Multi-connection SQL must contain exactly one read-only statement')
  }
  const classification = enforcePermission(sql, 'query-only')
  const containsWrite = SQL_WRITE_OR_DDL_KEYWORDS.test(executableSql)
  const explainExecutes = classification.type === 'EXPLAIN' && /\bANALYZE\b/i.test(executableSql)

  if ((classification.type === 'SELECT' && containsWrite) || (explainExecutes && containsWrite)) {
    throw new Error('Multi-connection SQL must be proven read-only before any connection executes')
  }
}
