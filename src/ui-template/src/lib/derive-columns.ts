export function deriveColumns(
  rows: ReadonlyArray<Record<string, unknown>>
): string[] {
  if (rows.length === 0) return []
  const first = rows[0]
  if (first === undefined) return []
  return Object.keys(first)
}
