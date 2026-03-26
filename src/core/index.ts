/**
 * 核心模組索引
 * 從此處匯出所有核心功能和引擎
 *
 * Wave 1: Schema Infrastructure (已完成)
 * Wave 2: Incremental Updates & Atomic Writing
 * Wave 3: Concurrent Safety & Error Recovery
 * Wave 4: Performance Optimization & Indexing
 * Wave 5: Integration & Testing
 */

// Wave 1 exports
export { SchemaDiffEngine } from './schema-diff'
export { SkillGenerator } from './skill-generator'
export { SchemaLayeredLoader } from './schema-loader'
export { SchemaIndexBuilder } from './schema-index'
export { SchemaCacheManager } from './schema-cache'

// Wave 2 exports - Incremental updates & atomic writing
export { SchemaUpdater } from './schema-updater'
export { AtomicFileWriter } from './atomic-writer'

// Wave 3 exports - Concurrent safety & error recovery
export { ConcurrentLockManager } from './concurrent-lock'
export { ErrorRecoveryManager } from './error-recovery'

// Wave 4 exports - Performance optimization & indexing
export { ColumnIndexBuilder } from './column-index'
export { SchemaOptimizer } from './schema-optimizer'

// Re-export type definitions
export type { SchemaIndex, CacheStats, LoaderOptions, TableSchemaRef } from '@/types/schema-cache'
export type { SchemaPatch, SchemaRefreshResult, RefreshOptions, WriteResult, AtomicWriteOptions } from '@/types/schema-updater'
export type { ColumnIndexEntry, ColumnIndexMap } from '@/core/column-index'
export type { OptimizationIssue, SchemaReport } from '@/core/schema-optimizer'
export type { RecoveryPoint, RecoveryState } from '@/core/error-recovery'

/**
 * Convenience function to initialize the schema system
 * Usage: const { loader, cache, index } = await initializeSchemaSystem(dbcliPath)
 */
export async function initializeSchemaSystem(
  dbcliPath: string,
  options?: import('@/types/schema-cache').LoaderOptions
) {
  const loader = new SchemaLayeredLoader(dbcliPath, options)
  const { cache, index, loadTime } = await loader.initialize()

  if (loadTime > 100) {
    console.warn(`Schema initialization took ${loadTime.toFixed(2)}ms (target: < 100ms)`)
  }

  return { loader, cache, index, loadTime }
}
