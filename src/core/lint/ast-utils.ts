import type { AstNode, SchemaContext } from '@/core/lint/types'

/** Depth-first walk over expression-ish nodes (left/right/args/value/expr arrays). */
export function walkExpr(node: unknown, visit: (n: AstNode) => void): void {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) {
    for (const item of node) walkExpr(item, visit)
    return
  }
  const n = node as AstNode
  visit(n)
  for (const key of ['left', 'right', 'args', 'value', 'expr', 'columns', 'where', 'ast']) {
    if (key in n) walkExpr(n[key], visit)
  }
}

export function whereOf(ast: AstNode): AstNode | null {
  const where = ast.where
  return where && typeof where === 'object' ? (where as AstNode) : null
}

export function collectTables(ast: AstNode): string[] {
  const from = ast.from
  if (!Array.isArray(from)) return []
  const tables: string[] = []
  for (const f of from) {
    const table = (f as AstNode).table
    if (typeof table === 'string') tables.push(table)
  }
  return tables
}

export function columnRefParts(
  node: AstNode
): { column: string; qualifier?: string } | null {
  if (node.type !== 'column_ref') return null

  let column: string | null = null
  if (typeof node.column === 'string') {
    column = node.column
  } else if (node.column && typeof node.column === 'object') {
    const expression = (node.column as AstNode).expr
    if (expression && typeof expression === 'object') {
      const value = (expression as AstNode).value
      if (typeof value === 'string') column = value
    }
  }
  if (!column) return null

  const qualifier =
    typeof node.table === 'string' && node.table.length > 0
      ? node.table
      : undefined
  return qualifier ? { column, qualifier } : { column }
}

export function resolveColumnRef(
  schema: SchemaContext,
  ast: AstNode,
  node: AstNode
): ReturnType<SchemaContext['resolveColumn']> {
  const reference = columnRefParts(node)
  if (!reference) return undefined

  const tables = collectTables(ast)
  const from = Array.isArray(ast.from) ? ast.from : []
  const bindings = tables.map((table, index) => {
    const source = from[index] as AstNode | undefined
    const alias =
      typeof source?.as === 'string' && source.as.length > 0
        ? source.as
        : undefined
    return { table, alias }
  })

  const candidates = reference.qualifier
    ? bindings.filter(({ table, alias }) => {
        const qualifier = reference.qualifier?.toLowerCase()
        return alias
          ? alias.toLowerCase() === qualifier
          : table.toLowerCase() === qualifier
      })
    : bindings

  const resolved = candidates.flatMap(({ table }) => {
    const match = schema.resolveColumn([table], reference.column)
    return match ? [match] : []
  })
  return resolved.length === 1 ? resolved[0] : undefined
}

/** Best-effort span: case-insensitive substring match, else the whole statement. */
export function findingSpan(
  sql: string,
  fragment: string,
  fromIndex = 0
): { start: number; end: number } {
  const idx = sql
    .toLowerCase()
    .indexOf(fragment.toLowerCase(), Math.max(0, fromIndex))
  if (idx === -1) return { start: 0, end: sql.length }
  return { start: idx, end: idx + fragment.length }
}
