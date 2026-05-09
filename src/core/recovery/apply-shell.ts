/**
 * Restricted shell-word parser used by `dbcli recover --apply`.
 *
 * Accepts: bare words, single-quoted strings, double-quoted strings.
 * Rejects: shell operators (`;`, `&`, `|`, `>`, `<`), command substitution
 * (`$(...)`, backticks), variable expansion (`$NAME`), glob (`*`, `?`),
 * grouping (`(`, `)`, `{`, `}`), unterminated quotes.
 *
 * Single-quote handling supports the standard `'O'\''Brien'` escape pattern
 * emitted by `recovery-steps.ts:shellQuote()`.
 */
export class ShellParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ShellParseError'
    Object.setPrototypeOf(this, ShellParseError.prototype)
  }
}

const FORBIDDEN_CHARS = new Set(['$', '`', '|', '&', ';', '>', '<', '(', ')', '{', '}', '*', '?'])

export function parseArgv(line: string): string[] {
  if (line.length === 0) throw new ShellParseError('empty command line')

  const argv: string[] = []
  let i = 0
  const n = line.length

  while (i < n) {
    while (i < n && line[i] === ' ') i++
    if (i >= n) break

    let token = ''
    while (i < n && line[i] !== ' ') {
      const c = line[i]!
      if (c === "'") {
        i++
        while (true) {
          if (i >= n) throw new ShellParseError('unterminated single quote')
          if (line[i] === "'") {
            i++
            if (line[i] === '\\' && line[i + 1] === "'" && line[i + 2] === "'") {
              token += "'"
              i += 3
              continue
            }
            break
          }
          token += line[i]
          i++
        }
        continue
      }
      if (c === '"') {
        i++
        while (true) {
          if (i >= n) throw new ShellParseError('unterminated double quote')
          if (line[i] === '"') {
            i++
            break
          }
          if (line[i] === '\\' && (line[i + 1] === '"' || line[i + 1] === '\\')) {
            token += line[i + 1]
            i += 2
            continue
          }
          if (FORBIDDEN_CHARS.has(line[i]!)) {
            throw new ShellParseError(`forbidden character '${line[i]}' in double-quoted segment`)
          }
          token += line[i]
          i++
        }
        continue
      }
      if (FORBIDDEN_CHARS.has(c)) {
        throw new ShellParseError(`forbidden character '${c}'`)
      }
      token += c
      i++
    }
    argv.push(token)
  }

  if (argv.length === 0) throw new ShellParseError('command line yielded no tokens')
  return argv
}
