import { collectTables, findingSpan } from '@/core/lint/ast-utils'
import { verifyWith } from '@/core/lint/types'
import type { AstNode, LintFinding, LintRule } from '@/core/lint/types'

function isStar(ast: AstNode): boolean {
  const columns = ast.columns
  if (columns === '*') return true
  if (!Array.isArray(columns)) return false

  return columns.some((column) => {
    const expr = (column as AstNode).expr as AstNode | undefined
    return expr?.type === 'column_ref' && expr.column === '*'
  })
}

export const selectStarRule: LintRule = {
  name: 'select-star',
  requiresSchema: false,
  check(ctx) {
    if (ctx.ast.type !== 'select' || !isStar(ctx.ast)) return []

    const finding: LintFinding = {
      rule: 'select-star',
      severity: 'warn',
      message:
        'SELECT * fetches every column: more I/O, breaks covering indexes, and couples code to schema order. List the columns you need.',
      span: findingSpan(ctx.sql, 'select *'),
      schemaVerified: false,
    }
    const tables = collectTables(ctx.ast)

    if (ctx.schema.available && tables.length === 1) {
      const table = ctx.schema.getTable(tables[0]!)
      if (table && table.columns.length > 0) {
        const columns = table.columns.map((column) => column.name).join(', ')
        const rewritten = ctx.sql.replace(/\*/, columns)
        finding.rewrite = { sql: rewritten, confidence: 'high' }
        finding.verifyCommand = verifyWith(rewritten)
        finding.schemaVerified = true
      }
    }

    return [finding]
  },
}
