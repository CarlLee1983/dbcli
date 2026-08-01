import type { ParamMap } from '../binder'
import type { RunOptions } from '../runner'
import type { SavedQuery, SavedQueryMeta } from '../types'

export type EngineFamily = 'sql' | 'es' | 'redis' | 'mongo'

export interface PreparedExecution {
  driver: { sql: string; values: Array<string | number | boolean | null> }
  rewrittenBody: string
  warnings: string[]
  execHints?: { index?: string; collection?: string; mongoOperation?: 'find' | 'aggregate' }
  /** Row cap dbcli imposed; driver SQL fetches one extra row to detect truncation. */
  guardLimit?: number
}

export interface EngineStrategy {
  family: EngineFamily
  validateBody(body: string, meta: SavedQueryMeta, file: string): void
  prepare(snippet: SavedQuery, params: ParamMap, opts: RunOptions): PreparedExecution
}
