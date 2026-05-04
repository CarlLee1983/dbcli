/**
 * 參數綁定：型別轉換 + :name → driver placeholder 改寫
 */

import { SavedQueryError, type EngineTag, type ParamSpec } from './types'
import { stripCommentsAndStrings } from './parser'

export type ParamMap = Record<string, string | number | boolean | null>
export type RawParamMap = Record<string, unknown>

export function mergeParamSources(cli: RawParamMap, file: RawParamMap): RawParamMap {
  return { ...file, ...cli }
}

export function coerceParams(specs: ParamSpec[], raw: RawParamMap): ParamMap {
  const out: ParamMap = {}
  const missing: string[] = []
  for (const spec of specs) {
    const provided = Object.prototype.hasOwnProperty.call(raw, spec.name)
    if (!provided) {
      if (spec.required) {
        missing.push(spec.name)
        continue
      }
      out[spec.name] = (spec.default ?? null) as ParamMap[string]
      continue
    }
    out[spec.name] = coerceValue(spec, raw[spec.name])
  }
  if (missing.length > 0) {
    throw new SavedQueryError(`Missing required parameters: ${missing.join(', ')}`, 'PARAM_MISSING')
  }
  return out
}

function coerceValue(spec: ParamSpec, value: unknown): string | number | boolean | null {
  const s = value === null || value === undefined ? '' : String(value)
  let coerced: string | number | boolean | null
  switch (spec.type) {
    case 'int': {
      const n = parseInt(s, 10)
      if (Number.isNaN(n)) throw paramErr(spec, s, 'int')
      coerced = n
      break
    }
    case 'float': {
      const n = parseFloat(s)
      if (Number.isNaN(n)) throw paramErr(spec, s, 'float')
      coerced = n
      break
    }
    case 'bool': {
      const lc = s.toLowerCase()
      if (['true', '1', 'yes'].includes(lc)) coerced = true
      else if (['false', '0', 'no'].includes(lc)) coerced = false
      else throw paramErr(spec, s, 'bool')
      break
    }
    case 'date': {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw paramErr(spec, s, 'date (YYYY-MM-DD)')
      coerced = s
      break
    }
    case 'datetime': {
      if (Number.isNaN(Date.parse(s))) throw paramErr(spec, s, 'datetime (ISO 8601)')
      coerced = s
      break
    }
    case 'string':
    default:
      coerced = s
  }
  if (spec.enum && !spec.enum.some((v) => String(v) === String(coerced))) {
    throw new SavedQueryError(
      `Param '${spec.name}': value '${coerced}' not in enum [${spec.enum.join(', ')}]`,
      'PARAM_INVALID'
    )
  }
  return coerced
}

function paramErr(spec: ParamSpec, raw: string, expected: string): SavedQueryError {
  return new SavedQueryError(
    `Param '${spec.name}': cannot coerce '${raw}' to ${expected}`,
    'PARAM_INVALID'
  )
}

export interface RewriteResult {
  sql: string
  values: Array<string | number | boolean | null>
  /** :name appearing in SQL but not declared in spec */
  undeclared: string[]
}

const NAME_RE = /(?<![\w:]):([a-zA-Z_][a-zA-Z0-9_]*)/g

export function rewriteToBind(sqlBody: string, params: ParamMap, engine: EngineTag): RewriteResult {
  const masked = stripCommentsAndStrings(sqlBody)
  const order: string[] = []
  const indexByName = new Map<string, number>()

  // Pass 1: walk masked text to discover order & assign indices
  let m: RegExpExecArray | null
  NAME_RE.lastIndex = 0
  while ((m = NAME_RE.exec(masked)) !== null) {
    const name = m[1]!
    if (!indexByName.has(name)) {
      indexByName.set(name, order.length + 1)
      order.push(name)
    }
  }

  // Pass 2: rewrite original SQL using positions from masked text
  let outSql = ''
  let cursor = 0
  NAME_RE.lastIndex = 0
  while ((m = NAME_RE.exec(masked)) !== null) {
    const name = m[1]!
    const start = m.index
    const end = start + m[0].length
    outSql += sqlBody.slice(cursor, start)
    const idx = indexByName.get(name)!
    outSql += engine === 'postgres' ? `$${idx}` : '?'
    cursor = end
  }
  outSql += sqlBody.slice(cursor)

  const undeclared: string[] = []
  const values = order.map((n) => {
    if (!Object.prototype.hasOwnProperty.call(params, n)) {
      undeclared.push(n)
      return null
    }
    return params[n]!
  })

  return { sql: outSql, values, undeclared }
}
