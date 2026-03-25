/**
 * Output formatters for schema data
 * Supports multiple output formats: table (human), JSON (machine)
 */

export { TableFormatter, TableListFormatter } from './table-formatter'
export { JSONFormatter, TableSchemaJSONFormatter } from './json-formatter'

export interface OutputFormatter<T> {
  format(data: T, options?: { compact?: boolean }): string
}
