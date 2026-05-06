/**
 * Minimal shell-aware argv splitter used by the task planner.
 *
 * Supported:
 * - whitespace separation
 * - single quotes (literal contents, no escapes)
 * - double quotes (with backslash escapes for `"` and `\`)
 * - backslash escapes outside quotes
 *
 * Not supported (intentionally): variable expansion, command substitution,
 * environment lookups. Tasks must use {{param}} placeholders for substitution.
 */
export function splitArgv(input: string): string[] {
  const out: string[] = []
  let current = ''
  let inSingle = false
  let inDouble = false
  let hasToken = false

  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!

    if (inSingle) {
      if (ch === "'") {
        inSingle = false
      } else {
        current += ch
        hasToken = true
      }
      continue
    }

    if (inDouble) {
      if (ch === '\\' && (input[i + 1] === '"' || input[i + 1] === '\\')) {
        current += input[i + 1]
        i++
        hasToken = true
        continue
      }
      if (ch === '"') {
        inDouble = false
      } else {
        current += ch
        hasToken = true
      }
      continue
    }

    if (ch === "'") {
      inSingle = true
      hasToken = true
      continue
    }
    if (ch === '"') {
      inDouble = true
      hasToken = true
      continue
    }
    if (ch === '\\' && i + 1 < input.length) {
      current += input[i + 1]
      i++
      hasToken = true
      continue
    }
    if (ch === ' ' || ch === '\t' || ch === '\n') {
      if (hasToken) {
        out.push(current)
        current = ''
        hasToken = false
      }
      continue
    }
    current += ch
    hasToken = true
  }

  if (inSingle || inDouble) {
    throw new Error(`Unterminated quote in command: ${input}`)
  }
  if (hasToken) out.push(current)
  return out
}
