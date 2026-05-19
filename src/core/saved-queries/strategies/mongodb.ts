import type { ParamMap } from '../binder'
import type { RunOptions } from '../runner'
import { SavedQueryError, type SavedQuery, type SavedQueryMeta } from '../types'
import type { EngineStrategy, PreparedExecution } from './types'

const TEMPLATE_RE = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g

export const mongoStrategy: EngineStrategy = {
  family: 'mongo',

  validateBody(body: string, meta: SavedQueryMeta, file: string) {
    if (!meta.operation) {
      throw new SavedQueryError(
        `MongoDB snippet '${meta.key}' must declare 'operation: find' or 'operation: aggregate'`,
        'MONGO_INVALID_BODY',
        file
      )
    }
    const probe = stripTemplatesForValidation(body.trim())
    let parsed: unknown
    try {
      parsed = JSON.parse(probe)
    } catch (e) {
      throw new SavedQueryError(
        `MongoDB snippet '${meta.key}' body is not valid JSON: ${(e as Error).message}`,
        'MONGO_INVALID_BODY',
        file
      )
    }
    if (
      meta.operation === 'find' &&
      (Array.isArray(parsed) || typeof parsed !== 'object' || parsed === null)
    ) {
      throw new SavedQueryError(
        `MongoDB find snippet '${meta.key}' body must be a JSON object (got ${describe(parsed)})`,
        'MONGO_INVALID_BODY',
        file
      )
    }
    if (meta.operation === 'aggregate' && !Array.isArray(parsed)) {
      throw new SavedQueryError(
        `MongoDB aggregate snippet '${meta.key}' body must be a JSON array (got ${describe(parsed)})`,
        'MONGO_INVALID_BODY',
        file
      )
    }
  },

  prepare(snippet: SavedQuery, params: ParamMap, opts: RunOptions): PreparedExecution {
    if (opts.engine !== 'mongodb') {
      throw new SavedQueryError(
        `MongoDB snippet '${snippet.meta.key}' cannot run on ${opts.engine} connection`,
        'ENGINE_MISMATCH',
        snippet.file
      )
    }
    const collection = (params.__collection as string | undefined) ?? snippet.meta.target
    if (!collection || collection.trim() === '') {
      throw new SavedQueryError(
        `MongoDB snippet '${snippet.meta.key}' needs a target collection (frontmatter 'target' or CLI --collection).`,
        'MONGO_MISSING_COLLECTION',
        snippet.file
      )
    }
    const interpolated = interpolate(snippet.sqlBody, snippet.meta, params)
    let parsed: unknown
    try {
      parsed = JSON.parse(interpolated)
    } catch (e) {
      throw new SavedQueryError(
        `MongoDB snippet '${snippet.meta.key}' body became invalid JSON after parameter substitution: ${(e as Error).message}`,
        'MONGO_INVALID_BODY',
        snippet.file
      )
    }
    return {
      driver: { sql: JSON.stringify(parsed), values: [] },
      rewrittenBody: JSON.stringify(parsed, null, 2),
      warnings: [],
      execHints: {
        collection,
        mongoOperation: snippet.meta.operation,
      },
    }
  },
}

function interpolate(body: string, meta: SavedQueryMeta, params: ParamMap): string {
  const declared = new Map(meta.params.map((p) => [p.name, p]))
  return body.replace(TEMPLATE_RE, (_match, name: string) => {
    const spec = declared.get(name)
    let value: unknown = params[name]
    if (value === undefined) {
      if (spec?.default !== undefined) {
        value = spec.default
      } else if (spec?.required) {
        throw new SavedQueryError(
          `Missing required param '${name}' for snippet '${meta.key}'`,
          'PARAM_MISSING'
        )
      } else {
        value = null
      }
    }
    return JSON.stringify(value)
  })
}

function stripTemplatesForValidation(body: string): string {
  // Replace {{name}} placeholders with the JSON literal "0" so we can validate
  // the body's overall JSON structure without resolving params.
  return body.replace(TEMPLATE_RE, '0')
}

function describe(v: unknown): string {
  if (v === null) return 'null'
  if (Array.isArray(v)) return 'array'
  return typeof v
}
