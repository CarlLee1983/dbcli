/**
 * BlacklistValidator — Enforces blacklist rules at query/data execution points
 *
 * Responsibility: Apply blacklist rules to table operations and column filtering.
 * Uses BlacklistManager for lookups and i18n for user-facing messages.
 */

import { BlacklistError } from '@/types/blacklist'
import { t_vars } from '@/i18n/message-loader'
import type { BlacklistManager } from './blacklist-manager'
import { hasFieldPath, omitFieldPaths } from './field-projection'

/**
 * Result of column filtering operation
 */
export interface FilterColumnsResult {
  filteredRows: Record<string, unknown>[]
  omittedColumns: string[]
}

/**
 * Validator class for enforcing blacklist rules.
 * Instantiate once per CLI invocation with a BlacklistManager.
 */
export class BlacklistValidator {
  constructor(private manager: BlacklistManager) {}

  /**
   * Check if an operation on a table is allowed.
   * Throws BlacklistError if the table is blacklisted and override is not active.
   *
   * @param operation SQL operation type: SELECT, INSERT, UPDATE, DELETE
   * @param tableName Table name to check
   * @param _tableList Unused (reserved for future multi-table validation)
   * @throws BlacklistError if table is blacklisted
   */
  checkTableBlacklist(operation: string, tableName: string, _tableList: string[] = []): void {
    if (this.manager.canOverrideBlacklist()) {
      // Log warning that override is active
      const message = t_vars('warnings.blacklist_override_used', {
        operation,
        table: tableName,
      })
      console.error(message)
      return
    }

    if (this.manager.isTableBlacklisted(tableName)) {
      const message = t_vars('errors.table_blacklisted', {
        table: tableName,
        operation,
      })
      throw new BlacklistError(message, tableName, operation)
    }
  }

  /**
   * Reject a write that touches blacklisted columns.
   * Computes the intersection of `fields` with the table's column blacklist
   * and throws BlacklistError when non-empty. When override is enabled,
   * emits a console warning and returns without throwing.
   *
   * @param tableName Table or collection name
   * @param fields Top-level field/column names being written
   * @param operation SQL operation type (defaults to 'WRITE')
   * @throws BlacklistError when any field is blacklisted and override is off
   */
  checkColumnBlacklistOnWrite(
    tableName: string,
    fields: string[],
    operation: string = 'WRITE'
  ): void {
    const blacklisted = this.manager.getBlacklistedColumns(tableName)
    if (blacklisted.length === 0 || fields.length === 0) {
      return
    }
    const conflicts = fields.filter((f) => blacklisted.includes(f))
    if (conflicts.length === 0) {
      return
    }

    if (this.manager.canOverrideBlacklist()) {
      const warning = t_vars('warnings.blacklist_override_used', {
        operation,
        table: tableName,
      })
      console.error(`${warning} (columns: ${conflicts.join(', ')})`)
      return
    }

    const message = t_vars('errors.column_blacklisted_write', {
      table: tableName,
      operation,
      columns: conflicts.join(', '),
    })
    throw new BlacklistError(message, tableName, operation)
  }

  /**
   * Filter blacklisted columns from query result rows.
   * Returns new row objects without blacklisted columns (immutable).
   *
   * @param tableName Table name to look up column blacklist
   * @param rows Query result rows
   * @param columnList Column names in result set
   * @returns Filtered rows and list of omitted column names
   */
  filterColumns(
    tableName: string,
    rows: Record<string, unknown>[],
    columnList: string[]
  ): FilterColumnsResult {
    const blacklistedColumns = this.manager.getBlacklistedColumns(tableName)

    if (blacklistedColumns.length === 0) {
      return { filteredRows: rows, omittedColumns: [] }
    }

    // SQL adapters normally return a uniform top-level column set, but JSON
    // columns can contain nested records. Treat an exact dotted path as
    // protected too, so projecting its parent cannot recover the child.
    const omittedColumns = blacklistedColumns.filter(
      (path) => columnList.includes(path) || rows.some((row) => hasFieldPath(row, path))
    )

    if (omittedColumns.length === 0) {
      return { filteredRows: rows, omittedColumns: [] }
    }

    // Create new row objects without blacklisted top-level or dotted fields.
    const filteredRows = omitFieldPaths(rows, omittedColumns)

    return { filteredRows, omittedColumns }
  }

  /**
   * Build a security notification message for omitted columns.
   *
   * @param _tableName Table name (reserved for future per-table messages)
   * @param omittedColumns List of column names that were omitted
   * @returns Security notification string, or empty string if no columns omitted
   */
  buildSecurityNotification(_tableName: string, omittedColumns: string[]): string {
    if (omittedColumns.length === 0) {
      return ''
    }

    return t_vars('security.columns_omitted', {
      count: omittedColumns.length,
    })
  }
}

// Re-export BlacklistError for convenience
export { BlacklistError }
