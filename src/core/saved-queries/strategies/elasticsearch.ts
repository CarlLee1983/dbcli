import type { ParamMap } from '../binder'
import type { RunOptions } from '../runner'
import { SavedQueryError, type SavedQuery } from '../types'
import type { EngineStrategy, PreparedExecution } from './types'

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
