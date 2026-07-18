import { collectTables, findingSpan } from '@/core/lint/ast-utils'
import { parseSingleStatement } from '@/core/lint/parse'
import { verifyWith } from '@/core/lint/types'
import type { SqlDatabaseSystem } from '@/adapters/types'
import type { AstNode, LintFinding, LintRule } from '@/core/lint/types'

const PROJECTION_MARKER = '__dbcli_lint_projection_wildcard__'

function columnRefName(expr: AstNode): string | undefined {
  if (typeof expr.column === 'string') return expr.column
  if (!expr.column || typeof expr.column !== 'object') return undefined

  const columnExpr = (expr.column as AstNode).expr
  if (!columnExpr || typeof columnExpr !== 'object') return undefined
  const value = (columnExpr as AstNode).value
  return typeof value === 'string' ? value : undefined
}

function columnExpr(column: unknown): AstNode | undefined {
  if (!column || typeof column !== 'object') return undefined
  const expr = (column as AstNode).expr
  return expr && typeof expr === 'object' ? (expr as AstNode) : undefined
}

function isStar(ast: AstNode): boolean {
  const columns = ast.columns
  if (columns === '*') return true
  if (!Array.isArray(columns)) return false

  return columns.some((column) => {
    const expr = columnExpr(column)
    return expr?.type === 'column_ref' && expr.column === '*'
  })
}

function isSoleUnqualifiedStar(ast: AstNode): boolean {
  if (!Array.isArray(ast.columns) || ast.columns.length !== 1) return false
  const expr = columnExpr(ast.columns[0])
  return (
    expr?.type === 'column_ref' &&
    expr.column === '*' &&
    (expr.table === null || expr.table === undefined)
  )
}

function isSoleProjectionMarker(ast: AstNode): boolean {
  if (ast.type !== 'select' || !Array.isArray(ast.columns) || ast.columns.length !== 1) {
    return false
  }
  const column = ast.columns[0] as AstNode
  const expr = columnExpr(column)
  return (
    (column.as === null || column.as === undefined) &&
    expr?.type === 'column_ref' &&
    (expr.table === null || expr.table === undefined) &&
    columnRefName(expr) === PROJECTION_MARKER
  )
}

function projectionWildcardIndex(
  sql: string,
  system: SqlDatabaseSystem
): number | undefined {
  const matches: number[] = []
  for (let index = sql.indexOf('*'); index !== -1; index = sql.indexOf('*', index + 1)) {
    const candidate = `${sql.slice(0, index)}${PROJECTION_MARKER}${sql.slice(index + 1)}`
    try {
      if (isSoleProjectionMarker(parseSingleStatement(candidate, system))) {
        matches.push(index)
      }
    } catch {
      // Replacing stars in comments, strings, or operators may make invalid SQL.
    }
  }
  return matches.length === 1 ? matches[0] : undefined
}

function canUseBareIdentifier(name: string, system: SqlDatabaseSystem): boolean {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) return false
  try {
    const ast = parseSingleStatement(
      `SELECT ${name} FROM __dbcli_lint_identifier_probe`,
      system
    )
    if (!Array.isArray(ast.columns) || ast.columns.length !== 1) return false
    const column = ast.columns[0] as AstNode
    const expr = columnExpr(column)
    return (
      (column.as === null || column.as === undefined) &&
      expr?.type === 'column_ref' &&
      (expr.table === null || expr.table === undefined) &&
      columnRefName(expr) === name
    )
  } catch {
    return false
  }
}

function renderIdentifier(name: string, system: SqlDatabaseSystem): string {
  if (canUseBareIdentifier(name, system)) return name
  const quote = system === 'postgresql' ? '"' : '`'
  return `${quote}${name.replaceAll(quote, quote + quote)}${quote}`
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

    if (
      ctx.schema.available &&
      tables.length === 1 &&
      isSoleUnqualifiedStar(ctx.ast)
    ) {
      const table = ctx.schema.getTable(tables[0]!)
      if (table && table.columns.length > 0) {
        const wildcardIndex = projectionWildcardIndex(ctx.sql, ctx.system)
        if (wildcardIndex !== undefined) {
          const columns = table.columns
            .map((column) => renderIdentifier(column.name, ctx.system))
            .join(', ')
          const rewritten = `${ctx.sql.slice(0, wildcardIndex)}${columns}${ctx.sql.slice(
            wildcardIndex + 1
          )}`
          try {
            parseSingleStatement(rewritten, ctx.system)
            finding.rewrite = { sql: rewritten, confidence: 'high' }
            finding.verifyCommand = verifyWith(rewritten)
            finding.schemaVerified = true
          } catch {
            // Invalid drafts are withheld rather than reported as high-confidence rewrites.
          }
        }
      }
    }

    return [finding]
  },
}
