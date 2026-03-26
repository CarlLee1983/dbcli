/**
 * Column Index Builder - Unit Tests
 */

import { test, expect } from 'bun:test'
import { ColumnIndexBuilder } from './column-index'
import type { TableSchema } from '@/adapters/types'

const mockSchemas: Record<string, TableSchema> = {
  users: {
    name: 'users',
    columns: [
      { name: 'id', type: 'integer', nullable: false, primaryKey: true, default: null },
      { name: 'email', type: 'varchar', nullable: false, primaryKey: false, default: null },
      { name: 'name', type: 'varchar', nullable: true, primaryKey: false, default: null }
    ]
  },
  products: {
    name: 'products',
    columns: [
      { name: 'id', type: 'integer', nullable: false, primaryKey: true, default: null },
      { name: 'name', type: 'varchar', nullable: false, primaryKey: false, default: null },
      { name: 'price', type: 'decimal', nullable: false, primaryKey: false, default: null }
    ]
  }
}

test('ColumnIndexBuilder - builds index correctly', () => {
  const builder = new ColumnIndexBuilder()
  const index = builder.build(mockSchemas)

  expect(index.totalTables).toBe(2)
  expect(index.totalColumns).toBe(4) // Unique column names: id, email, name, price
  expect(index.columns.size).toBe(4) // Unique column names
})

test('ColumnIndexBuilder - finds column O(1)', () => {
  const builder = new ColumnIndexBuilder()
  builder.build(mockSchemas)

  const results = builder.findColumn('email')

  expect(results).toHaveLength(1)
  expect(results[0].tableName).toBe('users')
  expect(results[0].column.type).toBe('varchar')
})

test('ColumnIndexBuilder - finds duplicate column names', () => {
  const builder = new ColumnIndexBuilder()
  builder.build(mockSchemas)

  const results = builder.findColumn('name')

  expect(results.length).toBeGreaterThan(1) // In users and products
  expect(results.map(r => r.tableName).sort()).toEqual(['products', 'users'])
})

test('ColumnIndexBuilder - returns empty for nonexistent column', () => {
  const builder = new ColumnIndexBuilder()
  builder.build(mockSchemas)

  const results = builder.findColumn('nonexistent')

  expect(results).toHaveLength(0)
})

test('ColumnIndexBuilder - finds columns by pattern', () => {
  const builder = new ColumnIndexBuilder()
  builder.build(mockSchemas)

  const results = builder.findColumnsMatching('id')

  expect(results.length).toBeGreaterThan(0)
  expect(results.some(r => r.columnName.toLowerCase().includes('id'))).toBe(true)
})

test('ColumnIndexBuilder - gets table columns', () => {
  const builder = new ColumnIndexBuilder()
  builder.build(mockSchemas)

  const results = builder.getTableColumns('users')

  expect(results).toHaveLength(3)
  expect(results.map(c => c.name).sort()).toEqual(['email', 'id', 'name'])
})

test('ColumnIndexBuilder - finds columns by type', () => {
  const builder = new ColumnIndexBuilder()
  builder.build(mockSchemas)

  const results = builder.findColumnsByType('integer')

  expect(results.length).toBeGreaterThanOrEqual(2)
  expect(results.every(r => r.column.type === 'integer')).toBe(true)
})

test('ColumnIndexBuilder - finds primary keys', () => {
  const builder = new ColumnIndexBuilder()
  builder.build(mockSchemas)

  const results = builder.findPrimaryKeys()

  expect(results).toHaveLength(2) // id in users and products
  expect(results.every(r => r.column.primaryKey)).toBe(true)
})

test('ColumnIndexBuilder - finds nullable columns', () => {
  const builder = new ColumnIndexBuilder()
  builder.build(mockSchemas)

  const results = builder.findNullableColumns()

  expect(results.length).toBeGreaterThan(0)
  expect(results.every(r => r.column.nullable)).toBe(true)
})

test('ColumnIndexBuilder - gets statistics', () => {
  const builder = new ColumnIndexBuilder()
  builder.build(mockSchemas)

  const stats = builder.getStats()

  expect(stats.totalColumns).toBe(4) // Unique column names
  expect(stats.totalTables).toBe(2)
  expect(stats.uniqueColumnNames).toBe(4)
  expect(stats.averageTablesPerColumn).toBeGreaterThan(0)
})

test('ColumnIndexBuilder - export and import', () => {
  const builder = new ColumnIndexBuilder()
  builder.build(mockSchemas)

  const exported = builder.export()
  expect(exported.totalTables).toBe(2)
  expect(exported.totalColumns).toBe(4) // Unique column names

  const builder2 = new ColumnIndexBuilder()
  builder2.import(exported)

  const results = builder2.findColumn('email')
  expect(results).toHaveLength(1)
})

test('ColumnIndexBuilder - case insensitive lookup', () => {
  const builder = new ColumnIndexBuilder()
  builder.build(mockSchemas)

  const resultsLower = builder.findColumn('email')
  const resultsUpper = builder.findColumn('EMAIL')
  const resultsMixed = builder.findColumn('Email')

  expect(resultsLower).toEqual(resultsUpper)
  expect(resultsLower).toEqual(resultsMixed)
})
