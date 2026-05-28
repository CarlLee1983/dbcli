/**
 * Single-query EXPLAIN runner — orchestrates adapter dispatch + annotation
 * in one call. The CLI / bulk-runner consume this entrypoint.
 */

import type { DatabaseAdapter, DatabaseSystem } from '@/adapters/types'
import { runExplain } from '@/adapters/explain'
import { annotateRows } from './annotate'
import type { ExplainOptions, ExplainPlan } from './types'

export async function runQueryExplain(
  system: DatabaseSystem,
  adapter: DatabaseAdapter,
  sql: string,
  options: ExplainOptions,
  queryLabel?: string
): Promise<ExplainPlan> {
  const rawPlan = await runExplain(system, adapter, sql, options)
  const annotated = annotateRows(rawPlan.rows, system)
  const rowsWithLabel = queryLabel ? annotated.map((r) => ({ ...r, queryLabel })) : annotated
  return {
    ...rawPlan,
    rows: rowsWithLabel,
    queryLabel,
  }
}
