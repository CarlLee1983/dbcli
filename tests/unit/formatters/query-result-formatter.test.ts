/**
 * Unit tests for QueryResultFormatter
 * Tests all three output formats: table, JSON, CSV
 */

import { test, expect, describe } from 'bun:test'
import { QueryResultFormatter } from '../../../src/formatters/query-result-formatter'
import type { QueryResult } from '../../../src/types/query'

describe('QueryResultFormatter - Table Format', () => {
  test('formats result as ASCII table with headers and data', () => {
    const formatter = new QueryResultFormatter()
    const result: QueryResult<{ id: number; name: string }> = {
      rows: [
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' },
        { id: 3, name: 'Charlie' }
      ],
      rowCount: 3,
      columnNames: ['id', 'name'],
      executionTimeMs: 42
    }

    const output = formatter.format(result, { format: 'table' })

    expect(output).toContain('id')
    expect(output).toContain('name')
    expect(output).toContain('Alice')
    expect(output).toContain('Bob')
    expect(output).toContain('Charlie')
    expect(output).toContain('Rows: 3')
    expect(output).toContain('Execution time: 42ms')
  })

  test('formats empty result set with headers and row count', () => {
    const formatter = new QueryResultFormatter()
    const result: QueryResult<Record<string, any>> = {
      rows: [],
      rowCount: 0,
      columnNames: ['id', 'email'],
      executionTimeMs: 5
    }

    const output = formatter.format(result, { format: 'table' })

    expect(output).toContain('id')
    expect(output).toContain('email')
    expect(output).toContain('Rows: 0')
  })

  test('formats single row result correctly', () => {
    const formatter = new QueryResultFormatter()
    const result: QueryResult<{ id: number; status: string }> = {
      rows: [{ id: 42, status: 'active' }],
      rowCount: 1,
      columnNames: ['id', 'status']
    }

    const output = formatter.format(result, { format: 'table' })

    expect(output).toContain('42')
    expect(output).toContain('active')
    expect(output).toContain('Rows: 1')
  })

  test('displays null values as empty strings in table', () => {
    const formatter = new QueryResultFormatter()
    const result: QueryResult<Record<string, any>> = {
      rows: [{ id: 1, name: null, email: undefined }],
      rowCount: 1,
      columnNames: ['id', 'name', 'email']
    }

    const output = formatter.format(result, { format: 'table' })

    expect(output).toContain('1')
    expect(output).not.toContain('null')
    expect(output).not.toContain('undefined')
  })

  test('includes execution time footer when provided', () => {
    const formatter = new QueryResultFormatter()
    const result: QueryResult<Record<string, any>> = {
      rows: [{ col: 'value' }],
      rowCount: 1,
      columnNames: ['col'],
      executionTimeMs: 123
    }

    const output = formatter.format(result, { format: 'table' })

    expect(output).toContain('123ms')
  })

  test('omits execution time footer when not provided', () => {
    const formatter = new QueryResultFormatter()
    const result: QueryResult<Record<string, any>> = {
      rows: [{ col: 'value' }],
      rowCount: 1,
      columnNames: ['col']
    }

    const output = formatter.format(result, { format: 'table' })

    expect(output).toContain('Rows: 1')
    expect(output).not.toContain('Execution time')
  })
})

