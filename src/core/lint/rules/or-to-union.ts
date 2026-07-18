import { findingSpan, whereOf } from '@/core/lint/ast-utils'
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

function columnOf(side: AstNode | undefined): string | null {
  if (!side) return null
  if (side.type === 'column_ref') return columnName(side)
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
        message: `OR across different columns (${leftColumn} / ${rightColumn}) often defeats index selection. Consider rewriting as two indexed queries combined with UNION ALL (dedupe with UNION if rows can overlap).`,
        span: findingSpan(ctx.sql, ' or '),
        schemaVerified: false,
      },
    ]
  },
}
