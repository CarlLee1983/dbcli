import type { SnapshotForSuggest, SuggestContext } from './suggest-commands'

/**
 * P4: human-readable hints surfaced alongside suggestedCommands.
 * Each hint is conditional; returns [] when no signal is present.
 */
export function buildHints(
  snap: SnapshotForSuggest,
  ctx: Pick<SuggestContext, 'topTable' | 'taskPackCount'> = {}
): string[] {
  const hints: string[] = []

  if (ctx.topTable) {
    hints.push(`Most queried table in recent audit: ${ctx.topTable}`)
  }

  const n = ctx.taskPackCount ?? 0
  if (n > 0) {
    const noun = n === 1 ? 'task pack' : 'task packs'
    hints.push(`${n} ${noun} available — run \`dbcli skill tasks list\` to browse`)
  }

  const sc = snap.schemaCache
  if (sc.available && typeof sc.totalTables === 'number') {
    hints.push(
      `Schema cache: ${sc.totalTables} tables (last refreshed ${sc.lastRefreshed ?? 'unknown'})`
    )
  }

  return hints
}
