import { findingSpan } from '@/core/lint/ast-utils'
import type { AstNode, LintRule } from '@/core/lint/types'

function hasDistinct(ast: AstNode): boolean {
  const distinct = ast.distinct
  if (typeof distinct === 'string') return distinct.toUpperCase() === 'DISTINCT'
  if (!distinct || typeof distinct !== 'object') return false
  return String((distinct as AstNode).type).toUpperCase() === 'DISTINCT'
}

function hasGroupBy(ast: AstNode): boolean {
  const groupBy = ast.groupby
  if (Array.isArray(groupBy)) return groupBy.length > 0
  if (!groupBy || typeof groupBy !== 'object') return false
  const columns = (groupBy as AstNode).columns
  return Array.isArray(columns) && columns.length > 0
}

export const distinctGroupbyAbuseRule: LintRule = {
  name: 'distinct-groupby-abuse',
  requiresSchema: false,
  check(ctx) {
    if (ctx.ast.type !== 'select' || !hasDistinct(ctx.ast) || !hasGroupBy(ctx.ast)) {
      return []
    }
    return [
      {
        rule: 'distinct-groupby-abuse',
        severity: 'warn',
        message:
          'DISTINCT combined with GROUP BY is redundant: GROUP BY already produces unique groups. Drop DISTINCT (or drop GROUP BY if no aggregates are used).',
        span: findingSpan(ctx.sql, 'distinct'),
        schemaVerified: false,
      },
    ]
  },
}
