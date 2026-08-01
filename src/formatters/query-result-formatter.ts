/**
 * Query result formatter for multiple output formats
 * Supports table (ASCII), JSON, and CSV output formats
 */

import type { QueryResult } from '../types/query'

// Using require for cli-table3 due to CommonJS export
const Table = require('cli-table3')

export interface OutputFormatter<T> {
  format(
    data: T,
    options?: { compact?: boolean; format?: string; truncate?: number | false }
  ): string
}

export const DEFAULT_TABLE_CELL_LIMIT = 120

export function truncateSerializedCell(serialized: string, limit: number): string {
  if (!Number.isSafeInteger(limit) || limit <= 0) {
    throw new Error('Table cell truncation limit must be a positive integer')
  }

  const codePoints = Array.from(serialized)
  if (codePoints.length <= limit) return serialized

  const omitted = codePoints.length - limit
  return `${codePoints.slice(0, limit).join('')}…(+${omitted} chars)`
}

export function toPublicQueryResult(result: QueryResult<Record<string, unknown>>): {
  rows: Record<string, unknown>[]
  rowCount: number
  columnNames: string[]
  columnTypes?: string[]
  executionTimeMs?: number
  metadata?: Record<string, unknown>
} {
  const appliedLimit = result.appliedLimit
  const metadata =
    result.metadata || appliedLimit
      ? {
          ...result.metadata,
          ...(appliedLimit
            ? {
                truncated: appliedLimit.truncated,
                limit_applied: appliedLimit.limitApplied,
              }
            : {}),
        }
      : undefined

  return {
    rows: result.rows,
    rowCount: result.rowCount,
    columnNames: result.columnNames,
    columnTypes: result.columnTypes,
    executionTimeMs: result.executionTimeMs,
    metadata,
  }
}

/**
 * Formatter for query results with support for multiple output formats
 * Implements OutputFormatter interface for QueryResult objects
 *
 * Supports three output formats:
 * - table: ASCII table with headers, rows, and metadata footer
 * - json: Structured JSON with full metadata for AI parsing
 * - csv: RFC 4180 compliant CSV with proper escaping
 */
export class QueryResultFormatter implements OutputFormatter<QueryResult<Record<string, unknown>>> {
  /**
   * Formats query result in the specified format
   * @param result Query result object containing rows and metadata
   * @param options Format options (compact, format)
   * @returns Formatted string in requested format
   */
  format(
    result: QueryResult<Record<string, unknown>>,
    options?: {
      compact?: boolean
      format?: 'table' | 'json' | 'csv' | 'html'
      truncate?: number | false
    }
  ): string {
    const format = options?.format || 'table'

    switch (format) {
      case 'json':
        return this.formatJSON(result, options?.compact)
      case 'csv':
        return this.formatCSV(result)
      case 'table':
      default:
        return this.formatTable(result, options?.truncate)
    }
  }

  /**
   * Formats result as ASCII table with headers and metadata footer
   * Uses cli-table3 for consistent terminal output
   */
  private formatTable(
    result: QueryResult<Record<string, unknown>>,
    truncate?: number | false
  ): string {
    if (result.rows.length === 0) {
      return this.formatEmptyTable(result)
    }

    const table = new Table({
      head: result.columnNames,
      style: { compact: false, 'padding-left': 1, 'padding-right': 1 },
    })

    result.rows.forEach((row) => {
      table.push(result.columnNames.map((col) => this.cellToString(row[col], truncate)))
    })

    let output = table.toString()

    // Add metadata footer
    output += '\n' + this.formatTableFooter(result)

    // Add security notification if columns were filtered
    if (result.metadata?.securityNotification) {
      output += '\n' + result.metadata.securityNotification
    }

    return output
  }

  /**
   * Formats empty result set as table with just headers and footer
   */
  private formatEmptyTable(result: QueryResult<Record<string, unknown>>): string {
    const table = new Table({
      head: result.columnNames,
      style: { compact: false, 'padding-left': 1, 'padding-right': 1 },
    })

    let output = table.toString()

    // Add metadata footer
    output += '\n' + this.formatTableFooter(result)

    // Add security notification if columns were filtered
    if (result.metadata?.securityNotification) {
      output += '\n' + result.metadata.securityNotification
    }

    return output
  }

  /**
   * Formats result as JSON for AI parsing
   * Includes all metadata fields for complete result information
   */
  private formatJSON(result: QueryResult<Record<string, unknown>>, compact?: boolean): string {
    const spacing = compact ? undefined : 2
    return JSON.stringify(toPublicQueryResult(result), null, spacing)
  }

  private formatTableFooter(result: QueryResult<Record<string, unknown>>): string {
    const footerLines: string[] = []
    const appliedLimit = result.appliedLimit
    const rowsText = appliedLimit?.truncated
      ? `Rows: ${result.rowCount} (truncated; limit ${appliedLimit.limitApplied})`
      : `Rows: ${result.rowCount}`
    footerLines.push(rowsText)

    if (result.executionTimeMs !== undefined) {
      footerLines.push(`Execution time: ${result.executionTimeMs}ms`)
    }

    return footerLines.join(' | ')
  }

  /**
   * Formats result as RFC 4180 compliant CSV
   * Handles proper escaping of commas, quotes, and newlines
   */
  private formatCSV(result: QueryResult<Record<string, unknown>>): string {
    const truncationNotice = result.appliedLimit?.truncated
      ? `# truncated; limit ${result.appliedLimit.limitApplied} — rerun with --no-limit or --limit N for the full result`
      : undefined

    if (result.rows.length === 0) {
      // Headers only for empty result
      let csvOutput = result.columnNames.map((name) => this.escapeCSVField(name)).join(',')
      if (result.metadata?.securityNotification) {
        csvOutput += '\n# ' + result.metadata.securityNotification
      }
      if (truncationNotice) csvOutput += '\n' + truncationNotice
      return csvOutput
    }

    const lines: string[] = []

    // Add header row
    lines.push(result.columnNames.map((name) => this.escapeCSVField(name)).join(','))

    // Add data rows
    result.rows.forEach((row) => {
      const csvRow = result.columnNames.map((col) => this.escapeCSVField(row[col])).join(',')
      lines.push(csvRow)
    })

    // Add security notification as comment line
    if (result.metadata?.securityNotification) {
      lines.push(`# ${result.metadata.securityNotification}`)
    }
    if (truncationNotice) lines.push(truncationNotice)

    return lines.join('\n')
  }

  /**
   * Escapes a single CSV field value according to RFC 4180
   * - Null/undefined becomes empty string
   * - If value contains comma, quote, or newline, wrap in double quotes and escape internal quotes as ""
   * @param value Field value to escape
   * @returns Properly escaped CSV field
   */
  private escapeCSVField(value: unknown): string {
    // Handle null/undefined
    if (value === null || value === undefined) {
      return ''
    }

    const str = String(value)

    // Check if escaping is needed
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      // Wrap in quotes and escape internal quotes as ""
      return `"${str.replace(/"/g, '""')}"`
    }

    return str
  }

  /**
   * Converts a cell value to string for table display
   * Handles null, undefined, numbers, and objects appropriately
   */
  private cellToString(value: unknown, truncate?: number | false): string {
    if (value === null || value === undefined) {
      return ''
    }

    let serialized: string
    if (typeof value === 'object') {
      serialized = JSON.stringify(value)
    } else {
      serialized = String(value)
    }

    return typeof truncate === 'number'
      ? truncateSerializedCell(serialized, truncate)
      : serialized
  }
}
