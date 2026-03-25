/**
 * Output formatters for schema data and query results
 * Supports multiple output formats: table (human), JSON (machine), CSV (spreadsheet)
 */

export { TableFormatter, TableListFormatter } from './table-formatter'
export { JSONFormatter, TableSchemaJSONFormatter } from './json-formatter'
export { QueryResultFormatter } from './query-result-formatter'

export interface OutputFormatter<T> {
  format(data: T, options?: { compact?: boolean }): string
}
