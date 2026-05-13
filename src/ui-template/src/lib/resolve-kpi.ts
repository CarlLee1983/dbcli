import { formatValue, type ValueFormat } from './format-value'

export interface KpiSpec {
  label: string
  value_column: string
  format?: ValueFormat
}

export function resolveKpi(
  rows: ReadonlyArray<Record<string, unknown>>,
  kpi: KpiSpec
): string | number | null | undefined {
  if (rows.length === 0) return null
  const row = rows[0]
  if (row === undefined || !(kpi.value_column in row)) return null
  return formatValue(row[kpi.value_column], kpi.format)
}
