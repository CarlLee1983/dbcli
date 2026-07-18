import { findingSpan } from '@/core/lint/ast-utils'
import type { AstNode, LintRule } from '@/core/lint/types'

function hasDistinct(ast: AstNode): boolean {
  const distinct = ast.distinct
  if (typeof distinct === 'string') return distinct.toUpperCase() === 'DISTINCT'
  if (!distinct || typeof distinct !== 'object') return false
  return String((distinct as AstNode).type).toUpperCase() === 'DISTINCT'
}

function groupByColumns(ast: AstNode): unknown[] {
  const groupBy = ast.groupby
  if (Array.isArray(groupBy)) return groupBy
  if (!groupBy || typeof groupBy !== 'object') return []
  const columns = (groupBy as AstNode).columns
  return Array.isArray(columns) ? columns : []
}

function columnIdentity(node: unknown): string | null {
  if (!node || typeof node !== 'object') return null
  const columnRef = node as AstNode
  if (columnRef.type !== 'column_ref') return null

  const column = columnRef.column
  let name: string | null = null
  if (typeof column === 'string') {
    name = column
  } else if (column && typeof column === 'object') {
    const expr = (column as AstNode).expr
    if (expr && typeof expr === 'object') {
      const value = (expr as AstNode).value
      if (typeof value === 'string') name = value
    }
  }
  if (!name) return null

  const table = columnRef.table
  return typeof table === 'string' && table.length > 0 ? `${table}.${name}` : name
}

function projectedColumnIdentities(ast: AstNode): string[] | null {
  if (!Array.isArray(ast.columns) || ast.columns.length === 0) return null
  const identities: string[] = []
  for (const column of ast.columns) {
    if (!column || typeof column !== 'object') return null
    const identity = columnIdentity((column as AstNode).expr)
    if (!identity) return null
    identities.push(identity)
  }
  return identities
}

function groupingColumnIdentities(ast: AstNode): string[] | null {
  const columns = groupByColumns(ast)
  if (columns.length === 0) return null
  const identities = columns.map(columnIdentity)
  if (identities.some((identity) => identity === null)) return null
  return identities as string[]
}

function hasProvablyRedundantDistinct(ast: AstNode): boolean {
  const projected = projectedColumnIdentities(ast)
  const grouped = groupingColumnIdentities(ast)
  if (!projected || !grouped) return false

  const projectedSet = new Set(projected)
  const groupedSet = new Set(grouped)
  return (
    projectedSet.size === groupedSet.size &&
    [...projectedSet].every((identity) => groupedSet.has(identity))
  )
}

export const distinctGroupbyAbuseRule: LintRule = {
  name: 'distinct-groupby-abuse',
  requiresSchema: false,
  check(ctx) {
    if (
      ctx.ast.type !== 'select' ||
      !hasDistinct(ctx.ast) ||
      !hasProvablyRedundantDistinct(ctx.ast)
    ) {
      return []
    }
    return [
      {
        rule: 'distinct-groupby-abuse',
        severity: 'warn',
        message:
          'DISTINCT is redundant because the projected simple columns exactly cover the GROUP BY columns. Drop DISTINCT.',
        span: findingSpan(ctx.sql, 'distinct'),
        schemaVerified: false,
      },
    ]
  },
}
