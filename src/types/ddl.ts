/**
 * Type definitions for DDL operations
 * Defines operations, results, and options for schema modification commands
 */

import type {
  ColumnDefinition,
  AlterColumnOptions,
  IndexDefinition,
  ConstraintDefinition,
  EnumDefinition,
} from '@/adapters/ddl/types'

// ---------------------------------------------------------------------------
// DDL Operations (discriminated union)
// ---------------------------------------------------------------------------

export type DDLOperation =
  | { kind: 'createTable'; table: string; columns: ColumnDefinition[] }
  | { kind: 'dropTable'; table: string }
  | { kind: 'addColumn'; table: string; column: ColumnDefinition }
  | { kind: 'dropColumn'; table: string; column: string }
  | { kind: 'alterColumn'; options: AlterColumnOptions }
  | { kind: 'addIndex'; index: IndexDefinition }
  | { kind: 'dropIndex'; indexName: string; table?: string }
  | { kind: 'addConstraint'; constraint: ConstraintDefinition }
  | { kind: 'dropConstraint'; table: string; constraintName: string }
  | { kind: 'addEnum'; definition: EnumDefinition }
  | { kind: 'alterEnum'; name: string; addValue: string }
  | { kind: 'dropEnum'; name: string }

// ---------------------------------------------------------------------------
// Execution Options
// ---------------------------------------------------------------------------

export interface DDLExecutionOptions {
  /** Actually execute the SQL (default: false = dry-run) */
  execute?: boolean
  /** Skip confirmation prompt for destructive operations */
  force?: boolean
}

// ---------------------------------------------------------------------------
// Execution Result
// ---------------------------------------------------------------------------

export interface DDLExecutionResult {
  status: 'success' | 'error'
  operation: DDLOperation['kind']
  sql: string
  warnings: string[]
  timestamp: string
  error?: string
  dryRun: boolean
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract the table name from a DDL operation (for blacklist checks) */
export function getOperationTable(op: DDLOperation): string | null {
  switch (op.kind) {
    case 'createTable':
    case 'dropTable':
      return op.table
    case 'addColumn':
      return op.table
    case 'dropColumn':
      return op.table
    case 'alterColumn':
      return op.options.table
    case 'addIndex':
      return op.index.table
    case 'dropIndex':
      return op.table || null
    case 'addConstraint':
      return op.constraint.table
    case 'dropConstraint':
      return op.table
    case 'addEnum':
    case 'alterEnum':
    case 'dropEnum':
      return null // enum is standalone type
  }
}

/** Check if operation is destructive (DROP) */
export function isDestructiveOperation(op: DDLOperation): boolean {
  return (
    op.kind === 'dropTable' ||
    op.kind === 'dropColumn' ||
    op.kind === 'dropIndex' ||
    op.kind === 'dropConstraint' ||
    op.kind === 'dropEnum'
  )
}
