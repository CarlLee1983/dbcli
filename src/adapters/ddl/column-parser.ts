/**
 * Column spec parser for migrate create --column flag
 * Parses format: "name:type[:modifier[:modifier...]]"
 *
 * Examples:
 *   "id:serial:pk"
 *   "name:varchar(50):not-null"
 *   "email:varchar(100):not-null:unique"
 *   "created_at:timestamp:default=now()"
 *   "user_id:integer:not-null:references=users.id"
 */

import type { ColumnDefinition } from './types'

export function parseColumnSpec(spec: string): ColumnDefinition {
  const parts = splitSpec(spec)

  if (parts.length < 2) {
    throw new Error(`Invalid column spec "${spec}": expected "name:type[:modifiers]"`)
  }

  const [name, type, ...modifiers] = parts

  const column: ColumnDefinition = {
    name: name!,
    type: type!,
    nullable: true,
  }

  for (const mod of modifiers) {
    const lower = mod.toLowerCase()

    if (lower === 'pk') {
      column.primaryKey = true
      column.nullable = false
    } else if (lower === 'not-null' || lower === 'notnull') {
      column.nullable = false
    } else if (lower === 'unique') {
      column.unique = true
    } else if (lower === 'auto-increment' || lower === 'autoincrement') {
      column.autoIncrement = true
    } else if (lower.startsWith('default=')) {
      column.default = mod.substring('default='.length)
    } else if (lower.startsWith('references=')) {
      const ref = mod.substring('references='.length)
      const dotIdx = ref.lastIndexOf('.')
      if (dotIdx === -1) {
        throw new Error(`Invalid references "${ref}": expected "table.column"`)
      }
      column.references = {
        table: ref.substring(0, dotIdx),
        column: ref.substring(dotIdx + 1),
      }
    } else {
      throw new Error(`Unknown column modifier "${mod}" in spec "${spec}"`)
    }
  }

  // serial implies pk + auto-increment + not-null
  const lowerType = type!.toLowerCase()
  if (lowerType === 'serial' || lowerType === 'bigserial' || lowerType === 'smallserial') {
    column.autoIncrement = true
    column.nullable = false
  }

  return column
}

/**
 * Split spec by colon, respecting parentheses.
 * "name:varchar(50):not-null" → ["name", "varchar(50)", "not-null"]
 * "ts:timestamp:default=now()" → ["ts", "timestamp", "default=now()"]
 */
function splitSpec(spec: string): string[] {
  const parts: string[] = []
  let current = ''
  let depth = 0

  for (const ch of spec) {
    if (ch === '(') {
      depth++
      current += ch
    } else if (ch === ')') {
      depth--
      current += ch
    } else if (ch === ':' && depth === 0) {
      parts.push(current)
      current = ''
    } else {
      current += ch
    }
  }

  if (current) {
    parts.push(current)
  }

  return parts
}
