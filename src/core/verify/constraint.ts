import { VerifyInputError, requireNonEmpty, normalizeFormat } from './scenario'

export type ConstraintCheck = 'fk' | 'not-null' | 'unique' | 'custom'
export const ALLOWED_CONSTRAINT_CHECKS = ['fk', 'not-null', 'unique', 'custom'] as const

export interface ConstraintInput {
  table: string
  check: ConstraintCheck
  columns: string[]
  references?: { table: string; column: string }
  violationQuery?: string
  allowPreexisting: boolean
  baseline: number
  afterWrite: boolean
  format: 'table' | 'json'
  subjectName?: string
  summary?: string
}

export function normalizeConstraintCheck(raw: unknown): ConstraintCheck {
  const check = (raw as string | undefined) ?? ''
  if (!(ALLOWED_CONSTRAINT_CHECKS as readonly string[]).includes(check)) {
    throw new VerifyInputError(
      `Invalid --check '${check}'. Allowed: ${ALLOWED_CONSTRAINT_CHECKS.join(', ')}`
    )
  }
  return check as ConstraintCheck
}

function toColumns(raw: unknown): string[] {
  if (raw === undefined || raw === null) return []
  const arr = Array.isArray(raw) ? raw : [raw]
  return arr.map((c) => requireNonEmpty(c, '--column'))
}

function parseReferences(raw: unknown): { table: string; column: string } {
  const ref = requireNonEmpty(raw, '--references')
  const parts = ref.split('.').map((p) => p.trim())
  if (parts.length < 2 || parts.some((p) => p.length === 0)) {
    throw new VerifyInputError(`--references must be '<table>.<column>' (got '${ref}')`)
  }
  const column = parts.pop() as string
  const table = parts.join('.')
  return { table, column }
}

function parseBaseline(raw: unknown): number {
  if (raw === undefined || raw === null || raw === '') return 0
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 0) {
    throw new VerifyInputError(`--baseline must be a non-negative integer (got '${String(raw)}')`)
  }
  return n
}

export function normalizeConstraintInput(raw: Record<string, unknown>): ConstraintInput {
  const check = normalizeConstraintCheck(raw.check)
  const table = requireNonEmpty(raw.table, '--table')
  const format = normalizeFormat(raw.format)
  const columns = toColumns(raw.column)
  const violationQueryRaw = raw.violationQuery as string | undefined
  const hasViolationQuery =
    typeof violationQueryRaw === 'string' && violationQueryRaw.trim().length > 0

  let references: { table: string; column: string } | undefined
  if (check === 'fk') {
    if (columns.length !== 1) {
      throw new VerifyInputError('--check fk requires exactly one --column (the child FK column).')
    }
    references = parseReferences(raw.references)
    if (hasViolationQuery) {
      throw new VerifyInputError('--violation-query is only valid with --check custom.')
    }
  } else if (check === 'not-null' || check === 'unique') {
    if (columns.length < 1) {
      throw new VerifyInputError(`--check ${check} requires at least one --column.`)
    }
    if (raw.references !== undefined) {
      throw new VerifyInputError('--references is only valid with --check fk.')
    }
    if (hasViolationQuery) {
      throw new VerifyInputError('--violation-query is only valid with --check custom.')
    }
  } else {
    // custom
    if (!hasViolationQuery) {
      throw new VerifyInputError('--check custom requires --violation-query.')
    }
    if (columns.length > 0) {
      throw new VerifyInputError('--column is not valid with --check custom.')
    }
    if (raw.references !== undefined) {
      throw new VerifyInputError('--references is only valid with --check fk.')
    }
  }

  const subjectNameRaw = raw.subjectName as string | undefined
  const summaryRaw = raw.summary as string | undefined

  return {
    table,
    check,
    columns,
    ...(references ? { references } : {}),
    ...(check === 'custom' ? { violationQuery: (violationQueryRaw as string).trim() } : {}),
    allowPreexisting: raw.allowPreexisting === true,
    baseline: parseBaseline(raw.baseline),
    afterWrite: raw.afterWrite === true,
    format,
    ...(subjectNameRaw && subjectNameRaw.trim().length > 0
      ? { subjectName: subjectNameRaw.trim() }
      : {}),
    ...(summaryRaw && summaryRaw.trim().length > 0 ? { summary: summaryRaw.trim() } : {}),
  }
}
