// src/core/guide/missing-index/sql-extractor.ts
/**
 * Pure AST → TableColumnUsage[] extractor. No IO; feed it a node-sql-parser
 * SELECT AST. Every node read is defensive because node-sql-parser shapes vary
 * across versions/dialects. Anything we don't understand is silently skipped —
 * the analyzer adds parser-limit warnings for known-unsupported constructs.
 */

import type { QueryAnalysis, TableColumnUsage } from './types'

const EQUALITY_OPS = new Set(['=', 'IN', '<=>'])
const RANGE_OPS = new Set(['>', '<', '>=', '<=', 'BETWEEN'])

interface ColumnRef {
  table: string | null
  column: string
}

/** Mutable accumulator keyed by real table name. */
type Acc = Map<string, TableColumnUsage>

export function extract(ast: unknown): QueryAnalysis {
  const node = ast as Record<string, any>
  const acc: Acc = new Map()
  const aliasMap = new Map<string, string>() // alias OR table -> real table
  const tableOrder: string[] = []

  // --- FROM + JOIN ---
  const from = Array.isArray(node.from) ? node.from : []
  for (const entry of from) {
    const table: string | undefined = entry?.table
    if (!table) continue
    const alias: string | undefined = entry?.as ?? undefined
    aliasMap.set(table, table)
    if (alias) aliasMap.set(alias, table)
    if (!acc.has(table)) {
      acc.set(table, blankUsage(table, alias))
      tableOrder.push(table)
    }
    // JOIN ON predicate
    if (entry?.on) walkPredicate(entry.on, acc, aliasMap, tableOrder)
  }

  // --- WHERE / HAVING ---
  if (node.where) walkPredicate(node.where, acc, aliasMap, tableOrder)
  if (node.having) walkPredicate(node.having, acc, aliasMap, tableOrder)

  // --- GROUP BY / ORDER BY ---
  collectOrderGroup(node.groupby, acc, aliasMap, tableOrder)
  collectOrderGroup(node.orderby, acc, aliasMap, tableOrder)

  return {
    tables: tableOrder.map((t) => acc.get(t)!),
    parsed: true,
  }
}

function blankUsage(table: string, alias?: string): TableColumnUsage {
  return {
    table,
    alias,
    equalityColumns: [],
    rangeColumns: [],
    joinColumns: [],
    orderColumns: [],
    functionalColumns: [],
  }
}

/** Resolve which real table a column_ref belongs to. */
function resolveTable(
  ref: ColumnRef,
  aliasMap: Map<string, string>,
  tableOrder: string[]
): string | null {
  if (ref.table) return aliasMap.get(ref.table) ?? ref.table
  // Unqualified column: only safe when exactly one table is in play.
  if (tableOrder.length === 1) return tableOrder[0]
  return null
}

function ensure(acc: Acc, table: string): TableColumnUsage {
  let u = acc.get(table)
  if (!u) {
    u = blankUsage(table)
    acc.set(table, u)
  }
  return u
}

function pushUnique(arr: string[], val: string) {
  if (!arr.includes(val)) arr.push(val)
}

/** Read a node-sql-parser function name across version shapes. */
function funcName(node: any): string {
  const n = node?.name
  if (typeof n === 'string') return n
  // newer shape: { name: [{ value: 'DATE' }] }
  const list = n?.name ?? n
  if (Array.isArray(list)) return list.map((x: any) => x?.value ?? '').join('')
  return ''
}

function asColumnRef(node: any): ColumnRef | null {
  if (node?.type === 'column_ref' && node.column != null) {
    const column = typeof node.column === 'string' ? node.column : node.column?.expr?.value
    if (typeof column === 'string') return { table: node.table ?? null, column }
  }
  return null
}

/** Record a functional-column usage once (DATE(b.settled_at)). */
function recordFunctional(
  acc: Acc,
  aliasMap: Map<string, string>,
  tableOrder: string[],
  ref: ColumnRef,
  expr: string
): void {
  const tbl = resolveTable(ref, aliasMap, tableOrder)
  if (!tbl) return
  const u = ensure(acc, tbl)
  if (!u.functionalColumns.some((f) => f.column === ref.column)) {
    u.functionalColumns.push({ column: ref.column, expr })
  }
}

/**
 * Walk a WHERE/ON predicate tree. Classifies each comparison's column side as
 * equality / range, records functional wrappers, and routes join equality
 * (column = column across tables) into joinColumns.
 */
function walkPredicate(
  node: any,
  acc: Acc,
  aliasMap: Map<string, string>,
  tableOrder: string[]
): void {
  if (!node || typeof node !== 'object') return
  if (node.type !== 'binary_expr') return

  const op: string = String(node.operator ?? '').toUpperCase()

  if (op === 'AND' || op === 'OR') {
    walkPredicate(node.left, acc, aliasMap, tableOrder)
    walkPredicate(node.right, acc, aliasMap, tableOrder)
    return
  }

  const leftCol = asColumnRef(node.left)
  const rightCol = asColumnRef(node.right)

  // column = column → join predicate (both sides indexed)
  if (EQUALITY_OPS.has(op) && leftCol && rightCol) {
    for (const ref of [leftCol, rightCol]) {
      const tbl = resolveTable(ref, aliasMap, tableOrder)
      if (tbl) pushUnique(ensure(acc, tbl).joinColumns, ref.column)
    }
    return
  }

  // functional wrapper on the column side: DATE(b.settled_at) = ?
  if (node.left?.type === 'function') {
    const ref = funcArgColumn(node.left)
    if (ref) recordFunctional(acc, aliasMap, tableOrder, ref, funcName(node.left))
    return
  }

  // plain column compared to a literal/param
  const col = leftCol ?? rightCol
  if (!col) return
  const tbl = resolveTable(col, aliasMap, tableOrder)
  if (!tbl) return
  const u = ensure(acc, tbl)
  if (EQUALITY_OPS.has(op)) pushUnique(u.equalityColumns, col.column)
  else if (RANGE_OPS.has(op)) pushUnique(u.rangeColumns, col.column)
}

/** Pull the column_ref out of a function's first argument (DATE(b.settled_at)). */
function funcArgColumn(fnNode: any): ColumnRef | null {
  const args = fnNode?.args
  const list = args?.value ?? args?.expr ?? []
  const arr = Array.isArray(list) ? list : [list]
  for (const a of arr) {
    const ref = asColumnRef(a)
    if (ref) return ref
  }
  return null
}

function collectOrderGroup(
  clause: any,
  acc: Acc,
  aliasMap: Map<string, string>,
  tableOrder: string[]
): void {
  if (!clause) return
  // node-sql-parser v5: GROUP BY is { columns: [...], modifiers: [...] } while
  // ORDER BY is an array of { expr, type }. Normalize both to a flat item list.
  const items = Array.isArray(clause)
    ? clause
    : Array.isArray(clause.columns)
      ? clause.columns
      : [clause]
  for (const item of items) {
    // ORDER BY items are { expr, type }; GROUP BY items are bare exprs.
    const expr = item?.expr ?? item
    if (expr?.type === 'function') {
      const ref = funcArgColumn(expr)
      if (ref) recordFunctional(acc, aliasMap, tableOrder, ref, funcName(expr))
      continue
    }
    const ref = asColumnRef(expr)
    if (!ref) continue
    const tbl = resolveTable(ref, aliasMap, tableOrder)
    if (tbl) pushUnique(ensure(acc, tbl).orderColumns, ref.column)
  }
}
