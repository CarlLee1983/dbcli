// src/formatters/guide/missing-index-json.ts
import type { MissingIndexReport } from '@/core/guide/missing-index/types'

export function formatMissingIndexJson(report: MissingIndexReport): string {
  return JSON.stringify({ schemaVersion: 1, ...report }, null, 2)
}
