/**
 * BlacklistManager — Loads and maintains blacklist state from .dbcli config
 *
 * Responsibility: Single source of truth for blacklist configuration.
 * Deserializes BlacklistConfig JSON into efficient Set/Map structures
 * for O(1) lookup performance.
 */

import type { DbcliConfig } from '@/types'
import type { BlacklistConfig, BlacklistState } from '@/types/blacklist'
import { globMatches } from '@/utils/glob'

/**
 * Manager class for loading and querying blacklist rules.
 * Instantiate once per CLI invocation.
 */
/**
 * Strip what has one plausible reading: surrounding whitespace, and one layer
 * of surrounding `"` or backtick quoting. `es-index-target.ts` already does
 * this for Elasticsearch index names; measured 2026-08-31, the SQL side did
 * not, so `[" password "]` and `['"password"']` were accepted and dead.
 */
function normalizeBlacklistEntry(raw: string): string {
  const trimmed = raw.trim()
  const quote = trimmed[0]
  if ((quote === '"' || quote === '`') && trimmed.length > 1 && trimmed.endsWith(quote)) {
    return trimmed.slice(1, -1).trim()
  }
  return trimmed
}

/**
 * A rule the code cannot use must say so. A column entry whose first segment is
 * the table it sits under is a table-qualified name, which never matched
 * anything; it cannot be rewritten silently because a dot in a column entry
 * already means a nested path (`profile.ssn`), which the ancestor walk in
 * `filterColumnsForTables` exists to serve. ADR-0018 Decision 2.
 */
function assertNotTableQualified(tableKey: string, column: string): void {
  const dot = column.indexOf('.')
  if (dot <= 0) return
  if (column.slice(0, dot).toLowerCase() !== tableKey.toLowerCase()) return
  throw new Error(
    `[BlacklistManager] blacklist.columns["${tableKey}"] entry ${JSON.stringify(column)} is ` +
      `qualified with its own table and would never match. Write it as ` +
      `${JSON.stringify(column.slice(dot + 1))}.`
  )
}

export class BlacklistManager {
  private state: BlacklistState
  private overrideEnabled: boolean

  constructor(
    private config: DbcliConfig,
    overrideEnvValue?: string
  ) {
    this.overrideEnabled = (overrideEnvValue ?? Bun.env.DBCLI_OVERRIDE_BLACKLIST ?? '') === 'true'
    this.state = this.loadBlacklist()
    this.wildcardTables = [...this.state.tables].filter((entry) => /[*?[\\]/.test(entry))
  }

  /**
   * Deserialize config.blacklist JSON into efficient Set/Map structures.
   * Case-insensitive table names (stored as lowercase). Column entries are
   * stored as written and folded where they are compared — see ADR-0018.
   *
   * @returns BlacklistState with Set<string> for tables, Map<string, Set<string>> for columns
   */
  loadBlacklist(): BlacklistState {
    const tables = new Set<string>()
    const columns = new Map<string, Set<string>>()

    const blacklistConfig = (this.config as { blacklist?: BlacklistConfig }).blacklist as
      | BlacklistConfig
      | undefined

    if (!blacklistConfig) {
      return { tables, columns }
    }

    // Load table blacklist
    if (Array.isArray(blacklistConfig.tables)) {
      for (const tableName of blacklistConfig.tables) {
        if (typeof tableName === 'string') {
          tables.add(normalizeBlacklistEntry(tableName).toLowerCase())
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
            const entry = normalizeBlacklistEntry(col)
            assertNotTableQualified(normalizeBlacklistEntry(tableName), entry)
            // Stored as written. Folding happens where names are *compared*
            // (ADR-0018 Decision 1) rather than here, because an entry's later
            // segments are nested object keys — `profile.SSN` in a JSON column
            // is not a SQL identifier and case-folding it would be wrong.
            columnSet.add(entry)
          } else {
            console.warn(
              `[BlacklistManager] Invalid column name in blacklist.columns["${tableName}"]: ${JSON.stringify(col)}`
            )
          }
        }

        if (columnSet.size > 0) {
          columns.set(normalizeBlacklistEntry(tableName).toLowerCase(), columnSet)
        }
      }
    } else if (blacklistConfig.columns !== undefined) {
      console.warn('[BlacklistManager] blacklist.columns must be an object, ignoring')
    }

    return { tables, columns }
  }

