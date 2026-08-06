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
import { expandIndexTargets, matchesIndexGlob } from '@/utils/es-index-target'

/**
 * Deduplicate table names case-insensitively, keeping the first spelling.
 * The manager looks tables up case-insensitively, so `Users` and `users` are
 * one entry and must not produce two warnings or two error mentions.
 */
function dedupe(values: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    const key = value.toLowerCase()
    if (value.length === 0 || seen.has(key)) continue
    seen.add(key)
    result.push(value)
  }
  return result
}

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
   * @param tableList Further tables the same statement references
   * @throws BlacklistError if any table is blacklisted
   */
  checkTableBlacklist(operation: string, tableName: string, tableList: string[] = []): void {
    this.checkTablesBlacklist(operation, [tableName, ...tableList])
  }

  /**
   * Check every table a statement references.
   *
   * A statement is blocked when *any* referenced table is blacklisted — the
   * table reached through a JOIN, a comma, or a UNION branch is as sensitive as
   * the one named first (issue #23).
   *
   * @param operation SQL operation type: SELECT, INSERT, UPDATE, DELETE
   * @param tableNames Every table the statement references
   * @throws BlacklistError if any table is blacklisted
   */
  checkTablesBlacklist(operation: string, tableNames: string[]): void {
    const tables = dedupe(tableNames)
    if (tables.length === 0) {
      return
    }

    if (this.manager.canOverrideBlacklist()) {
      // Log warning that override is active
      const message = t_vars('warnings.blacklist_override_used', {
        operation,
        table: tables.join(', '),
      })
      console.error(message)
      return
    }

    const blocked = tables.filter((table) => this.manager.isTableBlacklisted(table))
    if (blocked.length === 0) {
      return
    }

    const message = t_vars('errors.table_blacklisted', {
      table: blocked.join(', '),
      operation,
    })
    throw new BlacklistError(message, blocked[0] as string, operation)
  }

  /**
   * Check an Elasticsearch index expression against the table blacklist.
   *
   * `--index` is not a name: Elasticsearch accepts a comma list and wildcards,
   * so `secrets,orders`, `sec*`, `*` and `_all` all read a blacklisted index
   * while matching no blacklist entry by equality. Concrete names are checked
   * directly; a wildcard is refused when it *could* match a blacklisted index,
   * since which indices exist is server-side knowledge.
   *
   * @param operation Operation label for the error message
   * @param target Raw `--index` expression
   * @throws BlacklistError if any named or matchable index is blacklisted
   */
  checkIndexBlacklist(operation: string, target: string): void {
    const { concrete, wildcards } = expandIndexTargets(target)
    this.checkTablesBlacklist(operation, concrete)

    if (wildcards.length === 0 || this.manager.canOverrideBlacklist()) return

    const blacklisted = Array.from(this.manager.getState().tables)
    if (blacklisted.length === 0) return

    const reachable = wildcards.filter((pattern) =>
      blacklisted.some((entry) => matchesIndexGlob(pattern, entry))
    )
    if (reachable.length === 0) return

    const message = t_vars('errors.table_blacklisted', {
      table: reachable.join(', '),
      operation,
    })
    throw new BlacklistError(message, reachable[0] as string, operation)
  }

  /**
   * Mask result fields for an Elasticsearch index *expression*.
   *
   * `filterColumns` looks the name up by equality, so `--index 'us*'` or
   * `--index 'users,orders'` matched no rule and returned every protected field
   * — the table check passing is not enough when only columns are blacklisted.
   * A wildcard is resolved server-side, so every rule it could reach is
   * applied.
   *
   * @param target Raw `--index` expression
   * @param rows Result documents
   * @param columnList Field names in the result
   */
  filterColumnsForIndexExpression(
    target: string,
    rows: Record<string, unknown>[],
    columnList: string[]
  ): FilterColumnsResult {
    const { concrete, wildcards } = expandIndexTargets(target)
    const ruleKeys = Array.from(this.manager.getState().columns.keys())
    const reachable = ruleKeys.filter((key) =>
      wildcards.some((pattern) => matchesIndexGlob(pattern, key))
    )
    return this.filterColumnsForTables([...concrete, ...reachable], rows, columnList)
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
    return this.filterColumnsForTables([tableName], rows, columnList)
  }

  /**
   * Filter blacklisted columns using the rules of every referenced table.
   *
   * A result set built from a JOIN carries columns from several tables, and the
   * driver returns them unqualified — `u.password_hash` arrives as
   * `password_hash`. Attribution is therefore not recoverable from the result,
   * so a column blacklisted on *any* referenced table is omitted. That errs
   * towards hiding a same-named column of an innocent table, which is the
   * direction that does not disclose data.
   *
   * @param tableNames Every table the statement references
   * @param rows Query result rows
   * @param columnList Column names in result set
   * @returns Filtered rows and list of omitted column names
   */
  filterColumnsForTables(
    tableNames: string[],
    rows: Record<string, unknown>[],
    columnList: string[]
  ): FilterColumnsResult {
    // Column names are matched case-sensitively, so they are deduplicated
    // exactly — unlike table names, which the manager looks up case-insensitively.
    //
    // An empty list means the scan could not name a table, which is not the
    // same as "this statement has no rules". Treating it as the latter would
    // turn any gap in the scan into a disclosure, so every rule is applied.
    const tables = dedupe(tableNames)
    const blacklistedColumns =
      tables.length === 0
        ? this.manager.getAllBlacklistedColumns()
        : Array.from(new Set(tables.flatMap((table) => this.manager.getBlacklistedColumns(table))))

    if (blacklistedColumns.length === 0) {
      return { filteredRows: rows, omittedColumns: [] }
    }

    // SQL adapters normally return a uniform top-level column set, but JSON
    // columns can contain nested records. Treat an exact dotted path as
    // protected too, so projecting its parent cannot recover the child.
    //
    // The other direction has to hold as well: an adapter may flatten instead of
    // nest. `elasticsearch-adapter.ts` walks `_source` recursively and emits
    // `profile.email` as a top-level key with no `profile` key anywhere, so a
    // blacklist entry naming the parent matched nothing — the rows were returned
    // whole and, because the omitted list was empty, without a notification either.
    // Every present column under the parent is therefore omitted by name.
    // Sparse documents mean a protected field can appear only in a later row, so
    // the column set is taken from the rows as well as the declared column list.
    // A null row is an adapter edge case, not a reason to throw from the masker.
    // `nestedHeads` records which of those keys actually hold an object (or array,
    // which `readPath` walks too). That is the only thing the nested probe below can
    // descend into, so collecting it here — in a pass the masker already makes —
    // is what lets most probes be skipped without walking a single row. It is only
    // collected when some rule is dotted: reading the values costs about 4x listing
    // the names (0.30ms vs 0.07ms over 1000 x 13), and a dotless-only blacklist —
    // the overwhelmingly common case — never consults it. Reading them also *calls*
    // any getter a row happens to carry, which is worth confining to the case that
    // needs it.
    //
    // Names, not `Object.keys`: `readPath` decided membership with `hasOwnProperty`,
    // so a non-enumerable own property used to be found and masked. Enumerable-only
    // collection would silently stop omitting it, and an empty omitted list returns
    // the rows untouched — fail-open, in the one place that must not be.
    const probeNested = blacklistedColumns.some((path) => path.includes('.'))
    const presentColumns = new Set(columnList)
    const nestedHeads = new Set<string>()
    for (const row of rows) {
      if (row === null || typeof row !== 'object') continue
      for (const key of Object.getOwnPropertyNames(row)) {
        presentColumns.add(key)
        if (!probeNested) continue
        const value = (row as Record<string, unknown>)[key]
        if (value !== null && typeof value === 'object') nestedHeads.add(key)
      }
    }

    const protectedPaths = new Set(blacklistedColumns)

    const omitted = new Set<string>()
    for (const path of blacklistedColumns) {
      // `presentColumns` first: it is a Set lookup, while the nested probe walks
      // every row. The fail-safe branch above can hand this loop the whole rule set
      // with almost nothing matching, which is exactly the shape that probe is worst at.
      if (presentColumns.has(path)) {
        omitted.add(path)
        continue
      }
      // Everything the probe could still find is reachable only by descending from a
      // head key into a nested record. So a dotless path has nothing left to find —
      // `presentColumns` already answered it exactly — and a dotted path whose head
      // is never an object in any row cannot match either. Skipping both is not a
      // heuristic: it is the same condition `readPath` would evaluate, decided once
      // per rule instead of once per row. 60 dotted misses over 1000 rows measured
      // 12.1ms before and 0.2ms after, and only then is `split` worth hoisting.
      const dot = path.indexOf('.')
      if (dot < 0) continue
      if (!nestedHeads.has(path.slice(0, dot))) continue
      const segments = path.split('.')
      if (rows.some((row) => hasFieldPath(row, segments))) omitted.add(path)
    }
    // Walk each column up to its ancestors rather than testing every rule against
    // every column: `a.b.c` only has to ask about `a` and `a.b`. The other direction
    // is O(columns × rules), which on a wide sparse result set with a large blacklist
    // measured 26ms where this measures 6.7ms. Ancestor matching also means a merely
    // similar name — `profiles`, `profile_name` — is never mistaken for a child.
    for (const column of presentColumns) {
      // `dot >= 0` continues the walk; `dot > 0` decides a match. Conflating the two
      // meant a column whose name starts with a dot — Elasticsearch permits it, and
      // `flattenSource` concatenates it verbatim — exited before testing a single
      // ancestor, so a rule for `.profile` never reached `.profile.ssn`.
      let dot = column.indexOf('.')
      while (dot >= 0) {
        if (dot > 0 && protectedPaths.has(column.slice(0, dot))) {
          omitted.add(column)
          break
        }
        dot = column.indexOf('.', dot + 1)
      }
    }
    const omittedColumns = Array.from(omitted)

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
