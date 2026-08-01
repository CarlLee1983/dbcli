import { rewriteToBind, type ParamMap } from '../binder'
import { validateBody as validateSqlBody } from '../parser'
import type { RunOptions } from '../runner'
import { applySnippetGuard } from '../size-guard'
import { SavedQueryError, type EngineTag, type SavedQuery } from '../types'
import type { EngineStrategy, PreparedExecution } from './types'

export const sqlStrategy: EngineStrategy = {
  family: 'sql',

  validateBody(body, meta, file) {
    validateSqlBody(body, { key: meta.key, file, source: 'shared', text: '' })
  },

  prepare(snippet: SavedQuery, params: ParamMap, opts: RunOptions): PreparedExecution {
    if (opts.engine === 'mongodb' || opts.engine === 'elasticsearch' || opts.engine === 'redis') {
      throw new SavedQueryError(
        `SQL snippet '${snippet.meta.key}' cannot run on ${opts.engine} connection`,
        'ENGINE_MISMATCH',
        snippet.file
      )
    }
    const declared = snippet.meta.engine
    if (declared && !declared.includes(opts.engine as EngineTag)) {
      throw new SavedQueryError(
        `Engine mismatch for snippet '${snippet.meta.key}'\n` +
          `  Snippet requires: ${declared.join(', ')}\n` +
          `  Connection is: ${opts.engine}`,
        'ENGINE_MISMATCH',
        snippet.file
      )
    }
    const warnings: string[] = []
    if (!declared) warnings.push(`Snippet '${snippet.meta.key}' has no engine declaration`)

    const rewritten = rewriteToBind(snippet.sqlBody, params, opts.engine as EngineTag)
    if (rewritten.undeclared.length > 0) {
      warnings.push(`SQL references undeclared params: ${rewritten.undeclared.join(', ')}`)
    }
    const guarded = applySnippetGuard(rewritten.sql, { noLimit: opts.noLimit })
    return {
      driver: { sql: guarded.sql, values: rewritten.values },
      rewrittenBody: rewritten.sql,
      warnings,
      ...(guarded.guardLimit !== undefined ? { guardLimit: guarded.guardLimit } : {}),
    }
  },
}
