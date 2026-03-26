/**
 * Unit tests for JSON formatter
 */

import { test, expect, describe } from 'vitest'
import { JSONFormatter, TableSchemaJSONFormatter } from '../../../src/formatters/json-formatter'
import type { ColumnSchema, TableSchema } from '../../../src/adapters/types'

describe('JSONFormatter', () => {
  test('formats column array as valid JSON', () => {
    const formatter = new JSONFormatter()
    const columns: ColumnSchema[] = [
      { name: 'id', type: 'INT', nullable: false, primaryKey: true },
      { name: 'email', type: 'VARCHAR(255)', nullable: false }
    ]

    const result = formatter.format(columns)
    const parsed = JSON.parse(result)

    expect(Array.isArray(parsed)).toBe(true)
    expect(parsed.length).toBe(2)
    expect(parsed[0].name).toBe('id')
    expect(parsed[0].primaryKey).toBe(true)
  })

  test('pretty-prints JSON by default (spacing: 2)', () => {
    const formatter = new JSONFormatter()
    const data: ColumnSchema[] = [{ name: 'id', type: 'INT', nullable: false }]

    const result = formatter.format(data)

    expect(result).toContain('\n')
    expect(result).toContain('  ')
  })

  test('produces compact JSON with compact option', () => {
    const formatter = new JSONFormatter()
    const data: ColumnSchema[] = [{ name: 'id', type: 'INT', nullable: false }]

    const result = formatter.format(data, { compact: true })

    // Compact JSON has no indentation
    const lines = result.split('\n').filter(l => l.trim())
    expect(lines.length).toBeLessThanOrEqual(2)
  })

  test('preserves foreign key metadata in JSON', () => {
    const formatter = new JSONFormatter()
    const columns: ColumnSchema[] = [
      {
        name: 'user_id',
        type: 'INT',
        nullable: false,
        foreignKey: { table: 'users', column: 'id' }
      }
    ]

    const result = formatter.format(columns)
    const parsed = JSON.parse(result)

    expect(parsed[0].foreignKey.table).toBe('users')
    expect(parsed[0].foreignKey.column).toBe('id')
  })
})

describe('TableSchemaJSONFormatter', () => {
  test('formats single table schema with metadata', () => {
    const formatter = new TableSchemaJSONFormatter()
    const schema: TableSchema = {
      name: 'users',
      columns: [
        { name: 'id', type: 'INT', nullable: false, primaryKey: true }
      ],
      rowCount: 500,
      engine: 'InnoDB',
      primaryKey: ['id'],
      foreignKeys: []
    }

    const result = formatter.format(schema)
    const parsed = JSON.parse(result)

    expect(parsed.name).toBe('users')
    expect(parsed.columns.length).toBe(1)
    expect(parsed.primaryKey).toEqual(['id'])
    expect(parsed.metadata.rowCount).toBe(500)
    expect(parsed.metadata.engine).toBe('InnoDB')
  })

  test('includes new fields: estimatedRowCount, sizeCategory, tableType, indexes', () => {
    const formatter = new TableSchemaJSONFormatter()
    const schema: TableSchema = {
      name: 'large_table',
      columns: [
        { name: 'id', type: 'INT', nullable: false, primaryKey: true }
      ],
      estimatedRowCount: 150000,
      tableType: 'table',
      indexes: [
        { name: 'idx_id', columns: ['id'] }
      ],
      rowCount: 150000,
      engine: 'InnoDB',
      primaryKey: ['id'],
      foreignKeys: []
    }

    const result = formatter.format(schema)
    const parsed = JSON.parse(result)

    expect(parsed.estimatedRowCount).toBe(150000)
    expect(parsed.sizeCategory).toBe('large')
    expect(parsed.tableType).toBe('table')
    expect(Array.isArray(parsed.indexes)).toBe(true)
    expect(parsed.indexes.length).toBe(1)
    expect(parsed.indexes[0].name).toBe('idx_id')
  })

  test('calculates sizeCategory based on estimatedRowCount', () => {
    const formatter = new TableSchemaJSONFormatter()

    const mediumSchema: TableSchema = {
      name: 'medium',
      columns: [],
      estimatedRowCount: 25000,
      tableType: 'table'
    }

    const result = formatter.format(mediumSchema)
    const parsed = JSON.parse(result)

    expect(parsed.sizeCategory).toBe('medium')
  })

  test('defaults estimatedRowCount to rowCount when not provided', () => {
    const formatter = new TableSchemaJSONFormatter()
    const schema: TableSchema = {
      name: 'legacy',
      columns: [],
      rowCount: 15000,
      tableType: 'view'
    }

    const result = formatter.format(schema)
    const parsed = JSON.parse(result)

    expect(parsed.estimatedRowCount).toBe(15000)
    expect(parsed.sizeCategory).toBe('medium')
  })

  test('handles missing estimatedRowCount and rowCount gracefully', () => {
    const formatter = new TableSchemaJSONFormatter()
    const schema: TableSchema = {
      name: 'unknown',
      columns: []
    }

    const result = formatter.format(schema)
    const parsed = JSON.parse(result)

    expect(parsed.estimatedRowCount).toBeNull()
    expect(parsed.sizeCategory).toBeNull()
    expect(parsed.tableType).toBe('table')
  })

  test('includes empty arrays for missing constraints', () => {
    const formatter = new TableSchemaJSONFormatter()
    const schema: TableSchema = {
      name: 'simple',
      columns: [{ name: 'col', type: 'TEXT', nullable: true }]
    }

    const result = formatter.format(schema)
    const parsed = JSON.parse(result)

    expect(Array.isArray(parsed.primaryKey)).toBe(true)
    expect(Array.isArray(parsed.foreignKeys)).toBe(true)
  })

  test('preserves foreign key constraint metadata', () => {
    const formatter = new TableSchemaJSONFormatter()
    const schema: TableSchema = {
      name: 'orders',
      columns: [
        { name: 'id', type: 'INT', nullable: false, primaryKey: true },
        {
          name: 'user_id',
          type: 'INT',
          nullable: false,
          foreignKey: { table: 'users', column: 'id' }
        }
      ],
      foreignKeys: [
        {
          name: 'fk_orders_user_id',
          columns: ['user_id'],
          refTable: 'users',
          refColumns: ['id']
        }
      ]
    }

    const result = formatter.format(schema)
    const parsed = JSON.parse(result)

    expect(parsed.foreignKeys.length).toBe(1)
    expect(parsed.foreignKeys[0].refTable).toBe('users')
    expect(parsed.foreignKeys[0].refColumns).toContain('id')
  })
})
