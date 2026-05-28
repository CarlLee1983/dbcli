/**
 * EXPLAIN dispatcher — selects the right runner based on database system.
 * MongoDB / Redis / Elasticsearch are out of scope for v1.23 (not relational).
 */

import type { DatabaseAdapter, DatabaseSystem } from '@/adapters/types'
import type { ExplainOptions, ExplainPlan } from '@/core/explain/types'
import { runMysqlExplain } from './mysql-mariadb'
import { runPgExplain } from './postgresql'

export async function runExplain(
  system: DatabaseSystem,
  adapter: DatabaseAdapter,
  sql: string,
  options: ExplainOptions
): Promise<ExplainPlan> {
  if (system === 'postgresql') {
    return runPgExplain(adapter, sql, options)
  }
  if (system === 'mysql' || system === 'mariadb') {
    return runMysqlExplain(adapter, sql, options, system)
  }
  throw new Error(
    `EXPLAIN is not supported for system '${system}'. Supported: postgresql, mysql, mariadb.`
  )
}
