import { findingSpan, walkExpr, whereOf } from '@/core/lint/ast-utils'
import type { AstNode, LintFinding, LintRule } from '@/core/lint/types'

const COMPARISONS = new Set(['=', '!=', '<>', '>', '>=', '<', '<=', 'LIKE', 'IN'])

function containsColumnRef(node: unknown): boolean {
  let found = false
  walkExpr(node, (candidate) => {
    if (candidate.type === 'column_ref') found = true
  })
  return found
}

function functionName(node: AstNode): string {
  const name = node.name as AstNode | undefined
  const parts = name?.name
  if (!Array.isArray(parts)) return 'FUNCTION'
  const first = parts[0] as AstNode | undefined
  return String(first?.value ?? 'FUNCTION').toUpperCase()
}

function computationOverColumn(node: AstNode | undefined): string | null {
  if (!node) return null
  if (node.type === 'function' && containsColumnRef(node.args)) {
    return functionName(node)
  }
  if (
    node.type === 'binary_expr' &&
    ['+', '-', '*', '/'].includes(String(node.operator)) &&
    containsColumnRef(node)
  ) {
    return `arithmetic (${String(node.operator)})`
  }
  return null
}

export const nonSargableWhereRule: LintRule = {
  name: 'non-sargable-where',
  requiresSchema: false,
  check(ctx) {
    const where = whereOf(ctx.ast)
    if (!where) return []

    const findings: LintFinding[] = []
    walkExpr(where, (node) => {
      if (node.type !== 'binary_expr') return
      const operator = String(node.operator).toUpperCase()
      if (!COMPARISONS.has(operator)) return

      const computation = computationOverColumn(node.left as AstNode | undefined)
      if (!computation) return
      findings.push({
        rule: 'non-sargable-where',
        severity: 'warn',
        message: `${computation} applied to a column on the left of '${operator}' may prevent use of a conventional index (non-sargable). An expression index or generated-column index may still support this predicate; otherwise move the computation to the literal side or restate the predicate.`,
        span: findingSpan(ctx.sql, 'where'),
        schemaVerified: false,
      })
    })
    return findings
  },
}
