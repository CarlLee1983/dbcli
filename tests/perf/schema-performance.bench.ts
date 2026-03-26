/**
 * Schema System Performance Benchmarks
 *
 * Measures performance of schema operations across the system:
 * - Schema refresh operations
 * - Column indexing
 * - Cache operations
 * - File I/O
 */

import { ColumnIndexBuilder } from '@/core/column-index'
import { SchemaOptimizer } from '@/core/schema-optimizer'
import { AtomicFileWriter } from '@/core/atomic-writer'
import type { TableSchema } from '@/adapters/types'
import { tmpdir } from 'os'
import { join } from 'path'

/**
 * Generate mock schemas for benchmarking
 */
function generateMockSchemas(tableCount: number, columnsPerTable: number): Record<string, TableSchema> {
  const schemas: Record<string, TableSchema> = {}

  for (let t = 0; t < tableCount; t++) {
    const tableName = `table_${t}`
    const columns = []

    for (let c = 0; c < columnsPerTable; c++) {
      const isId = c === 0
      columns.push({
        name: isId ? 'id' : `column_${c}`,
        type: isId ? 'integer' : c % 3 === 0 ? 'varchar' : c % 3 === 1 ? 'integer' : 'decimal',
        nullable: !isId,
        primaryKey: isId,
        default: null
      })
    }

    schemas[tableName] = {
      name: tableName,
      columns
    }
  }

  return schemas
}

/**
 * Benchmark: Column index building
 *
 * Tests O(n*m) → O(1) transformation
 */
async function benchmarkColumnIndexing() {
  console.log('\n=== Column Index Building ===')

  const testSizes = [
    { tables: 10, columns: 20 },
    { tables: 50, columns: 30 },
    { tables: 100, columns: 50 }
  ]

  for (const { tables, columns } of testSizes) {
    const schemas = generateMockSchemas(tables, columns)
    const builder = new ColumnIndexBuilder()

    const start = performance.now()
    const index = builder.build(schemas)
    const elapsed = performance.now() - start

    // Measure lookup performance
    const lookupStart = performance.now()
    for (let i = 0; i < 1000; i++) {
      builder.findColumn('column_10')
    }
    const lookupElapsed = performance.now() - lookupStart

    console.log(
      `Build: ${tables}t × ${columns}c = ${elapsed.toFixed(2)}ms, ` +
      `Lookup (1000x): ${(lookupElapsed / 1000).toFixed(3)}ms/call`
    )
  }
}

/**
 * Benchmark: Schema optimization analysis
 *
 * Tests schema analysis performance
 */
async function benchmarkSchemaOptimization() {
  console.log('\n=== Schema Optimization Analysis ===')

  const testSizes = [
    { tables: 10, columns: 20 },
    { tables: 50, columns: 30 },
    { tables: 100, columns: 50 }
  ]

  for (const { tables, columns } of testSizes) {
    const schemas = generateMockSchemas(tables, columns)
    const optimizer = new SchemaOptimizer()

    const start = performance.now()
    const report = optimizer.analyzeSchema(schemas)
    const elapsed = performance.now() - start

    const suggestions = optimizer.getSuggestions(report)

    console.log(
      `Analysis: ${tables}t × ${columns}c = ${elapsed.toFixed(2)}ms, ` +
      `Issues: ${report.issues.length}, Suggestions: ${suggestions.length}`
    )
  }
}

/**
 * Benchmark: Atomic file writing
 *
 * Tests file I/O performance with atomic operations
 */
async function benchmarkAtomicFileWriter() {
  console.log('\n=== Atomic File Writing ===')

  const testDir = join(tmpdir(), `bench-atomic-${Date.now()}`)
  await Bun.spawn(['mkdir', '-p', testDir]).exited

  const writer = new AtomicFileWriter()
  const fileSizes = [1024, 10 * 1024, 100 * 1024] // 1KB, 10KB, 100KB

  for (const size of fileSizes) {
    const content = 'x'.repeat(size)
    const filePath = join(testDir, `test-${size}.json`)

    const start = performance.now()
    await writer.write(filePath, content, { createBackup: true })
    const elapsed = performance.now() - start

    console.log(
      `Write: ${(size / 1024).toFixed(1)}KB (with backup) = ${elapsed.toFixed(2)}ms`
    )
  }

  // Cleanup
  await Bun.spawn(['rm', '-rf', testDir]).exited
}

/**
 * Benchmark: Index lookups by pattern
 *
 * Tests pattern matching performance
 */
async function benchmarkPatternMatching() {
  console.log('\n=== Pattern Matching (Index) ===')

  const schemas = generateMockSchemas(50, 30)
  const builder = new ColumnIndexBuilder()
  builder.build(schemas)

  // Warm up
  builder.findColumnsMatching('column')

  const patterns = ['column_1', 'id', 'column_[0-9]+']
  for (const pattern of patterns) {
    const start = performance.now()
    for (let i = 0; i < 100; i++) {
      builder.findColumnsMatching(pattern)
    }
    const elapsed = performance.now() - start

    console.log(
      `Pattern: "${pattern}" (100 iterations) = ${(elapsed / 100).toFixed(3)}ms/call`
    )
  }
}

/**
 * Benchmark: Type-based column lookups
 *
 * Tests performance of finding columns by type
 */
async function benchmarkTypeBasedLookups() {
  console.log('\n=== Type-Based Column Lookups ===')

  const schemas = generateMockSchemas(100, 50)
  const builder = new ColumnIndexBuilder()
  builder.build(schemas)

  const types = ['integer', 'varchar', 'decimal']
  for (const type of types) {
    const start = performance.now()
    for (let i = 0; i < 100; i++) {
      builder.findColumnsByType(type)
    }
    const elapsed = performance.now() - start

    const results = builder.findColumnsByType(type)
    console.log(
      `Type: "${type}" (100 iterations) = ${(elapsed / 100).toFixed(3)}ms/call, ` +
      `Found: ${results.length}`
    )
  }
}

/**
 * Run all benchmarks
 */
async function runBenchmarks() {
  console.log('🚀 Schema Performance Benchmarks')
  console.log('='.repeat(50))

  await benchmarkColumnIndexing()
  await benchmarkSchemaOptimization()
  await benchmarkAtomicFileWriter()
  await benchmarkPatternMatching()
  await benchmarkTypeBasedLookups()

  console.log('\n' + '='.repeat(50))
  console.log('✅ Benchmarks Complete')
}

// Run if executed directly
if (import.meta.main) {
  await runBenchmarks()
}
