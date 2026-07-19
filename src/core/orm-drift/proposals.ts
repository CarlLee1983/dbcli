import type { DriftEntry } from '@/core/orm-drift/compare'
import type {
  NormalizedColumn,
  NormalizedIndex,
  NormalizedTableIdentity,
} from '@/core/orm-drift/normalized-schema'
import { qualifiedTableName } from '@/core/orm-drift/table-identity'

export const REVIEW_NOTE = '# dry-run by default; review via migration-review before --execute'

const SAFE_SHELL_ARG = /^[A-Za-z0-9_./:@%+=,-]+$/

export type ProposalSubject =
  | { kind: 'column'; table: NormalizedTableIdentity; column: NormalizedColumn }
  | { kind: 'index'; table: NormalizedTableIdentity; index: NormalizedIndex }

export function shellArg(value: string): string {
  if (SAFE_SHELL_ARG.test(value)) return value
  return `'${value.replace(/'/g, `'"'"'`)}'`
}

function qualifiedTargetEscalation(table: NormalizedTableIdentity): string[] {
  return escalateProposal(
    `schema-qualified table '${qualifiedTableName(table)}' is not losslessly representable by dbcli migrate`
  )
}

function hasLosslessColumnList(index: NormalizedIndex): boolean {
  return (
    index.columns.length > 0 &&
    index.columns.every(
      (column) => column.length > 0 && !column.includes(',') && column.trim() === column
    )
  )
}

export function addColumnProposal(
  table: NormalizedTableIdentity,
  column: NormalizedColumn
): string[] {
  if (table.schema !== undefined) return qualifiedTargetEscalation(table)

  const command = [
    `dbcli migrate add-column ${shellArg(table.table)} ${shellArg(column.name)} ${shellArg(column.type)}`,
  ]
  if (column.nullable) command.push('--nullable')
  if (column.default !== undefined) command.push(`--default ${shellArg(column.default)}`)
  return [REVIEW_NOTE, command.join(' ')]
}

export function addIndexProposal(table: NormalizedTableIdentity, index: NormalizedIndex): string[] {
  if (table.schema !== undefined) return qualifiedTargetEscalation(table)
  if (!hasLosslessColumnList(index)) {
    return escalateProposal(
      `index columns for table '${qualifiedTableName(table)}' are not losslessly representable by --columns`
    )
  }

  const command = [
    `dbcli migrate add-index ${shellArg(table.table)} --columns ${shellArg(index.columns.join(','))}`,
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
    if (subject.kind === 'column') {
      return addColumnProposal(subject.table, subject.column)
    }
    return addIndexProposal(subject.table, subject.index)
  }

  return escalateProposal(entry.detail)
}
