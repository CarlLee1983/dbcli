import { findingSpan, walkExpr, whereOf } from '@/core/lint/ast-utils'
import type { AstNode, LintFinding, LintRule } from '@/core/lint/types'

export const unanchoredLikeRule: LintRule = {
  name: 'unanchored-like',
  requiresSchema: false,
  check(ctx) {
    const where = whereOf(ctx.ast)
    if (!where) return []

    const findings: LintFinding[] = []
    walkExpr(where, (node) => {
      const operator = typeof node.operator === 'string' ? node.operator.toUpperCase() : ''
      if (operator !== 'LIKE' && operator !== 'ILIKE') return

      const right = node.right as AstNode | undefined
      const pattern = right?.value
      if (typeof pattern !== 'string' || !pattern.startsWith('%')) return

      findings.push({
        rule: 'unanchored-like',
        severity: 'warn',
        message: `LIKE '${pattern}' starts with a wildcard, so no B-tree index can be used (full scan). Anchor the prefix, or use a trigram/full-text index.`,
        span: findingSpan(ctx.sql, pattern),
        schemaVerified: false,
      })
    })

    return findings
  },
}
