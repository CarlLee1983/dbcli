import { Parser } from 'node-sql-parser'
import type { SqlDatabaseSystem } from '@/adapters/types'

const parser = new Parser()

const DIALECT: Record<SqlDatabaseSystem, string> = {
  postgresql: 'Postgresql',
  mysql: 'MySQL',
  mariadb: 'MariaDB',
}

const WRITE_STATEMENT_TYPES = new Set([
  'insert',
  'update',
  'delete',
  'replace',
  'merge',
  'create',
  'alter',
  'drop',
  'truncate',
  'rename',
  'grant',
  'revoke',
])

function containsWriteCapableNode(node: unknown): boolean {
  if (!node || typeof node !== 'object') return false
  if (Array.isArray(node)) return node.some(containsWriteCapableNode)

  const record = node as Record<string, unknown>
  const type = typeof record.type === 'string' ? record.type.toLowerCase() : ''
  if (WRITE_STATEMENT_TYPES.has(type)) return true

  if (type === 'select') {
    const into = record.into
    if (into && typeof into === 'object') {
      const intoRecord = into as Record<string, unknown>
      if (intoRecord.position != null || intoRecord.expr != null) return true
    }
    if (record.locking_read != null) return true
  }

  return Object.values(record).some(containsWriteCapableNode)
}

/**
 * Fail-closed syntactic proof for the boundary where EXPLAIN ANALYZE would
 * execute the supplied statement. Parse failures and unsupported constructs
 * are deliberately treated as unproven.
 */
export function isProvenReadOnlySql(
  sql: string,
  system: SqlDatabaseSystem
): boolean {
  let ast: unknown
  try {
    ast = parser.astify(sql, { database: DIALECT[system] })
  } catch {
    return false
  }

  if (Array.isArray(ast)) {
    if (ast.length !== 1) return false
    ast = ast[0]
  }
  if (!ast || typeof ast !== 'object') return false
  const rootType = (ast as Record<string, unknown>).type
  return (
    typeof rootType === 'string' &&
    rootType.toLowerCase() === 'select' &&
    !containsWriteCapableNode(ast)
  )
}

export function assertAnalyzeReadOnlySql(
  sql: string,
  system: SqlDatabaseSystem
): void {
  if (!isProvenReadOnlySql(sql, system)) {
    throw new Error(
      'dbcli explain --analyze requires a proven read-only SELECT; use plain dbcli explain for write-capable or unrecognized SQL'
    )
  }
}
