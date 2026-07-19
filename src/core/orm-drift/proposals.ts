import type { DriftEntry } from '@/core/orm-drift/compare'
import type { NormalizedColumn, NormalizedIndex } from '@/core/orm-drift/normalized-schema'

export const REVIEW_NOTE = '# dry-run by default; review via migration-review before --execute'

const SAFE_SHELL_ARG = /^[A-Za-z0-9_./:@%+=,-]+$/

export type ProposalSubject =
  | { kind: 'column'; column: NormalizedColumn }
  | { kind: 'index'; index: NormalizedIndex }

export function shellArg(value: string): string {
  if (SAFE_SHELL_ARG.test(value)) return value
  return `'${value.replace(/'/g, `'"'"'`)}'`
}

export function addColumnProposal(table: string, column: NormalizedColumn): string[] {
  const command = [
    `dbcli migrate add-column ${shellArg(table)} ${shellArg(column.name)} ${shellArg(column.type)}`,
  ]
  if (column.nullable) command.push('--nullable')
  if (column.default !== undefined) command.push(`--default ${shellArg(column.default)}`)
  return [REVIEW_NOTE, command.join(' ')]
}

export function addIndexProposal(table: string, index: NormalizedIndex): string[] {
  const command = [
    `dbcli migrate add-index ${shellArg(table)} --columns ${shellArg(index.columns.join(','))}`,
  ]
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
  subject?: ProposalSubject
): string[] {
  if (entry.category === 'unmanaged') return []

  if (entry.category === 'missing_in_db' && entry.object !== 'table' && subject) {
    if (subject.kind === 'column') return addColumnProposal(entry.table, subject.column)
    return addIndexProposal(entry.table, subject.index)
  }

  return escalateProposal(entry.detail)
}
