/**
 * Unit tests for table formatter
 */

import { test, expect, describe } from 'vitest'
import { TableFormatter, TableListFormatter } from '../../../src/formatters/table-formatter'
import type { ColumnSchema, TableSchema } from '../../../src/adapters/types'

describe('TableFormatter', () => {
  test('formats column schemas as ASCII table', () => {
    const formatter = new TableFormatter()
    const columns: ColumnSchema[] = [
      { name: 'id', type: 'INT', nullable: false, primaryKey: true },
      { name: 'email', type: 'VARCHAR(255)', nullable: false },
      { name: 'created_at', type: 'TIMESTAMP', nullable: false, default: 'CURRENT_TIMESTAMP' }
    ]

    const result = formatter.format(columns)

    expect(result).toContain('Column')
    expect(result).toContain('Type')
    expect(result).toContain('id')
    expect(result).toContain('INT')
    expect(result).toContain('email')
    expect(result).toContain('VARCHAR')
    expect(result).toContain('PK')
  })

  test('shows foreign key references in format "FK → table.column"', () => {
    const formatter = new TableFormatter()
    const columns: ColumnSchema[] = [
      {
        name: 'user_id',
        type: 'INT',
        nullable: false,
        foreignKey: { table: 'users', column: 'id' }
      }
    ]

    const result = formatter.format(columns)

    expect(result).toContain('FK → users.id')
  })

  test('handles columns with no default value as NULL', () => {
    const formatter = new TableFormatter()
    const columns: ColumnSchema[] = [
      { name: 'optional_field', type: 'VARCHAR(100)', nullable: true }
    ]

    const result = formatter.format(columns)

    expect(result).toContain('NULL')
    expect(result).toContain('YES')
  })

  test('displays nullable=false as NO', () => {
    const formatter = new TableFormatter()
    const columns: ColumnSchema[] = [
      { name: 'id', type: 'INT', nullable: false }
    ]

    const result = formatter.format(columns)

    expect(result).toContain('NO')
  })
})

describe('TableListFormatter', () => {
  test('formats table list with metadata', () => {
    const formatter = new TableListFormatter()
    const tables: TableSchema[] = [
      {
        name: 'users',
        columns: [
          { name: 'id', type: 'INT', nullable: false },
          { name: 'email', type: 'VARCHAR(255)', nullable: false }
        ],
        rowCount: 1000,
        engine: 'InnoDB'
      }
    ]

    const result = formatter.format(tables)

    expect(result).toContain('Table')
    expect(result).toContain('Columns')
    expect(result).toContain('Rows')
    expect(result).toContain('users')
    expect(result).toContain('2')
    expect(result).toContain('1000')
    expect(result).toContain('InnoDB')
  })

  test('shows ? for missing row count', () => {
    const formatter = new TableListFormatter()
    const tables: TableSchema[] = [
      {
        name: 'products',
        columns: [{ name: 'id', type: 'INT', nullable: false }]
      }
    ]

    const result = formatter.format(tables)

    expect(result).toContain('products')
    expect(result).toContain('?')
  })
})
