// src/core/repl/multiline-buffer.ts

export interface BufferResult {
  readonly complete: boolean
  readonly sql?: string
}

export class MultilineBuffer {
  private lines: string[] = []

  append(line: string): BufferResult {
    this.lines.push(line)
    const joined = this.lines.join('\n')

    if (hasUnquotedSemicolon(joined)) {
      const sql = joined
      this.lines = []
      return { complete: true, sql }
    }

    return { complete: false }
  }

  isActive(): boolean {
    return this.lines.length > 0
  }

  /**
   * Is the buffered text sitting inside an unterminated string literal?
   *
   * The shell lifts its own commands out of a statement in progress so `.quit`
   * cannot be swallowed, and that decision needs the one piece of context only
   * this class has. A line reading `.timing off` between `SELECT 'a` and
   * `b' AS t;` is part of the literal, and taking it out sent a mutilated
   * statement to the server (#88).
   */
  isInsideLiteral(): boolean {
    return insideLiteral(this.lines.join('\n'))
  }

  getPartial(): string {
    return this.lines.join('\n')
  }

  reset(): void {
    this.lines = []
  }
}

function hasUnquotedSemicolon(sql: string): boolean {
  return scan(sql).semicolon
}

function insideLiteral(sql: string): boolean {
  const { inSingleQuote, inDoubleQuote } = scan(sql)
  return inSingleQuote || inDoubleQuote
}

/** One pass over the text, reporting both what the callers above need. */
function scan(sql: string): {
  semicolon: boolean
  inSingleQuote: boolean
  inDoubleQuote: boolean
} {
  let inSingleQuote = false
  let inDoubleQuote = false
  let escaped = false
  let semicolon = false

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i]

    if (escaped) {
      escaped = false
      continue
    }

    if (ch === '\\') {
      escaped = true
      continue
    }

    if (ch === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote
      continue
    }

    if (ch === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote
      continue
    }

    if (ch === ';' && !inSingleQuote && !inDoubleQuote) {
      semicolon = true
    }
  }

  return { semicolon, inSingleQuote, inDoubleQuote }
}
