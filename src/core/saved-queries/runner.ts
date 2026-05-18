import { coerceParams, mergeParamSources, type RawParamMap } from './binder'
import { engineFamily, getStrategy } from './strategies'
import { SavedQueryError, type EngineTag, type ResolvedSnippet } from './types'

export interface RunOptions {
  /** 'postgres' | 'mysql' | 'elasticsearch' | 'redis' | 'mongodb' */
  engine: EngineTag
  noLimit: boolean
}

export interface PreparedExecution {
  driver: { sql: string; values: Array<string | number | boolean | null> }
  warnings: string[]
  /** original SQL body after `:name` rewrite but BEFORE guard wrapping (for --dry-run display) */
  rewrittenSql: string
  /** Per-family execution hints (e.g. ES index pattern, mongo collection/operation) */
  execHints?: { index?: string; collection?: string; mongoOperation?: 'find' | 'aggregate' }
}

export function prepareExecution(
  snippet: ResolvedSnippet,
  opts: RunOptions,
  cliParams: RawParamMap,
  fileParams: RawParamMap
): PreparedExecution {
  const declared = snippet.query.meta.engine
  if (declared && declared.length > 0) {
    const declaredFamily = engineFamily(declared[0]!)
    const connFamily = engineFamily(opts.engine)
    if (declaredFamily !== connFamily) {
      throw new SavedQueryError(
        `Engine mismatch for snippet '${snippet.query.meta.key}'\n` +
          `  Snippet requires: ${declared.join(', ')}\n` +
          `  Connection is: ${opts.engine}`,
        'ENGINE_MISMATCH',
        snippet.query.file
      )
    }
  }

  const merged = mergeParamSources(cliParams, fileParams)
  const typed = coerceParams(snippet.query.meta.params, merged)
  const strategy = getStrategy(engineFamily(opts.engine))
  const prepared = strategy.prepare(snippet.query, typed, opts)

  return {
    driver: prepared.driver,
    warnings: prepared.warnings,
    rewrittenSql: prepared.rewrittenBody,
    execHints: prepared.execHints,
  }
}
