// src/core/guide/missing-index/index-introspector.ts
/**
 * Existing-index introspection. Wraps adapter.getTableSchema and normalizes the
 * optional `indexes` field into ExistingIndex[]. Any per-table failure degrades
 * to [] so a single missing/locked table never aborts the whole analysis.
 */

import type { DatabaseAdapter } from '@/adapters/types'
import type { ExistingIndex } from './types'

export function makeIndexIntrospector(
  adapter: DatabaseAdapter
): (table: string) => Promise<ExistingIndex[]> {
  return async (table: string): Promise<ExistingIndex[]> => {
    try {
      const schema = await adapter.getTableSchema(table)
      const indexes = schema.indexes ?? []
      return indexes.map((i) => ({
        name: i.name,
        columns: [...i.columns],
        unique: Boolean(i.unique),
      }))
    } catch {
      return []
    }
  }
}
