import { createHash } from 'node:crypto'
import { shellQuote } from '@/core/recovery/shell-quote'

export const BACKFILL_ARTIFACT_SCHEMA_VERSION = 1 as const
const MAX_SOURCE_ROWS = 1_000
const SQL_TARGET_SYSTEMS = new Set(['postgresql', 'mysql', 'mariadb'])

export interface BackfillSourceManifest {
  table: string
  keyColumns: string[]
  rows: Array<Record<string, unknown>>
  verifyQuery: string
  expect: string
  rollbackHint?: string
}

export interface BackfillConnectionIdentity {
  name: string
  environment: string | null
  permission: string
  system: string
  server: { host: string | null; port: number | null }
  database: string | null
}

export interface BackfillArtifact {
  schemaVersion: typeof BACKFILL_ARTIFACT_SCHEMA_VERSION
  kind: 'source-to-sql-backfill'
  createdAt: string
  source: { path: string; sha256: string; rowCount: number }
  table: string
  sourceIdentity: BackfillConnectionIdentity
  targetIdentity: BackfillConnectionIdentity
  identityDiff: string[]
  statements: Array<{ sql: string; planCommand: string }>
  preflight: string[]
  readBack: { query: string; expect: string; command: string }
  rollbackHint: string
  execution: {
    mode: 'dry-run'
    requiresHumanConfirmation: true
    note: string
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requireIdentifier(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z_][A-Za-z0-9_$.]*$/.test(value)) {
    throw new Error(
      `${label} must be a SQL identifier containing only letters, numbers, _, $, or .`
    )
  }
  return value
}

function sqlLiteral(value: unknown): string {
  if (value === null) return 'NULL'
  if (typeof value === 'string') return `'${value.replaceAll("'", "''")}'`
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Source rows cannot contain non-finite numbers')
    return String(value)
  }
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
  throw new Error('Source row values must be strings, finite numbers, booleans, or null')
}

function stripSqlCommentsAndStrings(sql: string): string {
  let result = ''
  let index = 0
  while (index < sql.length) {
    const current = sql[index]
    const next = sql[index + 1]
    if (current === '-' && next === '-') {
      index += 2
      while (index < sql.length && sql[index] !== '\n') index += 1
      result += '\n'
      continue
    }
    if (current === '/' && next === '*') {
      index += 2
      while (index < sql.length && !(sql[index] === '*' && sql[index + 1] === '/')) index += 1
      index += 2
      result += ' '
      continue
    }
    if (current === "'") {
      index += 1
      while (index < sql.length) {
        if (sql[index] === "'" && sql[index + 1] === "'") {
          index += 2
          continue
        }
        if (sql[index] === "'") {
          index += 1
          break
        }
        index += 1
      }
      result += ' '
      continue
    }
    result += current
    index += 1
  }
  return result
}

function assertReadOnlyVerifyQuery(query: string): string {
  const normalized = stripSqlCommentsAndStrings(query).trim()
  if (!/^SELECT\b/i.test(normalized) || /;/.test(normalized)) {
    throw new Error('verifyQuery must be a single plain read-only SELECT statement')
  }
  if (
    /\b(?:INSERT|UPDATE|DELETE|MERGE|UPSERT|REPLACE|TRUNCATE|DROP|ALTER|CREATE|GRANT|REVOKE|RENAME|INTO|LOCK|CALL|DO|FOR\s+(?:UPDATE|SHARE|NO\s+KEY\s+UPDATE|KEY\s+SHARE))\b/i.test(
      normalized
    )
  ) {
    throw new Error('verifyQuery must not contain a write or DDL statement')
  }
  return query.trim()
}

/** Parse the intentionally small, reviewable JSON source-catalog format. */
export function parseBackfillSourceManifest(raw: unknown): BackfillSourceManifest {
  if (!isRecord(raw)) throw new Error('Source manifest must be a JSON object')
  const table = requireIdentifier(raw.table, 'table')
  if (!Array.isArray(raw.keyColumns) || raw.keyColumns.length === 0) {
    throw new Error('keyColumns must be a non-empty array')
  }
  const keyColumns = raw.keyColumns.map((column) => requireIdentifier(column, 'keyColumns entry'))
  if (new Set(keyColumns).size !== keyColumns.length) {
    throw new Error('keyColumns must not contain duplicates')
  }
  if (!Array.isArray(raw.rows) || raw.rows.length === 0) {
    throw new Error('rows must be a non-empty array')
  }
  if (raw.rows.length > MAX_SOURCE_ROWS) {
    throw new Error(`rows exceeds the bounded maximum of ${MAX_SOURCE_ROWS}`)
  }
  const rows = raw.rows.map((row, index) => {
    if (!isRecord(row)) throw new Error(`rows[${index}] must be an object`)
    for (const key of keyColumns) {
      if (!(key in row)) throw new Error(`rows[${index}] is missing key column '${key}'`)
    }
    return row
  })
  if (typeof raw.verifyQuery !== 'string' || raw.verifyQuery.trim() === '') {
    throw new Error('verifyQuery must be a non-empty string')
  }
  if (typeof raw.expect !== 'string' || raw.expect.trim() === '') {
    throw new Error('expect must be a non-empty string')
  }
  if (raw.rollbackHint !== undefined && typeof raw.rollbackHint !== 'string') {
    throw new Error('rollbackHint must be a string when provided')
  }
  return {
    table,
    keyColumns,
    rows,
    verifyQuery: assertReadOnlyVerifyQuery(raw.verifyQuery),
    expect: raw.expect.trim(),
    rollbackHint: raw.rollbackHint,
  }
}

