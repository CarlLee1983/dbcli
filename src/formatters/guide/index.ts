// src/formatters/guide/index.ts
import type { MissingIndexReport } from '@/core/guide/missing-index/types'
import { formatMissingIndexYaml } from './missing-index-yaml'
import { formatMissingIndexJson } from './missing-index-json'
import { formatMissingIndexMarkdown } from './missing-index-markdown'

export type MissingIndexFormat = 'yaml' | 'json' | 'markdown'

export function formatMissingIndex(report: MissingIndexReport, format: MissingIndexFormat): string {
  switch (format) {
    case 'json':
      return formatMissingIndexJson(report)
    case 'markdown':
      return formatMissingIndexMarkdown(report)
    case 'yaml':
    default:
      return formatMissingIndexYaml(report)
  }
}
