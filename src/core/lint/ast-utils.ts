import type { AstNode } from './types'

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

/** Best-effort span: case-insensitive substring match, else the whole statement. */
export function findingSpan(sql: string, fragment: string): { start: number; end: number } {
  const idx = sql.toLowerCase().indexOf(fragment.toLowerCase())
  if (idx === -1) return { start: 0, end: sql.length }
  return { start: idx, end: idx + fragment.length }
}
