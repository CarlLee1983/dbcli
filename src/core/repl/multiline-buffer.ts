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

  getPartial(): string {
    return this.lines.join('\n')
  }

  reset(): void {
    this.lines = []
  }
}

function hasUnquotedSemicolon(sql: string): boolean {
  let inSingleQuote = false
  let inDoubleQuote = false
  let escaped = false

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
      return true
    }
  }

  return false
}
