// src/core/result-snapshot/fingerprint.ts
import { createHash } from 'node:crypto'
import type { QueryResult } from '@/types/query'
import type { ColumnFingerprint, ResultSnapshot, SnapshotEngine, AssertCheck } from './types'

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex')
}

function isNumeric(values: unknown[]): values is number[] {
  return values.length > 0 && values.every((v) => typeof v === 'number')
}

function buildColumn(name: string, type: string, values: unknown[]): ColumnFingerprint {
  const nonNull = values.filter((v) => v !== null && v !== undefined)
  const nullCount = values.length - nonNull.length
  const asStrings = nonNull.map((v) => String(v))
  const distinctCount = new Set(asStrings).size
  const checksum = sha256(JSON.stringify([...asStrings].sort()))
  const col: ColumnFingerprint = { name, type, nullCount, distinctCount, checksum }
  if (isNumeric(nonNull)) {
    col.min = Math.min(...nonNull)
    col.max = Math.max(...nonNull)
    col.sum = nonNull.reduce((a, b) => a + b, 0)
  } else if (nonNull.length > 0) {
    const sorted = [...asStrings].sort()
    col.min = sorted[0]
    col.max = sorted[sorted.length - 1]
  }
  return col
}

export interface FingerprintOptions {
  includeRows?: boolean
  redactedColumns?: string[]
  query?: string
  engine?: SnapshotEngine
  createdAt?: string
}

export function buildFingerprint(
  result: QueryResult<Record<string, unknown>>,
  opts: FingerprintOptions
): ResultSnapshot {
  const columns: ColumnFingerprint[] = result.columnNames.map((name, i) =>
    buildColumn(
      name,
      result.columnTypes?.[i] ?? 'unknown',
      result.rows.map((r) => r[name])
    )
  )
  for (const name of opts.redactedColumns ?? []) {
    if (!columns.some((c) => c.name === name)) {
      columns.push({
        name,
        type: 'redacted',
        nullCount: 0,
        distinctCount: 0,
        checksum: '',
        redacted: true,
      })
    }
  }
  const rowStrings = result.rows
    .map((r) => JSON.stringify(result.columnNames.map((n) => r[n])))
    .sort()
  const snap: ResultSnapshot = {
    schemaVersion: 1,
    query: opts.query ?? '',
    engine: opts.engine ?? 'postgresql',
    createdAt: opts.createdAt ?? new Date().toISOString(),
    rowCount: result.rowCount,
    resultChecksum: sha256(JSON.stringify(rowStrings)),
    columns,
  }
  if (opts.includeRows) snap.rows = result.rows
  return snap
}

/**
 * Compare a current snapshot against a baseline.
 * tolerance === 0  -> pass iff resultChecksum identical (exact, order-independent).
 * tolerance > 0    -> pass iff rowCount within tolerance AND every numeric column's
 *                     sum within tolerance (relative); non-numeric columns ignored.
 */
export function compareAgainst(
  current: ResultSnapshot,
  baseline: ResultSnapshot,
  tolerance: number
): AssertCheck[] {
  const checks: AssertCheck[] = []
  if (tolerance === 0) {
    checks.push({
      name: 'resultChecksum',
      expected: baseline.resultChecksum,
      actual: current.resultChecksum,
      pass: current.resultChecksum === baseline.resultChecksum,
    })
    return checks
  }
  const within = (a: number, b: number) =>
    b === 0 ? a === 0 : Math.abs(a - b) / Math.abs(b) <= tolerance
  checks.push({
    name: 'rowCount',
    expected: `${baseline.rowCount} ±${tolerance * 100}%`,
    actual: String(current.rowCount),
    pass: within(current.rowCount, baseline.rowCount),
  })
  for (const base of baseline.columns) {
    if (base.sum === undefined) continue
    const cur = current.columns.find((c) => c.name === base.name)
    const curSum = cur?.sum
    checks.push({
      name: `sum(${base.name})`,
      expected: `${base.sum} ±${tolerance * 100}%`,
      actual: String(curSum),
      pass: curSum !== undefined && within(curSum, base.sum),
    })
  }
  return checks
}
