/**
 * Tests for security notification rendering in QueryResultFormatter
 * Verifies that blacklist security notifications appear in table and CSV output
 */

import { test, expect, describe } from 'bun:test'
import { QueryResultFormatter } from './query-result-formatter'
import type { QueryResult } from '../types/query'

const formatter = new QueryResultFormatter()

function makeResult(overrides: Partial<QueryResult<Record<string, any>>> = {}): QueryResult<Record<string, any>> {
  return {
    rows: [{ id: 1, name: 'Alice' }],
    rowCount: 1,
    columnNames: ['id', 'name'],
    executionTimeMs: 5,
    metadata: { statement: 'SELECT' },
    ...overrides
  }
}

describe('QueryResultFormatter security notification', () => {
  // Test 1: formatTable() with securityNotification appends it after footer
  test('formatTable: appends securityNotification after footer when present', () => {
    const result = makeResult({
      metadata: {
        statement: 'SELECT',
        securityNotification: 'Security: 2 column(s) were omitted based on your blacklist'
      }
    })
    const output = formatter.format(result, { format: 'table' })
    expect(output).toContain('Rows: 1')
    expect(output).toContain('Security: 2 column(s) were omitted based on your blacklist')
    // Security notification should appear after the Rows/Time footer line
    const rowsIndex = output.indexOf('Rows: 1')
    const secIndex = output.indexOf('Security: 2 column(s) were omitted')
    expect(secIndex).toBeGreaterThan(rowsIndex)
  })

  // Test 2: formatTable() with metadata = undefined does NOT crash or add security line
  test('formatTable: no crash and no security line when metadata is undefined', () => {
    const result = makeResult({ metadata: undefined })
    const output = formatter.format(result, { format: 'table' })
    expect(output).toContain('Rows: 1')
    expect(output).not.toContain('Security:')
  })

  // Test 3: formatTable() with securityNotification = "" does NOT add security line
  test('formatTable: no security line when securityNotification is empty string', () => {
    const result = makeResult({
      metadata: { statement: 'SELECT', securityNotification: '' }
    })
    const output = formatter.format(result, { format: 'table' })
    expect(output).toContain('Rows: 1')
    // Should not append an empty line for security
    const lines = output.split('\n')
    const secLine = lines.find(l => l.startsWith('Security:'))
    expect(secLine).toBeUndefined()
  })

  // Test 4: formatEmptyTable() with securityNotification also renders it
  test('formatEmptyTable: appends securityNotification when present', () => {
    const result = makeResult({
      rows: [],
      rowCount: 0,
      metadata: {
        statement: 'SELECT',
        securityNotification: 'Security: 1 column(s) were omitted based on your blacklist'
      }
    })
    const output = formatter.format(result, { format: 'table' })
    expect(output).toContain('Rows: 0')
    expect(output).toContain('Security: 1 column(s) were omitted based on your blacklist')
    const rowsIndex = output.indexOf('Rows: 0')
    const secIndex = output.indexOf('Security: 1 column(s) were omitted')
    expect(secIndex).toBeGreaterThan(rowsIndex)
  })

  // Test 5: formatCSV() with securityNotification appends "# Security: ..." as final line
  test('formatCSV: appends comment line with securityNotification when present', () => {
    const result = makeResult({
      metadata: {
        statement: 'SELECT',
        securityNotification: 'Security: 2 column(s) were omitted based on your blacklist'
      }
    })
    const output = formatter.format(result, { format: 'csv' })
    const lines = output.split('\n')
    const lastLine = lines[lines.length - 1]
    expect(lastLine).toBe('# Security: 2 column(s) were omitted based on your blacklist')
  })

  // Test 6: formatCSV() with metadata = undefined does NOT add comment line
  test('formatCSV: no comment line when metadata is undefined', () => {
    const result = makeResult({ metadata: undefined })
    const output = formatter.format(result, { format: 'csv' })
    const lines = output.split('\n')
    const hasSecurityComment = lines.some(l => l.startsWith('# Security:'))
    expect(hasSecurityComment).toBe(false)
  })

  // Test 7: formatJSON() output is unchanged - securityNotification already in metadata
  test('formatJSON: securityNotification already present in metadata field', () => {
    const result = makeResult({
      metadata: {
        statement: 'SELECT',
        securityNotification: 'Security: 2 column(s) were omitted based on your blacklist'
      }
    })
    const output = formatter.format(result, { format: 'json' })
    const parsed = JSON.parse(output)
    expect(parsed.metadata.securityNotification).toBe(
      'Security: 2 column(s) were omitted based on your blacklist'
    )
  })

  // Test 8: formatCSV() with empty rows and securityNotification
  test('formatCSV: appends comment line for empty result with securityNotification', () => {
    const result = makeResult({
      rows: [],
      rowCount: 0,
      metadata: {
        statement: 'SELECT',
        securityNotification: 'Security: 3 column(s) were omitted based on your blacklist'
      }
    })
    const output = formatter.format(result, { format: 'csv' })
    expect(output).toContain('# Security: 3 column(s) were omitted based on your blacklist')
  })
})
