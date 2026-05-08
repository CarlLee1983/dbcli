import type { InspectSnapshot, SnapshotSystem } from './types'

const SQL_SYSTEMS: ReadonlyArray<SnapshotSystem> = ['postgresql', 'mysql', 'mariadb']

type SnapshotForSuggest = Omit<InspectSnapshot, 'suggestedCommands' | 'warnings'>

export function suggestCommands(
  snap: SnapshotForSuggest,
  options: { brief?: boolean } = {}
): string[] {
  if (!snap.system) return ['dbcli init']

  const out: string[] = []
  const isSql = SQL_SYSTEMS.includes(snap.system)

  if (isSql && (!snap.schemaCache.available || snap.schemaCache.stale)) {
    out.push('dbcli schema --refresh')
  }

  out.push('dbcli list --format json')

  const top = snap.snippets.intents[0]
  if (top) {
    const prefix = top.intent.split('.')[0]
    out.push(`dbcli queries suggest ${prefix} --format json`)
  }

  out.push('dbcli queries list --format json')
  out.push('dbcli doctor --format json')

  const cap = options.brief ? 3 : 5
  return out.slice(0, cap)
}
