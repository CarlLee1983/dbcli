import { coerceParams, mergeParamSources, rewriteToBind, type RawParamMap } from './binder'
import { applySnippetGuard } from './size-guard'
import { SavedQueryError, type EngineTag, type ResolvedSnippet } from './types'

export interface RunOptions {
  /** 'postgres' | 'mysql' | 'mongodb' (mongo always errors out for SQL snippets in MVP) */
  engine: EngineTag | 'mongodb'
  noLimit: boolean
}

export interface PreparedExecution {
  driver: { sql: string; values: Array<string | number | boolean | null> }
  warnings: string[]
  /** original SQL body after `:name` rewrite but BEFORE guard wrapping (for --dry-run display) */
  rewrittenSql: string
}

export function prepareExecution(
  snippet: ResolvedSnippet,
  opts: RunOptions,
  cliParams: RawParamMap,
  fileParams: RawParamMap
): PreparedExecution {
  const warnings: string[] = []

  if (opts.engine === 'mongodb') {
    throw new SavedQueryError(
      `Snippet '${snippet.query.meta.key}' targets SQL but current connection is MongoDB`,
      'ENGINE_MISMATCH',
      snippet.query.file
    )
  }

  const declared = snippet.query.meta.engine
  if (!declared) {
    warnings.push(`Snippet '${snippet.query.meta.key}' has no engine declaration`)
  } else if (!declared.includes(opts.engine as EngineTag)) {
    throw new SavedQueryError(
      `Engine mismatch for snippet '${snippet.query.meta.key}'\n` +
        `  Snippet requires: ${declared.join(', ')}\n` +
        `  Connection is: ${opts.engine}`,
      'ENGINE_MISMATCH',
      snippet.query.file
    )
  }

  const merged = mergeParamSources(cliParams, fileParams)
  const typed = coerceParams(snippet.query.meta.params, merged)
  const rewritten = rewriteToBind(snippet.query.sqlBody, typed, opts.engine as EngineTag)
  if (rewritten.undeclared.length > 0) {
    warnings.push(`SQL references undeclared params: ${rewritten.undeclared.join(', ')}`)
  }
  const wrapped = applySnippetGuard(rewritten.sql, { noLimit: opts.noLimit })
  return {
    driver: { sql: wrapped, values: rewritten.values },
    rewrittenSql: rewritten.sql,
    warnings,
  }
}
