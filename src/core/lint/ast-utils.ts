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

/** Walk expressions within one statement without descending into nested `.ast` statements. */
export function walkExprInStatement(
  node: unknown,
  visit: (n: AstNode) => void
): void {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) {
    for (const item of node) walkExprInStatement(item, visit)
    return
  }
  const n = node as AstNode
  visit(n)
  for (const key of [
    'left',
    'right',
    'args',
    'value',
    'expr',
    'columns',
    'where',
  ]) {
    if (key in n) walkExprInStatement(n[key], visit)
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

  const tables = new Set(collectTables(ast).map((table) => table.toLowerCase()))
  const from = Array.isArray(ast.from) ? ast.from : []
  const bindings = from.flatMap((item) => {
    const source = item as AstNode
    const table = source.table
    if (typeof table !== 'string' || !tables.has(table.toLowerCase())) return []
    const alias =
      typeof source?.as === 'string' && source.as.length > 0
        ? source.as
        : undefined
    return [{ table, alias }]
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

export function sqlCodeMask(sql: string): boolean[] {
  const mask = Array.from({ length: sql.length }, () => true)
  let index = 0

  while (index < sql.length) {
    const char = sql[index]
    const next = sql[index + 1]

    if (char === '-' && next === '-') {
      while (index < sql.length && sql[index] !== '\n') {
        mask[index] = false
        index += 1
      }
      continue
    }

    if (char === '/' && next === '*') {
      mask[index] = false
      mask[index + 1] = false
      index += 2
      while (
        index < sql.length &&
        !(sql[index] === '*' && sql[index + 1] === '/')
      ) {
        mask[index] = false
        index += 1
      }
      if (index < sql.length) {
        mask[index] = false
        mask[index + 1] = false
        index += 2
      }
      continue
    }

    if (char === "'" || char === '"' || char === '`') {
      const quote = char
      index += 1
      while (index < sql.length) {
        if (sql[index] === quote && sql[index + 1] === quote) {
          mask[index] = false
          mask[index + 1] = false
          index += 2
          continue
        }
        if (sql[index] === quote) {
          index += 1
          break
        }
        mask[index] = false
        index += 1
      }
      continue
    }

    if (char === '$') {
      const delimiter = sql.slice(index).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/)?.[0]
      if (delimiter) {
        const end = sql.indexOf(delimiter, index + delimiter.length)
        const stop = end === -1 ? sql.length : end + delimiter.length
        while (index < stop) {
          mask[index] = false
          index += 1
        }
        continue
      }
    }

    index += 1
  }

  return mask
}

export function lexicalFindingSpan(
  sql: string,
  fragment: string,
  fromIndex = 0
): { start: number; end: number } {
  const source = fragment
    .trim()
    .split(/\s+/)
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('\\s+')
  const pattern = new RegExp(
    `(?<![A-Za-z0-9_$])${source}(?![A-Za-z0-9_$])`,
    'gi'
  )
  const mask = sqlCodeMask(sql)

  for (const match of sql.matchAll(pattern)) {
    if (match.index < fromIndex || !mask[match.index]) continue
    return { start: match.index, end: match.index + match[0].length }
  }

  return { start: 0, end: sql.length }
}
