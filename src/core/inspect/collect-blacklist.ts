import type { BlacklistConfig } from '@/types/blacklist'
import type { BlacklistSection } from './types'

export function collectBlacklist(
  blacklist: Partial<BlacklistConfig> | undefined
): BlacklistSection {
  if (!blacklist) return { tables: 0, columnRules: 0 }
  const tables = Array.isArray(blacklist.tables) ? blacklist.tables.length : 0
  let columnRules = 0
  if (
    blacklist.columns &&
    typeof blacklist.columns === 'object' &&
    !Array.isArray(blacklist.columns)
  ) {
    for (const cols of Object.values(blacklist.columns)) {
      if (Array.isArray(cols)) columnRules += cols.length
    }
  }
  return { tables, columnRules }
}
