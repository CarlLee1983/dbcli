import type { AuditEntryBrief } from '@/core/audit/types'

function isRealTable(target: string): boolean {
  return target.length > 0 && target !== '*' && !target.startsWith('<')
}

/**
 * Most-frequently-targeted table across recent audit entries.
 * Counts the pre-extracted `target` field; ties break alphabetically.
 * Returns null when no real table target is present.
 */
export function topQueriedTable(entries: AuditEntryBrief[]): string | null {
  const counts = new Map<string, number>()
  for (const entry of entries) {
    if (!entry.target || !isRealTable(entry.target)) continue
    counts.set(entry.target, (counts.get(entry.target) ?? 0) + 1)
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  return sorted.length > 0 ? (sorted[0]?.[0] ?? null) : null
}
