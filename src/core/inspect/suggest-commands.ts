import type { InspectSnapshot, SnapshotSystem } from './types'

const SQL_SYSTEMS: ReadonlyArray<SnapshotSystem> = ['postgresql', 'mysql', 'mariadb']

export type SnapshotForSuggest = Omit<InspectSnapshot, 'suggestedCommands' | 'warnings' | 'hints'>

export interface SuggestContext {
  brief?: boolean
  /** Most-queried table from recent audit, if any (drives the tier-2 task-pack suggestion). */
  topTable?: string | null
  /** Number of available agent task packs (builtin + shared + local, deduped). */
  taskPackCount?: number
}

export function suggestCommands(snap: SnapshotForSuggest, ctx: SuggestContext = {}): string[] {
  if (!snap.system) return ['dbcli init']

  const out: string[] = []
  const isSql = SQL_SYSTEMS.includes(snap.system)
  const hasTaskPacks = (ctx.taskPackCount ?? 0) > 0

  // Tier 1 — bootstrap
  if (isSql && (!snap.schemaCache.available || snap.schemaCache.stale)) {
    out.push('dbcli schema --refresh')
  }
  out.push('dbcli list --format json')

  // Tier 2 — context-aware
  if (ctx.topTable && hasTaskPacks) {
    out.push(`dbcli skill tasks plan analyze-table-perf --param table=${ctx.topTable}`)
  }
  const topIntent = snap.snippets.intents[0]
  if (topIntent) {
    const prefix = topIntent.intent.split('.')[0]
    out.push(`dbcli queries suggest ${prefix} --format json`)
  }

  // Tier 3 — discovery
  if (hasTaskPacks) {
    out.push('dbcli skill tasks list')
  }
  out.push('dbcli doctor --format json')

  const cap = ctx.brief ? 1 : 5
  return out.slice(0, cap)
}
