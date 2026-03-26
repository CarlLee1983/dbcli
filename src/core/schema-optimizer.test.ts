/**
 * Schema Optimizer - Unit Tests
 */

import { test, expect } from 'bun:test'
import { SchemaOptimizer } from './schema-optimizer'
import type { TableSchema } from '@/adapters/types'

const wellFormedSchemas: Record<string, TableSchema> = {
  users: {
    name: 'users',
    columns: [
      { name: 'id', type: 'integer', nullable: false, primaryKey: true, default: null },
      { name: 'email', type: 'varchar', nullable: false, primaryKey: false, default: null },
      { name: 'name', type: 'varchar', nullable: true, primaryKey: false, default: null }
    ]
  },
  posts: {
    name: 'posts',
    columns: [
      { name: 'id', type: 'integer', nullable: false, primaryKey: true, default: null },
      { name: 'userId', type: 'integer', nullable: false, primaryKey: false, default: null },
      { name: 'title', type: 'varchar', nullable: false, primaryKey: false, default: null },
      { name: 'content', type: 'text', nullable: true, primaryKey: false, default: null }
    ]
  }
}

const problematicSchemas: Record<string, TableSchema> = {
  wide_table: {
    name: 'wide_table',
    columns: Array.from({ length: 60 }, (_, i) => ({
      name: `col_${i}`,
      type: 'varchar',
      nullable: true,
      primaryKey: false,
      default: null
    }))
  },
  no_pk_table: {
    name: 'no_pk_table',
    columns: [
      { name: 'col1', type: 'varchar', nullable: false, primaryKey: false, default: null },
      { name: 'col2', type: 'integer', nullable: true, primaryKey: false, default: null }
    ]
  }
}

test('SchemaOptimizer - analyzes well-formed schema', () => {
  const optimizer = new SchemaOptimizer()
  const report = optimizer.analyzeSchema(wellFormedSchemas)

  expect(report.totalTables).toBe(2)
  expect(report.totalColumns).toBe(7) // 3 from users + 4 from posts
  expect(report.averageColumnsPerTable).toBeGreaterThan(0)
  expect(report.issues.length).toBeLessThanOrEqual(1) // Should have few issues
})

test('SchemaOptimizer - detects wide tables', () => {
  const optimizer = new SchemaOptimizer()
  const report = optimizer.analyzeSchema(problematicSchemas)

  const wideTableIssues = report.issues.filter(i => i.type === 'wide-table')
  expect(wideTableIssues.length).toBeGreaterThan(0)
  expect(wideTableIssues[0].table).toBe('wide_table')
})

test('SchemaOptimizer - detects missing primary keys', () => {
  const optimizer = new SchemaOptimizer()
  const report = optimizer.analyzeSchema(problematicSchemas)

  const pkIssues = report.issues.filter(i => i.type === 'no-primary-key')
  expect(pkIssues.length).toBeGreaterThan(0)
  expect(pkIssues.some(i => i.table === 'no_pk_table')).toBe(true)
})

test('SchemaOptimizer - tracks metrics correctly', () => {
  const optimizer = new SchemaOptimizer()
  const report = optimizer.analyzeSchema(wellFormedSchemas)

  expect(report.metrics.maxColumnsInTable).toBe(4) // posts has 4 columns
  expect(report.metrics.tableWithMostColumns).toBe('posts')
  expect(report.metrics.maxColumnNameLength).toBeGreaterThan(0)
  expect(report.metrics.averageColumnNameLength).toBeGreaterThan(0)
})

test('SchemaOptimizer - recommends hot tables', () => {
  const optimizer = new SchemaOptimizer()
  const report = optimizer.analyzeSchema(wellFormedSchemas)

  expect(report.cacheRecommendations.recommendedHotTables.length).toBeGreaterThan(0)
  expect(report.cacheRecommendations.recommendedHotTables).toContain('users')
})

test('SchemaOptimizer - generates suggestions', () => {
  const optimizer = new SchemaOptimizer()

  // Good schema
  let report = optimizer.analyzeSchema(wellFormedSchemas)
  let suggestions = optimizer.getSuggestions(report)
  expect(suggestions.length).toBeGreaterThan(0)

  // Problematic schema
  report = optimizer.analyzeSchema(problematicSchemas)
  suggestions = optimizer.getSuggestions(report)
  expect(suggestions.length).toBeGreaterThan(0)
  expect(suggestions.some(s => s.includes('primary key'))).toBe(true)
})

test('SchemaOptimizer - estimates schema size', () => {
  const optimizer = new SchemaOptimizer()

  const size = optimizer.estimateSchemaSize(wellFormedSchemas)

  expect(size).toBeGreaterThan(0)
  expect(typeof size).toBe('number')
})

test('SchemaOptimizer - detects all nullable tables', () => {
  const allNullableSchemas: Record<string, TableSchema> = {
    all_nullable: {
      name: 'all_nullable',
      columns: [
        { name: 'col1', type: 'varchar', nullable: true, primaryKey: false, default: null },
        { name: 'col2', type: 'integer', nullable: true, primaryKey: false, default: null }
      ]
    }
  }

  const optimizer = new SchemaOptimizer()
  const report = optimizer.analyzeSchema(allNullableSchemas)

  const nullableIssues = report.issues.filter(i => i.type === 'all-nullable')
  expect(nullableIssues.length).toBeGreaterThan(0)
})

test('SchemaOptimizer - detects empty tables', () => {
  const emptySchemas: Record<string, TableSchema> = {
    empty: {
      name: 'empty',
      columns: []
    }
  }

  const optimizer = new SchemaOptimizer()
  const report = optimizer.analyzeSchema(emptySchemas)

  const emptyIssues = report.issues.filter(i => i.type === 'empty-table')
  expect(emptyIssues.length).toBeGreaterThan(0)
})

test('SchemaOptimizer - handles empty schemas', () => {
  const optimizer = new SchemaOptimizer()
  const report = optimizer.analyzeSchema({})

  expect(report.totalTables).toBe(0)
  expect(report.totalColumns).toBe(0)
  expect(report.issues.length).toBe(0)
})
