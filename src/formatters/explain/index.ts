/** EXPLAIN formatter dispatcher by --format flag. */

import type { ExplainPlan } from '@/core/explain/types'
import { formatExplainJson } from './json'
import { formatExplainMarkdown } from './markdown'
import { formatExplainTable } from './table'

export type ExplainFormat = 'markdown' | 'json' | 'table'

export function formatExplain(plans: ExplainPlan[], format: ExplainFormat): string {
  switch (format) {
    case 'json':
      return formatExplainJson(plans)
    case 'markdown':
      return formatExplainMarkdown(plans)
    case 'table':
      return formatExplainTable(plans)
    default:
      throw new Error(`Unknown explain format: '${format as string}'`)
  }
}

export { formatExplainJson, formatExplainMarkdown, formatExplainTable }
