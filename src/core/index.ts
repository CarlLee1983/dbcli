/**
 * 核心模組索引
 * 從此處匯出所有核心功能和引擎
 */

export { SchemaDiffEngine } from './schema-diff'
export { SkillGenerator } from './skill-generator'
export { SchemaLayeredLoader } from './schema-loader'
export { SchemaIndexBuilder } from './schema-index'
export { SchemaCacheManager } from './schema-cache'

// Re-export type definitions
export type { SchemaIndex, CacheStats, LoaderOptions, TableSchemaRef } from '@/types/schema-cache'

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
