// src/core/assert/grammar.ts
export type Op = '>' | '>=' | '<' | '<=' | '==' | '!='

export type ColPred =
  | { type: 'notNull' }
  | { type: 'unique' }
  | { type: 'between'; low: number; high: number }
  | { type: 'cmp'; op: Op; value: number | string }

export type ExpectNode =
  | { kind: 'rows'; op: Op; value: number }
  | { kind: 'value'; op: Op; value: number | string }
  | { kind: 'col'; column: string; pred: ColPred }

export class AssertExpressionError extends Error {
  code = 'ASSERT_BAD_EXPRESSION'
  constructor(input: string) {
    super(
      `Cannot parse --expect "${input}". Examples: "rows > 0", "value == 5000", ` +
        `"col:email not null", "col:id unique", "col:amount between 0 and 100", "col:age >= 18".`
    )
    this.name = 'AssertExpressionError'
  }
}

const OP = /(>=|<=|==|!=|>|<)/

function parseScalar(raw: string): number | string {
  const s = raw.trim()
  if (/^".*"$/.test(s) || /^'.*'$/.test(s)) return s.slice(1, -1)
  const n = Number(s)
  return Number.isNaN(n) ? s : n
}

export function parseExpect(input: string): ExpectNode {
  const s = input.trim()

  const rows = s.match(new RegExp(`^rows\\s*${OP.source}\\s*(\\d+)$`))
  if (rows) return { kind: 'rows', op: rows[1] as Op, value: parseInt(rows[2]!, 10) }

  const value = s.match(new RegExp(`^value\\s*${OP.source}\\s*(.+)$`))
  if (value) return { kind: 'value', op: value[1] as Op, value: parseScalar(value[2]!) }

  const col = s.match(/^col:(\w+)\s+(.+)$/)
  if (col) {
    const column = col[1]!
    const rest = col[2]!.trim()
    if (/^not\s+null$/i.test(rest)) return { kind: 'col', column, pred: { type: 'notNull' } }
    if (/^unique$/i.test(rest)) return { kind: 'col', column, pred: { type: 'unique' } }
    const between = rest.match(/^between\s+(-?\d+(?:\.\d+)?)\s+and\s+(-?\d+(?:\.\d+)?)$/i)
    if (between) {
      return { kind: 'col', column, pred: { type: 'between', low: Number(between[1]), high: Number(between[2]) } }
    }
    const cmp = rest.match(new RegExp(`^${OP.source}\\s*(.+)$`))
    if (cmp) return { kind: 'col', column, pred: { type: 'cmp', op: cmp[1] as Op, value: parseScalar(cmp[2]!) } }
  }

  throw new AssertExpressionError(input)
}
