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

function optionWithValue(option: string, value: string): string {
  const separator = value.startsWith('-') ? '=' : ' '
  return `${option}${separator}${shellArg(value)}`
}

function hasCommanderSafePositionals(values: string[]): boolean {
  return values.every((value) => !value.startsWith('-'))
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
  if (!hasCommanderSafePositionals([table.table, column.name, column.type])) {
    return escalateProposal(
      'table, column, and type positional values beginning with a dash require manual migration review'
    )
  }

  const command = [
    `dbcli migrate add-column ${shellArg(table.table)} ${shellArg(column.name)} ${shellArg(column.type)}`,
  ]
  if (column.nullable) command.push('--nullable')
  if (column.default !== undefined) command.push(optionWithValue('--default', column.default))
  return [REVIEW_NOTE, command.join(' ')]
}

export function addIndexProposal(table: NormalizedTableIdentity, index: NormalizedIndex): string[] {
  if (table.schema !== undefined) return qualifiedTargetEscalation(table)
  if (!hasCommanderSafePositionals([table.table])) {
    return escalateProposal(
      'table positional values beginning with a dash require manual migration review'
    )
  }
  if (!hasLosslessColumnList(index)) {
    return escalateProposal(
      `index columns for table '${qualifiedTableName(table)}' are not losslessly representable by --columns`
    )
  }

  const columns = index.columns.join(',')
  const command = [
    `dbcli migrate add-index ${shellArg(table.table)} ${optionWithValue('--columns', columns)}`,
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
