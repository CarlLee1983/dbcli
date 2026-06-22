export type ConstraintEngine = 'postgresql' | 'mysql' | 'mariadb'

/** Quote each dot-separated segment of an identifier for the target engine. */
export function quoteIdent(name: string, engine: ConstraintEngine): string {
  const useBacktick = engine === 'mysql' || engine === 'mariadb'
  const q = useBacktick ? '`' : '"'
  const esc = (seg: string) => `${q}${seg.split(q).join(q + q)}${q}`
  return name
    .split('.')
    .map((seg) => esc(seg.trim()))
    .join('.')
}

export function buildNotNullViolationQuery(a: {
  engine: ConstraintEngine
  table: string
  columns: string[]
}): string {
  const where = a.columns.map((c) => `${quoteIdent(c, a.engine)} IS NULL`).join(' OR ')
  return `SELECT COUNT(*) AS violation_count FROM ${quoteIdent(a.table, a.engine)} WHERE ${where}`
}

export function buildUniqueViolationQuery(a: {
  engine: ConstraintEngine
  table: string
  columns: string[]
}): string {
  const cols = a.columns.map((c) => quoteIdent(c, a.engine)).join(', ')
  return `SELECT COUNT(*) AS violation_count FROM (SELECT 1 FROM ${quoteIdent(a.table, a.engine)} GROUP BY ${cols} HAVING COUNT(*) > 1) AS dups`
}

export function buildFkViolationQuery(a: {
  engine: ConstraintEngine
  table: string
  column: string
  refTable: string
  refColumn: string
}): string {
  const col = quoteIdent(a.column, a.engine)
  const ref = quoteIdent(a.refColumn, a.engine)
  return `SELECT COUNT(*) AS violation_count FROM ${quoteIdent(a.table, a.engine)} AS c LEFT JOIN ${quoteIdent(a.refTable, a.engine)} AS p ON c.${col} = p.${ref} WHERE c.${col} IS NOT NULL AND p.${ref} IS NULL`
}

import type { ConstraintInput } from './constraint'

export function buildViolationQuery(input: ConstraintInput, engine: ConstraintEngine): string {
  switch (input.check) {
    case 'custom':
      return input.violationQuery as string
    case 'not-null':
      return buildNotNullViolationQuery({ engine, table: input.table, columns: input.columns })
    case 'unique':
      return buildUniqueViolationQuery({ engine, table: input.table, columns: input.columns })
    case 'fk':
      return buildFkViolationQuery({
        engine,
        table: input.table,
        column: input.columns[0] as string,
        refTable: input.references!.table,
        refColumn: input.references!.column,
      })
  }
}
