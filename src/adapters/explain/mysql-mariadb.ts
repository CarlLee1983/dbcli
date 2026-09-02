/**
 * MySQL/MariaDB EXPLAIN adapter.
 * Maps driver rows from `EXPLAIN <sql>` or `ANALYZE SELECT <sql>` into the
 * unified ExplainRow schema. Does NOT run annotation — that is a separate layer.
 */

import type { DatabaseAdapter } from '@/adapters/types'
import type { ExplainOptions, ExplainPlan, ExplainRow } from '@/core/explain/types'

type RawMysqlExplainRow = {
  id?: number
  select_type?: string
  table?: string
  type?: string
  possible_keys?: string | null
  key?: string | null
  key_len?: string | null
  ref?: string | null
  rows?: number
  filtered?: number
  Extra?: string | null
}

export async function runMysqlExplain(
  adapter: DatabaseAdapter,
  sql: string,
  options: ExplainOptions,
  system: 'mysql' | 'mariadb' = 'mariadb'
): Promise<ExplainPlan> {
  const wrapped = options.analyze ? `ANALYZE ${sql}` : `EXPLAIN ${sql}`
  const result = await adapter.execute<RawMysqlExplainRow>(wrapped, undefined, {
    sqlMode: options.executionMode ?? 'normal',
  })
  const rows: ExplainRow[] = result.rows.map(normalizeRow)
  return {
    rows,
    system,
    rawSql: sql,
    raw: result.rows,
  }
}

function normalizeRow(raw: RawMysqlExplainRow): ExplainRow {
  const extra =
    typeof raw.Extra === 'string' && raw.Extra.length > 0
      ? raw.Extra.split(';')
          .map((s) => s.trim())
          .filter(Boolean)
      : []
  return {
    driving: raw.table ?? '',
    accessType: raw.type ?? '',
    key: raw.key ?? null,
    rows: raw.rows ?? 0,
    filtered: raw.filtered,
    extra,
    annotations: [],
  }
}
