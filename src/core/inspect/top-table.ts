import type { AuditEntryBrief } from '@/core/audit/types'

function isRealTable(target: string): boolean {
  // `/` 開頭的是 Elasticsearch 的路由路徑，不是資料表——ES shell 在無法指出
  // index 時以 routed path 入帳，於是 `/_cat/indices` 與 `/_bulk` 會被當成
  // 「最常查詢的資料表」印給使用者看。
  return target.length > 0 && target !== '*' && !target.startsWith('<') && !target.startsWith('/')
}

/**
 * Most-frequently-targeted table across recent audit entries.
 * Counts the pre-extracted `target` field; ties break alphabetically.
 * Returns null when no real table target is present.
 */
export function topQueriedTable(entries: AuditEntryBrief[]): string | null {
  const counts = new Map<string, number>()
  for (const entry of entries) {
    // 一個請求寫兩列（送出前的 attempt 與回應後的 outcome）。兩列都數的話，
    // ES 的操作對 SQL 形成 2:1 的加權，而這個函式的答案會餵給使用者建議。
    if ((entry as { phase?: unknown }).phase === 'attempt') continue
    if (!entry.target || !isRealTable(entry.target)) continue
    counts.set(entry.target, (counts.get(entry.target) ?? 0) + 1)
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  return sorted.length > 0 ? (sorted[0]?.[0] ?? null) : null
}