describe('QueryResultFormatter - JSON Format', () => {
  test('formats result as valid JSON with all metadata', () => {
    const formatter = new QueryResultFormatter()
    const result: QueryResult<{ id: number; name: string }> = {
      rows: [
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' }
      ],
      rowCount: 2,
      columnNames: ['id', 'name'],
      columnTypes: ['integer', 'varchar'],
      executionTimeMs: 42,
      metadata: { statement: 'SELECT' }
    }

    const output = formatter.format(result, { format: 'json' })

    // Verify valid JSON
    const parsed = JSON.parse(output)

    expect(parsed.rows).toHaveLength(2)
    expect(parsed.rowCount).toBe(2)
    expect(parsed.columnNames).toEqual(['id', 'name'])
    expect(parsed.columnTypes).toEqual(['integer', 'varchar'])
    expect(parsed.executionTimeMs).toBe(42)
    expect(parsed.metadata.statement).toBe('SELECT')
  })

  test('includes 2-space indentation in non-compact JSON', () => {
    const formatter = new QueryResultFormatter()
    const result: QueryResult<{ id: number }> = {
      rows: [{ id: 1 }],
      rowCount: 1,
      columnNames: ['id']
    }

    const output = formatter.format(result, { format: 'json', compact: false })

    expect(output).toContain('  ')
  })

  test('omits indentation in compact JSON', () => {
    const formatter = new QueryResultFormatter()
    const result: QueryResult<{ id: number }> = {
      rows: [{ id: 1 }],
      rowCount: 1,
      columnNames: ['id']
    }

    const output = formatter.format(result, { format: 'json', compact: true })

    const lines = output.split('\n')
    expect(lines).toHaveLength(1)
  })

  test('preserves null values in JSON output', () => {
    const formatter = new QueryResultFormatter()
    const result: QueryResult<Record<string, any>> = {
      rows: [{ id: 1, name: null }],
      rowCount: 1,
      columnNames: ['id', 'name']
    }

    const output = formatter.format(result, { format: 'json' })

    const parsed = JSON.parse(output)
    expect(parsed.rows[0].name).toBeNull()
  })

  test('includes all metadata fields in JSON', () => {
    const formatter = new QueryResultFormatter()
    const result: QueryResult<Record<string, any>> = {
      rows: [{ col: 'val' }],
      rowCount: 1,
      columnNames: ['col'],
      columnTypes: ['varchar'],
      executionTimeMs: 100,
      metadata: { statement: 'INSERT', affectedRows: 1 }
    }

    const output = formatter.format(result, { format: 'json' })

    const parsed = JSON.parse(output)
    expect(parsed).toHaveProperty('rows')
    expect(parsed).toHaveProperty('rowCount')
    expect(parsed).toHaveProperty('columnNames')
    expect(parsed).toHaveProperty('columnTypes')
    expect(parsed).toHaveProperty('executionTimeMs')
    expect(parsed).toHaveProperty('metadata')
  })
})

describe('QueryResultFormatter - CSV Format', () => {
  test('formats result as CSV with headers and data rows', () => {
    const formatter = new QueryResultFormatter()
    const result: QueryResult<{ id: number; name: string }> = {
      rows: [
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' }
      ],
      rowCount: 2,
      columnNames: ['id', 'name']
    }

    const output = formatter.format(result, { format: 'csv' })

    const lines = output.split('\n')
    expect(lines[0]).toBe('id,name')
    expect(lines[1]).toBe('1,Alice')
    expect(lines[2]).toBe('2,Bob')
  })

  test('escapes commas in CSV values by wrapping in quotes', () => {
    const formatter = new QueryResultFormatter()
    const result: QueryResult<{ name: string }> = {
      rows: [{ name: 'Smith, Jr.' }],
      rowCount: 1,
      columnNames: ['name']
    }

    const output = formatter.format(result, { format: 'csv' })

    const lines = output.split('\n')
    expect(lines[1]).toBe('"Smith, Jr."')
  })

  test('escapes quotes in CSV values by doubling them', () => {
    const formatter = new QueryResultFormatter()
    const result: QueryResult<{ name: string }> = {
      rows: [{ name: 'Jane "Doc" Doe' }],
      rowCount: 1,
      columnNames: ['name']
    }

    const output = formatter.format(result, { format: 'csv' })

    const lines = output.split('\n')
    expect(lines[1]).toBe('"Jane ""Doc"" Doe"')
  })

  test('escapes newlines in CSV values by wrapping in quotes', () => {
    const formatter = new QueryResultFormatter()
    const result: QueryResult<{ description: string }> = {
      rows: [{ description: 'Line 1\nLine 2' }],
      rowCount: 1,
      columnNames: ['description']
    }

    const output = formatter.format(result, { format: 'csv' })

    const lines = output.split('\n')
    expect(lines[1]).toContain('"Line 1')
  })

  test('handles null values as empty strings in CSV', () => {
    const formatter = new QueryResultFormatter()
    const result: QueryResult<Record<string, any>> = {
      rows: [{ id: 1, name: null, email: undefined }],
      rowCount: 1,
      columnNames: ['id', 'name', 'email']
    }

    const output = formatter.format(result, { format: 'csv' })

    const lines = output.split('\n')
    expect(lines[1]).toBe('1,,')
  })

  test('handles numbers in CSV correctly', () => {
    const formatter = new QueryResultFormatter()
    const result: QueryResult<Record<string, any>> = {
      rows: [{ id: 42, price: 19.99, quantity: 100 }],
      rowCount: 1,
      columnNames: ['id', 'price', 'quantity']
    }

    const output = formatter.format(result, { format: 'csv' })

    const lines = output.split('\n')
    expect(lines[1]).toBe('42,19.99,100')
  })

  test('formats empty result set as CSV with headers only', () => {
    const formatter = new QueryResultFormatter()
    const result: QueryResult<Record<string, any>> = {
      rows: [],
      rowCount: 0,
      columnNames: ['id', 'name', 'email']
    }

    const output = formatter.format(result, { format: 'csv' })

    expect(output).toBe('id,name,email')
  })

  test('handles multiple special characters in single cell', () => {
    const formatter = new QueryResultFormatter()
    const result: QueryResult<{ address: string }> = {
      rows: [{ address: 'Smith, "Dr." Jones\nApt. 5' }],
      rowCount: 1,
      columnNames: ['address']
    }

    const output = formatter.format(result, { format: 'csv' })

    const lines = output.split('\n')
    // Should be quoted and internal quotes doubled
    expect(lines[1]).toContain('"')
    expect(lines[1]).toContain('""')
  })

  test('preserves special characters in unquoted values', () => {
    const formatter = new QueryResultFormatter()
    const result: QueryResult<{ email: string }> = {
      rows: [{ email: 'user@example.com' }],
      rowCount: 1,
      columnNames: ['email']
    }

    const output = formatter.format(result, { format: 'csv' })

    const lines = output.split('\n')
    expect(lines[1]).toBe('user@example.com')
  })
})

