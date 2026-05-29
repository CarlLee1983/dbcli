// src/core/assert/evaluator.ts
import type { QueryResult } from '@/types/query'
import type { AssertCheck } from '@/core/result-snapshot/types'
import type { ExpectNode, Op } from './grammar'

export class AssertShapeError extends Error {
  code = 'ASSERT_SHAPE_MISMATCH'
  constructor(message: string) {
    super(message)
    this.name = 'AssertShapeError'
  }
}

function compare(a: number | string, op: Op, b: number | string): boolean {
  switch (op) {
    case '>': return a > b
    case '>=': return a >= b
    case '<': return a < b
    case '<=': return a <= b
    case '==': return a === b
    case '!=': return a !== b
  }
}

export function firstScalar(result: QueryResult<Record<string, unknown>>): number | string | null {
  if (result.columnNames.length !== 1) {
    throw new AssertShapeError(
      `value assertion needs a single-column result, got ${result.columnNames.length} columns. Project to one column.`
    )
  }
  if (result.rows.length === 0) return null
  const v = result.rows[0]![result.columnNames[0]!]
  return v === null || v === undefined ? null : (v as number | string)
}

export function evaluateExpect(node: ExpectNode, result: QueryResult<Record<string, unknown>>): AssertCheck {
  if (node.kind === 'rows') {
    const actual = result.rowCount
    return { name: 'rows', expected: `rows ${node.op} ${node.value}`, actual: String(actual), pass: compare(actual, node.op, node.value) }
  }
  if (node.kind === 'value') {
    const actual = firstScalar(result)
    return {
      name: 'value',
      expected: `value ${node.op} ${node.value}`,
      actual: String(actual),
      pass: actual !== null && compare(actual, node.op, node.value),
    }
  }
  // node.kind === 'col'
  const { column, pred } = node
  const values = result.rows.map((r) => r[column])
  const nonNull = values.filter((v) => v !== null && v !== undefined)
  if (pred.type === 'notNull') {
    const nullCount = values.length - nonNull.length
    return { name: `col:${column} not null`, expected: '0 nulls', actual: `${nullCount} nulls`, pass: nullCount === 0 }
  }
  if (pred.type === 'unique') {
    const distinct = new Set(nonNull.map((v) => String(v))).size
    return { name: `col:${column} unique`, expected: `${nonNull.length} distinct`, actual: `${distinct} distinct`, pass: distinct === nonNull.length }
  }
  if (pred.type === 'between') {
    const bad = nonNull.filter((v) => typeof v !== 'number' || v < pred.low || v > pred.high)
    return { name: `col:${column} between ${pred.low} and ${pred.high}`, expected: '0 out of range', actual: `${bad.length} out of range`, pass: bad.length === 0 }
  }
  // pred.type === 'cmp'
  const bad = nonNull.filter((v) => !compare(v as number | string, pred.op, pred.value))
  return { name: `col:${column} ${pred.op} ${pred.value}`, expected: '0 violations', actual: `${bad.length} violations`, pass: bad.length === 0 }
}

export function compareVs(
  a: QueryResult<Record<string, unknown>>,
  b: QueryResult<Record<string, unknown>>,
  mode: 'rows' | 'value'
): AssertCheck {
  if (mode === 'rows') {
    return { name: 'vs:rows', expected: String(b.rowCount), actual: String(a.rowCount), pass: a.rowCount === b.rowCount }
  }
  const av = firstScalar(a)
  const bv = firstScalar(b)
  return { name: 'vs:value', expected: String(bv), actual: String(av), pass: av !== null && bv !== null && av === bv }
}
