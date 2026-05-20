/**
 * Saved query 型別定義
 * 整個 saved-queries 模組對外公開的純資料結構
 */

export type ParamType = 'int' | 'string' | 'float' | 'bool' | 'date' | 'datetime'

export type EngineTag = 'postgres' | 'mysql' | 'elasticsearch' | 'redis' | 'mongodb'

export interface ParamSpec {
  name: string
  type: ParamType
  required: boolean
  default?: string | number | boolean | null
  description?: string
  enum?: Array<string | number>
}

export interface SavedQueryMeta {
  /** Display name（frontmatter `name`），未指定時等於 snippet key */
  name: string
  /** snippet key，例如 `@dau` 或 `@analytics/revenue` */
  key: string
  description?: string
  /** 未宣告 = undefined，警告等級 */
  engine?: EngineTag[]
  /** Elasticsearch only — target index pattern (may contain :param) */
  index?: string
  params: ParamSpec[]
  tags: string[]
  /** Optional taxonomy slot, format: ^[a-z][a-z0-9.-]*$. See discovery spec. */
  intent?: string
  /** UI visualization configuration for interactive dashboards */
  visual?: VisualConfig
  /** Mongo only: default collection (CLI --collection overrides). */
  target?: string
  /** Mongo only: how to interpret the body. */
  operation?: 'find' | 'aggregate'
  /** Optional verification check query and assertion */
  verify?: SavedQueryVerify
}

export interface SavedQueryVerify {
  query: string
  expects: string
}

export interface VisualKPI {
  label: string
  value_column: string
  format?: 'currency' | 'number' | 'percent'
}

export interface VisualChart {
  type: 'line' | 'bar' | 'area' | 'pie' | 'scatter'
  title?: string
  x: string
  y: string[]
}

export interface VisualConfig {
  title?: string
  kpis?: VisualKPI[]
  charts?: VisualChart[]
}

export interface SavedQuery {
  meta: SavedQueryMeta
  sqlBody: string
  /** absolute or workspace-relative path used in messages */
  file: string
  /** `'builtin'` | `'shared'` | `'local'` */
  source: SnippetSource
}

export type SnippetSource = 'builtin' | 'shared' | 'local'

export interface ResolvedSnippet {
  query: SavedQuery
  /** local 蓋掉 shared 時為 true */
  hasLocalOverride: boolean
}

export interface ParsedFrontmatter {
  meta: SavedQueryMeta
  /** 解析過程中產生的非致命警告（例如 missing engine） */
  warnings: string[]
}

export class SavedQueryError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'PARSE_ERROR'
      | 'NOT_FOUND'
      | 'AMBIGUOUS'
      | 'PARAM_MISSING'
      | 'PARAM_INVALID'
      | 'ENGINE_MISMATCH'
      | 'TEMPLATE_SYNTAX'
      | 'NOT_SELECT'
      | 'MULTI_STATEMENT'
      | 'FILE_TOO_LARGE'
      | 'IO_ERROR'
      | 'ENGINE_MIXED_FAMILIES'
      | 'ES_INVALID_JSON'
      | 'ES_INDEX_MISSING'
      | 'ES_SCRIPT_REJECTED'
      | 'REDIS_COMMAND_NOT_ALLOWED'
      | 'REDIS_EMPTY_BODY'
      | 'REDIS_MULTI_LINE'
      | 'KEY_FAMILY_CONFLICT'
      | 'INVALID_INTENT'
      | 'MONGO_MISSING_COLLECTION'
      | 'MONGO_INVALID_BODY',
    public readonly file?: string
  ) {
    super(message)
    this.name = 'SavedQueryError'
    Object.setPrototypeOf(this, SavedQueryError.prototype)
  }
}
