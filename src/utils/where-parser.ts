/**
 * Parses a simple WHERE clause string into a conditions object.
 * Supports `column=value` and `col1=value AND col2=value` (case-insensitive AND).
 * Numeric strings are coerced to numbers; `true`/`false`/`null` literals are coerced.
 * Surrounding single or double quotes around values are stripped.
 *
 * @param whereClause WHERE condition string
 * @returns Conditions object {column: value, ...}
 * @throws Error if the WHERE clause cannot be parsed
 */
export function parseWhereClause(whereClause: string): Record<string, unknown> {
  if (!whereClause || whereClause.trim() === '') {
    throw new Error('WHERE clause cannot be empty')
  }

  const conditions: Record<string, unknown> = {}
  const andParts = whereClause.split(/\s+AND\s+/i)

  for (const part of andParts) {
    const match = part.match(/^(\w+)\s*=\s*(.+)$/)
    if (!match) {
      throw new Error(
        `Cannot parse WHERE clause: "${part}". Use format "column=value" or "col1=val1 AND col2=val2"`
      )
    }

    const column = match[1]
    const valueStr = match[2]
    if (valueStr === undefined || column === undefined) {
      throw new Error(
        `Cannot parse WHERE clause: "${part}". Use format "column=value" or "col1=val1 AND col2=val2"`
      )
    }

    const trimmed = valueStr.trim()
    const isFullyQuoted =
      trimmed.length >= 2 &&
      ((trimmed.startsWith("'") && trimmed.endsWith("'")) ||
        (trimmed.startsWith('"') && trimmed.endsWith('"')))

    if (!isFullyQuoted && /\s+AND\s*$/i.test(trimmed)) {
      throw new Error(
        `Cannot parse WHERE clause: "${part}". Use format "column=value" or "col1=val1 AND col2=val2"`
      )
    }

    const stripped = isFullyQuoted ? trimmed.slice(1, -1) : trimmed

    let value: string | number | boolean | null = stripped
    if (stripped !== '' && !isNaN(Number(stripped))) {
      value = Number(stripped)
    }
    if (stripped === 'true') value = true
    else if (stripped === 'false') value = false
    else if (stripped === 'null') value = null

    conditions[column] = value
  }

  return conditions
}
