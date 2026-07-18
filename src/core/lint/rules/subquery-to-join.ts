import { findingSpan, walkExpr, whereOf } from '@/core/lint/ast-utils'
import type { LintFinding, LintRule } from '@/core/lint/types'

function isSubquery(node: unknown): boolean {
  let found = false
  walkExpr(node, (candidate) => {
    if (candidate.type === 'select') found = true
  })
  return found
}

export const subqueryToJoinRule: LintRule = {
  name: 'subquery-to-join',
  requiresSchema: false,
  check(ctx) {
    const where = whereOf(ctx.ast)
    if (!where) return []

    const findings: LintFinding[] = []
    walkExpr(where, (node) => {
      if (
        node.type !== 'binary_expr' ||
        String(node.operator).toUpperCase() !== 'IN' ||
        !isSubquery(node.right)
      ) {
        return
      }
      findings.push({
        rule: 'subquery-to-join',
        severity: 'info',
        message:
          'IN (SELECT …) may be executed as a dependent subquery on some planners. Consider an equivalent JOIN or EXISTS and compare plans with explain.',
        span: findingSpan(ctx.sql, 'in ('),
        schemaVerified: false,
      })
    })
    return findings
  },
}
