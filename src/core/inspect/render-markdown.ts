import type { InspectSnapshot } from './types'
import type { RenderOptions } from './render-json'

export function renderMarkdown(snap: InspectSnapshot, options: RenderOptions = {}): string {
  const lines: string[] = []
  const brief = !!options.brief

  lines.push('# dbcli inspect')
  lines.push('')
  lines.push(`*Schema version:* ${snap.schemaVersion}`)
  lines.push('')

  lines.push('## Connection')
  if (!snap.system) {
    lines.push('- No configuration found. Run `dbcli init`.')
  } else {
    lines.push(`- System: \`${snap.system}\``)
    lines.push(`- Connection: \`${snap.connection.name ?? 'default'}\``)
    lines.push(`- Database: \`${snap.connection.database ?? '(none)'}\``)
    lines.push(`- Version: \`${snap.connection.version ?? 'unknown'}\``)
  }
  lines.push('')

  lines.push('## Permission')
  lines.push(`- Level: \`${snap.permission.level}\``)
  lines.push(`- Writes: ${snap.permission.canWrite ? 'allowed' : 'blocked'}`)
  lines.push(`- Destructive: ${snap.permission.canDestruct ? 'allowed' : 'blocked'}`)
  lines.push('')

  lines.push('## Blacklist')
  lines.push(`- Protected tables: ${snap.blacklist.tables}`)
  lines.push(`- Column rules: ${snap.blacklist.columnRules}`)
  lines.push('')

  lines.push('## Objects')
  if (snap.objects.unavailable) {
    lines.push(`- ${snap.objects.kind}: unavailable (${snap.objects.reason ?? 'unknown'})`)
  } else {
    lines.push(`- ${snap.objects.kind}: ${snap.objects.count ?? 0}`)
    if (!brief && snap.objects.sample && snap.objects.sample.length > 0) {
      lines.push(`- Sample: ${snap.objects.sample.join(', ')}`)
    }
  }
  lines.push('')

  lines.push('## Schema cache')
  if (snap.schemaCache.unavailable) {
    lines.push(`- unavailable (${snap.schemaCache.reason ?? 'unknown'})`)
  } else if (!snap.schemaCache.available) {
    lines.push('- not built yet — run `dbcli schema --refresh`')
  } else {
    lines.push(`- Last refreshed: ${snap.schemaCache.lastRefreshed ?? 'unknown'}`)
    lines.push(`- Stale: ${snap.schemaCache.stale ? 'yes' : 'no'}`)
    if (typeof snap.schemaCache.totalTables === 'number') {
      lines.push(`- Total tables indexed: ${snap.schemaCache.totalTables}`)
    }
  }
  lines.push('')

  lines.push('## Snippets')
  lines.push(`- Total: ${snap.snippets.count}`)
  if (snap.snippets.engines.length > 0) {
    lines.push(`- Engines: ${snap.snippets.engines.join(', ')}`)
  }
  if (!brief && snap.snippets.intents.length > 0) {
    lines.push('- Top intents:')
    for (const b of snap.snippets.intents) lines.push(`  - \`${b.intent}\` × ${b.count}`)
  }
  lines.push('')

  lines.push('## Suggested commands')
  for (const c of snap.suggestedCommands) lines.push(`- \`${c}\``)
  lines.push('')

  if (snap.warnings.length > 0) {
    lines.push('## Warnings')
    for (const w of snap.warnings) lines.push(`- ${w}`)
    lines.push('')
  }

  return lines.join('\n')
}
