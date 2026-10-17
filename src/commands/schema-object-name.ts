/** Parse only the schema command's new two-component SQL names. Shared adapter
 * callers continue to pass literal local names. */
export function parseSchemaObjectName(
  input: string,
  system: 'postgresql' | 'mysql' | 'mariadb'
): { name: string; namespace?: string } {
  if (!input.includes('.')) return { name: input }
  const quote = system === 'postgresql' ? '"' : '`'
  const parts: string[] = []
  let pos = 0
  const invalid = () =>
    new Error(
      'Invalid qualified schema name: expected two nonempty identifiers using native identifier quotes.'
    )
  while (pos < input.length) {
    while (/\s/.test(input[pos] ?? '') && pos < input.length) pos++
    let part = ''
    if (input[pos] === quote) {
      pos++
      let closed = false
      while (pos < input.length) {
        const ch = input[pos++]!
        if (ch !== quote) part += ch
        else if (input[pos] === quote) {
          part += quote
          pos++
        } else {
          closed = true
          break
        }
      }
      if (!closed) throw invalid()
    } else {
      const start = pos
      while (pos < input.length && input[pos] !== '.' && !/\s/.test(input[pos]!)) pos++
      part = input.slice(start, pos)
      if (
        system === 'postgresql'
          ? !/^[\p{L}_][\p{L}\p{N}_$]*$/u.test(part)
          : !/^[\p{L}\p{N}_$]+$/u.test(part) || /^\d+$/.test(part)
      )
        throw invalid()
      if (system === 'postgresql') part = part.toLowerCase()
    }
    if (!part || part.includes('\0')) throw invalid()
    parts.push(part)
    while (pos < input.length && /\s/.test(input[pos]!)) pos++
    if (pos === input.length) break
    if (input[pos++] !== '.' || pos === input.length) throw invalid()
  }
  if (parts.length !== 2) throw invalid()
  return { namespace: parts[0]!, name: parts[1]! }
}
