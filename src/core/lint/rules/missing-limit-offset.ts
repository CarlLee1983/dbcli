import { findingSpan } from '@/core/lint/ast-utils'
import type { AstNode, LintRule } from '@/core/lint/types'

const DEEP_OFFSET = 1000

export const missingLimitOffsetRule: LintRule = {
  name: 'missing-limit-offset',
  requiresSchema: false,
  check(ctx) {
    if (ctx.ast.type !== 'select') return []

    const limit = ctx.ast.limit as AstNode | undefined
    const values = Array.isArray(limit?.value) ? (limit.value as AstNode[]) : []
    if (values.length < 2) return []

    const offsetNode = limit?.seperator === ',' ? values[0] : values[1]
    const offset = typeof offsetNode?.value === 'number' ? offsetNode.value : 0
    if (offset < DEEP_OFFSET) return []

    return [
      {
        rule: 'missing-limit-offset',
        severity: 'info',
        message: `OFFSET ${offset} scans and discards ${offset} rows on every page. For deep pagination use keyset pagination: WHERE (sort_key) > (last seen value) ORDER BY sort_key LIMIT n.`,
        span: findingSpan(ctx.sql, String(offset)),
        schemaVerified: false,
      },
    ]
  },
}
