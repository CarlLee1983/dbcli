import type { DriftEntry } from '@/core/orm-drift/compare'
import type { NormalizedColumn, NormalizedIndex } from '@/core/orm-drift/normalized-schema'

export const REVIEW_NOTE = '# dry-run by default; review via migration-review before --execute'

export function addColumnProposal(table: string, column: NormalizedColumn): string[] {
  const command = [`dbcli migrate add-column ${table} ${column.name} ${column.type}`]
  if (column.nullable) command.push('--nullable')
  if (column.default !== undefined) command.push(`--default ${column.default}`)
  return [REVIEW_NOTE, command.join(' ')]
}

export function addIndexProposal(table: string, index: NormalizedIndex): string[] {
  const command = [`dbcli migrate add-index ${table} --columns ${index.columns.join(',')}`]
  if (index.unique) command.push('--unique')
  return [REVIEW_NOTE, command.join(' ')]
}

export function escalateProposal(reason: string): string[] {
  const oneLineReason = reason.replace(/\s+/g, ' ').trim()
  return [
    `# escalate: ${oneLineReason || 'manual migration review required'} — run: dbcli skill tasks plan migration-review`,
  ]
}

export function proposalsFor(
  entry: Omit<DriftEntry, 'proposedCommands'>,
  column?: NormalizedColumn
): string[] {
  if (entry.category === 'unmanaged') return []

  if (entry.category === 'missing_in_db') {
    if (column && entry.object !== 'table' && !entry.object.startsWith('index(')) {
      return addColumnProposal(entry.table, column)
    }

    const indexMatch = /^index\((.*)\)$/.exec(entry.object)
    if (indexMatch) {
      const columns = (indexMatch[1] ?? '')
        .split(',')
        .map((candidate) => candidate.trim())
        .filter(Boolean)
      if (columns.length > 0) {
        return addIndexProposal(entry.table, {
          columns,
          unique: /\bunique index\b/i.test(entry.detail),
        })
      }
    }
  }

  return escalateProposal(entry.detail)
}
