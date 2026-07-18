import {
  collectTables,
  findingSpan,
  walkExpr,
  whereOf,
} from '@/core/lint/ast-utils'
import type { AstNode, LintFinding, LintRule } from '@/core/lint/types'

function columnName(node: AstNode): string | null {
  if (typeof node.column === 'string') return node.column
  if (!node.column || typeof node.column !== 'object') return null

  const expression = (node.column as AstNode).expr
  if (!expression || typeof expression !== 'object') return null

  const value = (expression as AstNode).value
  return typeof value === 'string' ? value : null
}

export const notInNullableRule: LintRule = {
  name: 'not-in-nullable',
  requiresSchema: true,
  check(ctx) {
    const where = whereOf(ctx.ast)
    if (!where) return []

    const tables = collectTables(ctx.ast)
    const findings: LintFinding[] = []

    walkExpr(where, (node) => {
      if (
        node.type !== 'binary_expr' ||
        String(node.operator).toUpperCase() !== 'NOT IN'
      ) {
        return
      }

      const left = node.left as AstNode | undefined
      if (left?.type !== 'column_ref') return

      const name = columnName(left)
      if (!name) return

      const resolved = ctx.schema.resolveColumn(tables, name)
      if (!resolved?.column.nullable) return

      findings.push({
        rule: 'not-in-nullable',
        severity: 'warn',
        message: `NOT IN over nullable column '${resolved.column.name}': if the list (or a subquery result) contains NULL the predicate yields no rows. Prefer NOT EXISTS, or add an explicit IS NOT NULL guard.`,
        span: findingSpan(ctx.sql, 'not in'),
        schemaVerified: true,
      })
    })

    return findings
  },
}
