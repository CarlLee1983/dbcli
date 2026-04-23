/**
 * BlacklistManager — Loads and maintains blacklist state from .dbcli config
 *
 * Responsibility: Single source of truth for blacklist configuration.
 * Deserializes BlacklistConfig JSON into efficient Set/Map structures
 * for O(1) lookup performance.
 */

import type { DbcliConfig } from '@/types'
import type { BlacklistConfig, BlacklistState } from '@/types/blacklist'

/**
 * Manager class for loading and querying blacklist rules.
 * Instantiate once per CLI invocation.
 */
export class BlacklistManager {
  private state: BlacklistState
  private overrideEnabled: boolean

  constructor(
    private config: DbcliConfig,
    overrideEnvValue?: string
  ) {
    this.overrideEnabled = (overrideEnvValue ?? Bun.env.DBCLI_OVERRIDE_BLACKLIST ?? '') === 'true'
    this.state = this.loadBlacklist()
  }

  /**
   * Deserialize config.blacklist JSON into efficient Set/Map structures.
   * Case-insensitive table names (stored as lowercase).
   * Case-sensitive column names.
   *
   * @returns BlacklistState with Set<string> for tables, Map<string, Set<string>> for columns
   */
  loadBlacklist(): BlacklistState {
    const tables = new Set<string>()
    const columns = new Map<string, Set<string>>()

    const blacklistConfig = (this.config as any).blacklist as BlacklistConfig | undefined

    if (!blacklistConfig) {
      return { tables, columns }
    }

    // Load table blacklist
    if (Array.isArray(blacklistConfig.tables)) {
      for (const tableName of blacklistConfig.tables) {
        if (typeof tableName === 'string') {
          tables.add(tableName.toLowerCase())
        } else {
          console.warn(
            `[BlacklistManager] Invalid table name in blacklist config: ${JSON.stringify(tableName)}`
          )
        }
      }
    } else if (blacklistConfig.tables !== undefined) {
      console.warn('[BlacklistManager] blacklist.tables must be an array, ignoring')
    }

    // Load column blacklist
    if (
      blacklistConfig.columns &&
      typeof blacklistConfig.columns === 'object' &&
      !Array.isArray(blacklistConfig.columns)
    ) {
      for (const [tableName, cols] of Object.entries(blacklistConfig.columns)) {
        if (typeof tableName !== 'string') {
          console.warn(
            `[BlacklistManager] Invalid table name key in columns config: ${JSON.stringify(tableName)}`
          )
          continue
        }

        if (!Array.isArray(cols)) {
          console.warn(
            `[BlacklistManager] blacklist.columns["${tableName}"] must be an array, ignoring`
          )
          continue
        }

        const columnSet = new Set<string>()
        for (const col of cols) {
          if (typeof col === 'string') {
            columnSet.add(col)
          } else {
            console.warn(
              `[BlacklistManager] Invalid column name in blacklist.columns["${tableName}"]: ${JSON.stringify(col)}`
            )
          }
        }

        if (columnSet.size > 0) {
          columns.set(tableName, columnSet)
        }
      }
    } else if (blacklistConfig.columns !== undefined) {
      console.warn('[BlacklistManager] blacklist.columns must be an object, ignoring')
    }

    return { tables, columns }
  }

  /**
   * Check if a table is blacklisted.
   * Case-insensitive comparison.
   *
   * @param tableName Table name to check
   * @returns true if the table is blacklisted
   */
  isTableBlacklisted(tableName: string): boolean {
    return this.state.tables.has(tableName.toLowerCase())
  }

  /**
   * Check if a specific column in a table is blacklisted.
   * Table name is case-insensitive; column name is case-sensitive.
   *
   * @param tableName Table name
   * @param columnName Column name
   * @returns true if the column is blacklisted
   */
  isColumnBlacklisted(tableName: string, columnName: string): boolean {
    const columnSet = this.state.columns.get(tableName)
    if (!columnSet) {
      return false
    }
    return columnSet.has(columnName)
  }

  /**
   * Get all blacklisted column names for a specific table.
   *
   * @param tableName Table name
   * @returns Array of blacklisted column names, or empty array if none
   */
  getBlacklistedColumns(tableName: string): string[] {
    const columnSet = this.state.columns.get(tableName)
    if (!columnSet) {
      return []
    }
    return Array.from(columnSet)
  }

  /**
   * Check if the blacklist override is enabled via environment variable.
   * When true, all blacklist checks are bypassed.
   *
   * @returns true if DBCLI_OVERRIDE_BLACKLIST=true
   */
  canOverrideBlacklist(): boolean {
    return this.overrideEnabled
  }

  /**
   * Get current blacklist state (for diagnostic purposes).
   */
  getState(): BlacklistState {
    return this.state
  }
}
