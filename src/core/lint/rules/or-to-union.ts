import { findingSpan, walkExpr, whereOf } from '@/core/lint/ast-utils'
import type { AstNode, LintRule } from '@/core/lint/types'

function columnName(node: AstNode): string | null {
  const column = node.column
  if (typeof column === 'string') return column
  if (!column || typeof column !== 'object') return null
  const expr = (column as AstNode).expr
  if (!expr || typeof expr !== 'object') return null
  const value = (expr as AstNode).value
  return typeof value === 'string' ? value : null
}

function columnIdentity(node: AstNode): string | null {
  const name = columnName(node)
  if (!name) return null
  const table = node.table
  return typeof table === 'string' && table.length > 0 ? `${table}.${name}` : name
}

function singleColumnWithin(node: unknown): string | null {
  const columns = new Set<string>()
  walkExpr(node, (candidate) => {
    if (candidate.type !== 'column_ref') return
    const identity = columnIdentity(candidate)
    if (identity) columns.add(identity)
  })
  return columns.size === 1 ? [...columns][0]! : null
}

function columnOf(side: AstNode | undefined): string | null {
  if (!side) return null
  if (side.type === 'column_ref') return columnIdentity(side)
  if (side.type === 'function') return singleColumnWithin(side.args)
  if (side.type === 'binary_expr') return columnOf(side.left as AstNode | undefined)
  return null
}

export const orToUnionRule: LintRule = {
  name: 'or-to-union',
  requiresSchema: false,
  check(ctx) {
    const where = whereOf(ctx.ast)
    if (
      !where ||
      where.type !== 'binary_expr' ||
      String(where.operator).toUpperCase() !== 'OR'
    ) {
      return []
    }

    const leftColumn = columnOf(where.left as AstNode | undefined)
    const rightColumn = columnOf(where.right as AstNode | undefined)
    if (!leftColumn || !rightColumn || leftColumn === rightColumn) return []

    return [
      {
        rule: 'or-to-union',
        severity: 'info',
        message: `OR across different columns (${leftColumn} / ${rightColumn}) can complicate index selection. Only consider separate indexed branches combined with UNION ALL when the predicates are mutually exclusive and the rewrite preserves row identity and multiplicity. Verify result equivalence and compare plans; UNION deduplication is not a generic semantic fallback.`,
        span: findingSpan(ctx.sql, ' or '),
        schemaVerified: false,
      },
    ]
  },
}
