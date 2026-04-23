/**
 * Query result formatter for multiple output formats
 * Supports table (ASCII), JSON, and CSV output formats
 */

import type { QueryResult } from '../types/query'

// Using require for cli-table3 due to CommonJS export
const Table = require('cli-table3')

export interface OutputFormatter<T> {
  format(data: T, options?: { compact?: boolean; format?: string }): string
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
export class QueryResultFormatter implements OutputFormatter<QueryResult<Record<string, any>>> {
  /**
   * Formats query result in the specified format
   * @param result Query result object containing rows and metadata
   * @param options Format options (compact, format)
   * @returns Formatted string in requested format
   */
  format(
    result: QueryResult<Record<string, any>>,
    options?: { compact?: boolean; format?: 'table' | 'json' | 'csv' }
  ): string {
    const format = options?.format || 'table'

    switch (format) {
      case 'json':
        return this.formatJSON(result, options?.compact)
      case 'csv':
        return this.formatCSV(result)
      case 'table':
      default:
        return this.formatTable(result)
    }
  }

  /**
   * Formats result as ASCII table with headers and metadata footer
   * Uses cli-table3 for consistent terminal output
   */
  private formatTable(result: QueryResult<Record<string, any>>): string {
    if (result.rows.length === 0) {
      return this.formatEmptyTable(result)
    }

    const table = new Table({
      head: result.columnNames,
      style: { compact: false, 'padding-left': 1, 'padding-right': 1 },
    })

    result.rows.forEach((row) => {
      table.push(result.columnNames.map((col) => this.cellToString(row[col])))
    })

    let output = table.toString()

    // Add metadata footer
    const footerLines: string[] = []
    footerLines.push(`Rows: ${result.rowCount}`)

    if (result.executionTimeMs !== undefined) {
      footerLines.push(`Execution time: ${result.executionTimeMs}ms`)
    }

    if (footerLines.length > 0) {
      output += '\n' + footerLines.join(' | ')
    }

    // Add security notification if columns were filtered
    if (result.metadata?.securityNotification) {
      output += '\n' + result.metadata.securityNotification
    }

    return output
  }

  /**
   * Formats empty result set as table with just headers and footer
   */
  private formatEmptyTable(result: QueryResult<Record<string, any>>): string {
    const table = new Table({
      head: result.columnNames,
      style: { compact: false, 'padding-left': 1, 'padding-right': 1 },
    })

    let output = table.toString()

    // Add metadata footer
    const footerLines: string[] = []
    footerLines.push(`Rows: ${result.rowCount}`)

    if (result.executionTimeMs !== undefined) {
      footerLines.push(`Execution time: ${result.executionTimeMs}ms`)
    }

    if (footerLines.length > 0) {
      output += '\n' + footerLines.join(' | ')
    }

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
  private formatJSON(result: QueryResult<Record<string, any>>, compact?: boolean): string {
    const spacing = compact ? undefined : 2

    const output = {
      rows: result.rows,
      rowCount: result.rowCount,
      columnNames: result.columnNames,
      columnTypes: result.columnTypes,
      executionTimeMs: result.executionTimeMs,
      metadata: result.metadata,
    }

    return JSON.stringify(output, null, spacing)
  }

  /**
   * Formats result as RFC 4180 compliant CSV
   * Handles proper escaping of commas, quotes, and newlines
   */
  private formatCSV(result: QueryResult<Record<string, any>>): string {
    if (result.rows.length === 0) {
      // Headers only for empty result
      let csvOutput = result.columnNames.map((name) => this.escapeCSVField(name)).join(',')
      if (result.metadata?.securityNotification) {
        csvOutput += '\n# ' + result.metadata.securityNotification
      }
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

    return lines.join('\n')
  }

  /**
   * Escapes a single CSV field value according to RFC 4180
   * - Null/undefined becomes empty string
   * - If value contains comma, quote, or newline, wrap in double quotes and escape internal quotes as ""
   * @param value Field value to escape
   * @returns Properly escaped CSV field
   */
  private escapeCSVField(value: any): string {
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
  private cellToString(value: any): string {
    if (value === null || value === undefined) {
      return ''
    }

    if (typeof value === 'object') {
      return JSON.stringify(value)
    }

    return String(value)
  }
}
