import type { ParamMap } from '../binder'
import type { RunOptions } from '../runner'
import { SavedQueryError, type ParamSpec, type SavedQuery } from '../types'
import type { EngineStrategy, PreparedExecution } from './types'

const NAME_RE = /:([a-zA-Z_][a-zA-Z0-9_]*)/g

export function substituteEsParams(
  body: string,
  params: ParamMap,
  specs: ParamSpec[]
): string {
  const inString = new Uint8Array(body.length)
  let isIn = false
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]
    if (ch === '"' && body[i - 1] !== '\\') isIn = !isIn
    inString[i] = isIn ? 1 : 0
  }

  const specByName = new Map(specs.map((s) => [s.name, s]))

  return body.replace(NAME_RE, (match, name: string, offset: number) => {
    if (!Object.prototype.hasOwnProperty.call(params, name)) return match
    const value = params[name]
    const spec = specByName.get(name)
    const insideString = inString[offset] === 1

    if (insideString) {
      const stringified = JSON.stringify(value === null || value === undefined ? '' : String(value))
      return stringified.slice(1, -1)
    }

    if (value === null || value === undefined) return 'null'
    if (spec?.type === 'int' || spec?.type === 'float') return String(value)
    if (spec?.type === 'bool') return value ? 'true' : 'false'
    return JSON.stringify(String(value))
  })
}

function deepHasScript(value: unknown): boolean {
  if (value === null || typeof value !== 'object') return false
  if (Array.isArray(value)) return value.some(deepHasScript)
  const obj = value as Record<string, unknown>
  if ('script' in obj || 'script_fields' in obj) return true
  return Object.values(obj).some(deepHasScript)
}

export const esStrategy: EngineStrategy = {
  family: 'es',

  validateBody(body, meta, file) {
    let parsed: unknown
    try {
      parsed = JSON.parse(body)
    } catch (e) {
      throw new SavedQueryError(
        `Snippet '${meta.key}' has invalid JSON body: ${(e as Error).message}`,
        'ES_INVALID_JSON',
        file
      )
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new SavedQueryError(
        `Snippet '${meta.key}' body must be a JSON object`,
        'ES_INVALID_JSON',
        file
      )
    }
    if (deepHasScript(parsed)) {
      throw new SavedQueryError(
        `Snippet '${meta.key}' contains script/script_fields which are not allowed`,
        'ES_SCRIPT_REJECTED',
        file
      )
    }
  },

  prepare(_snippet: SavedQuery, _params: ParamMap, _opts: RunOptions): PreparedExecution {
    // Implemented in Task 10
    throw new Error('esStrategy.prepare: not yet implemented')
  },
}