describe('QueryResultFormatter - Default and Edge Cases', () => {
  test('defaults to table format when format not specified', () => {
    const formatter = new QueryResultFormatter()
    const result: QueryResult<{ col: string }> = {
      rows: [{ col: 'value' }],
      rowCount: 1,
      columnNames: ['col']
    }

    const output = formatter.format(result)

    expect(output).toContain('col')
    expect(output).toContain('value')
    expect(output).toContain('Rows: 1')
  })

  test('handles large numbers correctly', () => {
    const formatter = new QueryResultFormatter()
    const result: QueryResult<{ count: number }> = {
      rows: [{ count: 999999999 }],
      rowCount: 1,
      columnNames: ['count']
    }

    const output = formatter.format(result, { format: 'csv' })

    expect(output).toContain('999999999')
  })

  test('handles Unicode characters correctly', () => {
    const formatter = new QueryResultFormatter()
    const result: QueryResult<{ name: string }> = {
      rows: [{ name: '你好世界' }],
      rowCount: 1,
      columnNames: ['name']
    }

    const output = formatter.format(result, { format: 'csv' })

    expect(output).toContain('你好世界')
  })

  test('handles boolean values in table format', () => {
    const formatter = new QueryResultFormatter()
    const result: QueryResult<{ active: boolean }> = {
      rows: [{ active: true }],
      rowCount: 1,
      columnNames: ['active']
    }

    const output = formatter.format(result, { format: 'table' })

    expect(output).toContain('true')
  })

  test('handles JSON objects in cells', () => {
    const formatter = new QueryResultFormatter()
    const result: QueryResult<Record<string, any>> = {
      rows: [{ data: { key: 'value' } }],
      rowCount: 1,
      columnNames: ['data']
    }

    const output = formatter.format(result, { format: 'table' })

    expect(output).toContain('{"key":"value"}')
  })

  test('handles many columns correctly', () => {
    const formatter = new QueryResultFormatter()
    const cols = Array.from({ length: 10 }, (_, i) => `col${i}`)
    const row = cols.reduce((acc, col) => ({ ...acc, [col]: `val${col}` }), {})

    const result: QueryResult<Record<string, any>> = {
      rows: [row],
      rowCount: 1,
      columnNames: cols
    }

    const output = formatter.format(result, { format: 'csv' })

    cols.forEach(col => {
      expect(output).toContain(col)
    })
  })

  test('handles many rows correctly', () => {
    const formatter = new QueryResultFormatter()
    const rows = Array.from({ length: 100 }, (_, i) => ({ id: i, value: `row${i}` }))

    const result: QueryResult<{ id: number; value: string }> = {
      rows,
      rowCount: 100,
      columnNames: ['id', 'value']
    }

    const output = formatter.format(result, { format: 'json' })

    const parsed = JSON.parse(output)
    expect(parsed.rows).toHaveLength(100)
    expect(parsed.rowCount).toBe(100)
  })
})
