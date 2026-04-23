/**
 * BlacklistValidator — Enforces blacklist rules at query/data execution points
 *
 * Responsibility: Apply blacklist rules to table operations and column filtering.
 * Uses BlacklistManager for lookups and i18n for user-facing messages.
 */

import { BlacklistError } from '@/types/blacklist'
import { t_vars } from '@/i18n/message-loader'
import type { BlacklistManager } from './blacklist-manager'

/**
 * Result of column filtering operation
 */
export interface FilterColumnsResult {
  filteredRows: Record<string, any>[]
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
    rows: Record<string, any>[],
    columnList: string[]
  ): FilterColumnsResult {
    const blacklistedColumns = this.manager.getBlacklistedColumns(tableName)

    if (blacklistedColumns.length === 0) {
      return { filteredRows: rows, omittedColumns: [] }
    }

    // Find which columns from the result set are actually blacklisted
    const omittedColumns = columnList.filter((col) => blacklistedColumns.includes(col))

    if (omittedColumns.length === 0) {
      return { filteredRows: rows, omittedColumns: [] }
    }

    // Create new row objects without blacklisted columns (immutable)
    const filteredRows = rows.map((row) => {
      const newRow: Record<string, any> = {}
      for (const [key, value] of Object.entries(row)) {
        if (!omittedColumns.includes(key)) {
          newRow[key] = value
        }
      }
      return newRow
    })

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
