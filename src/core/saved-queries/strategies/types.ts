import type { ParamMap } from '../binder'
import type { RunOptions } from '../runner'
import type { SavedQuery, SavedQueryMeta } from '../types'

export type EngineFamily = 'sql' | 'es' | 'redis'

export interface PreparedExecution {
  driver: { sql: string; values: Array<string | number | boolean | null> }
  rewrittenBody: string
  warnings: string[]
  execHints?: { index?: string }
}

export interface EngineStrategy {
  family: EngineFamily
  validateBody(body: string, meta: SavedQueryMeta, file: string): void
  prepare(snippet: SavedQuery, params: ParamMap, opts: RunOptions): PreparedExecution
}