  /**
   * Check if a table is blacklisted.
   *
   * Case-insensitive, and each entry is a glob: `secrets*` covers
   * `secrets_2026`. The same array is already a glob for Redis keys and
   * Elasticsearch index expressions, and one config file gets one answer
   * (ADR-0019 Decision 4). `report\*` escapes back to a literal name.
   *
   * @param tableName Table name to check
   * @returns true if the table is blacklisted
   */
  isTableBlacklisted(tableName: string): boolean {
    const name = tableName.toLowerCase()
    if (this.state.tables.has(name)) return true
    for (const pattern of this.wildcardTables) {
      if (globMatches(pattern, name)) return true
    }
    return false
  }

  /**
   * Table entries carrying glob metacharacters.
   *
   * Computed with `state` rather than lazily: `getState()` hands the same `Set`
   * out, and a lazy cache filled after someone added to it would leave `Set.has`
   * seeing the new entry and the glob scan not — fail-open, and silently.
   * Nothing mutates it today; the point is that nothing can start to.
   */
  private readonly wildcardTables: ReadonlyArray<string>

  /**
   * Check if a specific column in a table is blacklisted.
   * Both are case-insensitive on their first segment. A column entry's later
   * segments are nested object keys and keep their case (ADR-0018).
   *
   * @param tableName Table name
   * @param columnName Column name
   * @returns true if the column is blacklisted
   */
  /**
   * The rules for a table, found by the reference as written and by its last
   * segment. `extractTableReferences` keeps a qualified name whole, so a rule
   * under `public.users` did not apply to `SELECT * FROM users` and the reverse
   * was equally true. ADR-0018 Decision 3.
   */
  private columnRulesFor(tableName: string): Set<string> | undefined {
    const key = normalizeBlacklistEntry(tableName).toLowerCase()
    const direct = this.state.columns.get(key)
    if (direct) return direct

    // The reference is qualified and the rule is not (`public.users` asked of a
    // rule filed under `users`).
    const dot = key.lastIndexOf('.')
    if (dot > 0) {
      const bare = this.state.columns.get(key.slice(dot + 1))
      if (bare) return bare
    }

    // The rule is qualified and the reference is not. Every rule whose last
    // segment matches applies: two schemas holding a same-named table is the
    // over-refusal this direction accepts.
    let merged: Set<string> | undefined
    for (const [ruleKey, columns] of this.state.columns) {
      const ruleDot = ruleKey.lastIndexOf('.')
      if (ruleDot <= 0 || ruleKey.slice(ruleDot + 1) !== key) continue
      merged ??= new Set<string>()
      for (const column of columns) merged.add(column)
    }
    return merged
  }

  isColumnBlacklisted(tableName: string, columnName: string): boolean {
    const columnSet = this.columnRulesFor(tableName)
    if (!columnSet) {
      return false
    }
    return columnSet.has(normalizeBlacklistEntry(columnName).toLowerCase())
  }

  /**
   * Get all blacklisted column names for a specific table.
   *
   * @param tableName Table name
   * @returns Array of blacklisted column names, or empty array if none
   */
  getBlacklistedColumns(tableName: string): string[] {
    const columnSet = this.columnRulesFor(tableName)
    if (!columnSet) {
      return []
    }
    return Array.from(columnSet)
  }

  /**
   * Every blacklisted column name, across all tables.
   *
   * Used when a statement's tables could not be identified: applying every
   * rule is the reading of "I do not know which table this came from" that
   * does not disclose data.
   *
   * @returns Array of blacklisted column names, deduplicated
   */
  getAllBlacklistedColumns(): string[] {
    const all = new Set<string>()
    for (const columnSet of this.state.columns.values()) {
      for (const column of columnSet) all.add(column)
    }
    return Array.from(all)
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
