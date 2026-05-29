/**
 * PostgreSQL EXPLAIN adapter — issues EXPLAIN (FORMAT JSON) [ANALYZE, BUFFERS]
 * and recursively flattens the JSON plan tree into ExplainRow[].
 *
 * Reference: https://www.postgresql.org/docs/current/sql-explain.html
 */

import type { DatabaseAdapter } from '@/adapters/types'
import type { ExplainOptions, ExplainPlan, ExplainRow } from '@/core/explain/types'

type PgPlanNode = {
  'Node Type'?: string
  'Relation Name'?: string
  'Index Name'?: string
  'Plan Rows'?: number
  'Actual Rows'?: number
  'Startup Cost'?: number
  'Total Cost'?: number
  'Sort Method'?: string
  Plans?: PgPlanNode[]
}

type PgExplainPayload = Array<{ Plan: PgPlanNode }>

export async function runPgExplain(
  adapter: DatabaseAdapter,
  sql: string,
  options: ExplainOptions
): Promise<ExplainPlan> {
  const opts = options.analyze
    ? 'EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)'
    : 'EXPLAIN (FORMAT JSON)'
  const wrapped = `${opts} ${sql}`
  const result = await adapter.execute<{ 'QUERY PLAN': string | object }>(wrapped)

  // PG driver may return either a JSON string or an already-parsed object.
  const queryPlanCell = result.rows[0]?.['QUERY PLAN']
  const payload: PgExplainPayload =
    typeof queryPlanCell === 'string'
      ? (JSON.parse(queryPlanCell) as PgExplainPayload)
      : (queryPlanCell as PgExplainPayload)

  const rootNode = payload?.[0]?.Plan
  const rows: ExplainRow[] = rootNode ? flatten(rootNode) : []

  return {
    rows,
    system: 'postgresql',
    rawSql: sql,
    raw: payload,
  }
}

function flatten(node: PgPlanNode): ExplainRow[] {
  const self: ExplainRow = {
    driving: node['Relation Name'] ?? '',
    accessType: node['Node Type'] ?? '',
    key: node['Index Name'] ?? null,
    rows: node['Plan Rows'] ?? 0,
    extra: node['Sort Method'] ? [`Sort Method: ${node['Sort Method']}`] : [],
    cost: {
      startup: node['Startup Cost'] ?? 0,
      total: node['Total Cost'] ?? 0,
    },
    actualRows: node['Actual Rows'],
    annotations: [],
  }
  const children = (node.Plans ?? []).flatMap(flatten)
  return [self, ...children]
}