export function generateBackfillSql(manifest: BackfillSourceManifest): string[] {
  return manifest.rows.map((row, index) => {
    const setColumns = Object.keys(row).filter((column) => !manifest.keyColumns.includes(column))
    if (setColumns.length === 0) throw new Error(`rows[${index}] has no non-key columns to update`)
    const set = setColumns
      .map(
        (column) =>
          `${requireIdentifier(column, `rows[${index}] column`)} = ${sqlLiteral(row[column])}`
      )
      .join(', ')
    const where = manifest.keyColumns
      .map((column) => {
        const value = row[column]
        return value === null ? `${column} IS NULL` : `${column} = ${sqlLiteral(value)}`
      })
      .join(' AND ')
    return `UPDATE ${manifest.table} SET ${set} WHERE ${where}`
  })
}

export function compareBackfillIdentities(
  source: BackfillConnectionIdentity,
  target: BackfillConnectionIdentity
): string[] {
  const differences: string[] = []
  for (const field of ['environment', 'system', 'database'] as const) {
    if (source[field] !== target[field])
      differences.push(`${field}: ${String(source[field])} -> ${String(target[field])}`)
  }
  if (source.server.host !== target.server.host || source.server.port !== target.server.port) {
    differences.push(
      `server: ${source.server.host ?? 'unknown'}:${source.server.port ?? 'unknown'} -> ${target.server.host ?? 'unknown'}:${target.server.port ?? 'unknown'}`
    )
  }
  return differences
}

export function buildBackfillArtifact(input: {
  manifest: BackfillSourceManifest
  sourcePath: string
  sourceContent: string
  sourceIdentity: BackfillConnectionIdentity
  targetIdentity: BackfillConnectionIdentity
  now?: Date
}): BackfillArtifact {
  if (!SQL_TARGET_SYSTEMS.has(input.targetIdentity.system)) {
    throw new Error(
      `Source-to-SQL backfill artifacts require a SQL target connection; '${input.targetIdentity.system}' is not supported`
    )
  }
  const statements = generateBackfillSql(input.manifest)
  const target = input.targetIdentity.name
  const targetArg = shellQuote(target)
  const tableArg = shellQuote(input.manifest.table)
  const planCommand = (sql: string) => `dbcli --use ${targetArg} plan ${shellQuote(sql)} --format json`
  const lastStatement = statements[statements.length - 1]!
  return {
    schemaVersion: BACKFILL_ARTIFACT_SCHEMA_VERSION,
    kind: 'source-to-sql-backfill',
    createdAt: (input.now ?? new Date()).toISOString(),
    source: {
      path: input.sourcePath,
      sha256: createHash('sha256').update(input.sourceContent).digest('hex'),
      rowCount: input.manifest.rows.length,
    },
    table: input.manifest.table,
    sourceIdentity: input.sourceIdentity,
    targetIdentity: input.targetIdentity,
    identityDiff: compareBackfillIdentities(input.sourceIdentity, input.targetIdentity),
    statements: statements.map((sql) => ({ sql, planCommand: planCommand(sql) })),
    preflight: [
      `dbcli --use ${targetArg} blacklist list --format json`,
      `dbcli --use ${targetArg} schema ${tableArg} --format json`,
      ...statements.map(planCommand),
    ],
    readBack: {
      query: input.manifest.verifyQuery,
      expect: input.manifest.expect,
      command:
        `dbcli --use ${targetArg} verify safe-backfill --table ${tableArg} ` +
        `--query ${shellQuote(lastStatement)} --verify-query ${shellQuote(input.manifest.verifyQuery)} ` +
        `--expect ${shellQuote(input.manifest.expect)} --after-write --format json`,
    },
    rollbackHint:
      input.manifest.rollbackHint ??
      'Capture the prior values before applying this artifact; rollback is a separately reviewed UPDATE with its own verify rollback preflight.',
    execution: {
      mode: 'dry-run',
      requiresHumanConfirmation: true,
      note: 'This artifact never executes database writes. Review each plan and apply SQL only through an explicitly human-confirmed workflow.',
    },
  }
}
