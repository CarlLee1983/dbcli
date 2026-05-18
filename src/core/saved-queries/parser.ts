/**
 * Saved query 檔案解析器
 *
 * 結構：
 *   -- ---
 *   -- <YAML frontmatter line>
 *   -- ---
 *   <SQL body>
 *
 * frontmatter 為選填；SQL body 必為單一 SELECT 或 WITH 語句。
 */

import { engineFamily, getStrategy } from './strategies'
import { parseYamlMini } from './yaml-mini'
import {
  SavedQueryError,
  type EngineTag,
  type ParamSpec,
  type ParamType,
  type ParsedFrontmatter,
  type SavedQuery,
  type SnippetSource,
} from './types'

const MAX_BYTES = 64 * 1024
const VALID_TYPES: ParamType[] = ['int', 'string', 'float', 'bool', 'date', 'datetime']
const VALID_ENGINES: EngineTag[] = ['postgres', 'mysql', 'elasticsearch', 'redis', 'mongodb']
const INTENT_RE = /^[a-z][a-z0-9.-]*$/

function familyOf(engine: EngineTag): 'sql' | 'es' | 'redis' | 'mongo' {
  if (engine === 'postgres' || engine === 'mysql') return 'sql'
  if (engine === 'elasticsearch') return 'es'
  if (engine === 'mongodb') return 'mongo'
  return 'redis'
}

export interface ParseInput {
  key: string
  file: string
  source: SnippetSource
  text: string
}

export interface ParseOutput {
  query: SavedQuery
  warnings: string[]
}

export function parseSavedQuery(input: ParseInput): ParseOutput {
  if (Buffer.byteLength(input.text, 'utf8') > MAX_BYTES) {
    throw new SavedQueryError(
      `Snippet '${input.key}' exceeds 64 KB size limit`,
      'FILE_TOO_LARGE',
      input.file
    )
  }

  const { frontmatter, body } = splitFrontmatter(input.text)
  const fm = parseFrontmatter(frontmatter, input)
  const meta = fm.meta
  meta.key = input.key
  if (!meta.name) meta.name = input.key

  if (meta.engine && meta.engine.length > 0) {
    const family = engineFamily(meta.engine[0]!)
    if (family === 'sql') {
      validateBody(body, input)
    } else {
      try {
        getStrategy(family).validateBody(body, meta, input.file)
      } catch (e) {
        // Re-throw SavedQueryError; tolerate "No strategy registered" until
        // every family's strategy is wired in (transitional during plan rollout).
        if (e instanceof SavedQueryError) throw e
        const msg = (e as Error)?.message ?? ''
        if (!msg.startsWith('No strategy registered')) throw e
      }
    }
  } else {
    validateBody(body, input)
  }

  if (meta.engine?.includes('elasticsearch') && !meta.index) {
    throw new SavedQueryError(
      `Snippet '${input.key}' requires an 'index' field for engine: elasticsearch`,
      'ES_INDEX_MISSING',
      input.file
    )
  }

  return {
    query: { meta, sqlBody: body, file: input.file, source: input.source },
    warnings: fm.warnings,
  }
}

function splitFrontmatter(text: string): { frontmatter: string; body: string } {
  const lines = text.split('\n')
  if (lines[0]?.trim() !== '-- ---') return { frontmatter: '', body: text }
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === '-- ---')
  if (end === -1) return { frontmatter: '', body: text }
  const fmLines = lines.slice(1, end).map((l) => l.replace(/^--\s?/, ''))
  const bodyLines = lines.slice(end + 1)
  return { frontmatter: fmLines.join('\n'), body: bodyLines.join('\n') }
}

function parseFrontmatter(yaml: string, input: ParseInput): ParsedFrontmatter {
  if (!yaml.trim()) {
    return {
      meta: { name: '', key: input.key, params: [], tags: [] },
      warnings: ['Snippet has no engine declaration; assuming any engine'],
    }
  }
  let rawParsed: unknown
  try {
    rawParsed = parseYamlMini(yaml)
  } catch (e) {
    throw new SavedQueryError(
      `Invalid frontmatter in '${input.key}': ${(e as Error).message}`,
      'PARSE_ERROR',
      input.file
    )
  }

  const warnings: string[] = []
  const raw = (rawParsed ?? {}) as Record<string, unknown>
  const engine = normaliseEngine(raw.engine, warnings, input)
  const params = normaliseParams(raw.params, input)
  const tags = Array.isArray(raw.tags) ? raw.tags.map(String) : []
  const index = typeof raw.index === 'string' ? raw.index : undefined
  const intent = normaliseIntent(raw.intent, input)
  const visual = normaliseVisual(raw.visual)
  const target = typeof raw.target === 'string' ? raw.target : undefined
  const operation =
    raw.operation === 'find' || raw.operation === 'aggregate'
      ? (raw.operation as 'find' | 'aggregate')
      : undefined

  return {
    meta: {
      name: typeof raw.name === 'string' ? raw.name : '',
      key: input.key,
      description: typeof raw.description === 'string' ? raw.description : undefined,
      engine,
      index,
      params,
      tags,
      intent,
      visual,
      target,
      operation,
    },
    warnings,
  }
}

function normaliseVisual(value: unknown): any {
  if (value === undefined || value === null || typeof value !== 'object') return undefined
  const raw = value as Record<string, unknown>

  const title = typeof raw.title === 'string' ? raw.title : undefined

  const kpis: any[] = []
  if (Array.isArray(raw.kpis)) {
    for (const item of raw.kpis) {
      if (typeof item === 'object' && item !== null) {
        const k = item as Record<string, unknown>
        if (typeof k.label === 'string' && typeof k.value_column === 'string') {
          kpis.push({
            label: k.label,
            value_column: k.value_column,
            format: typeof k.format === 'string' ? k.format : undefined,
          })
        }
      }
    }
  }

  const charts: any[] = []
  if (Array.isArray(raw.charts)) {
    for (const item of raw.charts) {
      if (typeof item === 'object' && item !== null) {
        const c = item as Record<string, unknown>
        if (typeof c.type === 'string' && typeof c.x === 'string' && Array.isArray(c.y)) {
          charts.push({
            type: c.type,
            title: typeof c.title === 'string' ? c.title : undefined,
            x: c.x,
            y: c.y.map(String),
          })
        }
      }
    }
  }

  return {
    title,
    kpis: kpis.length > 0 ? kpis : undefined,
    charts: charts.length > 0 ? charts : undefined,
  }
}

function normaliseIntent(value: unknown, input: ParseInput): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string' || value.length === 0 || !INTENT_RE.test(value)) {
    throw new SavedQueryError(
      `Snippet '${input.key}' has invalid intent: '${String(value)}' (must match ${INTENT_RE.source})`,
      'INVALID_INTENT',
      input.file
    )
  }
  return value
}

function normaliseEngine(
  value: unknown,
  warnings: string[],
  input: ParseInput
): EngineTag[] | undefined {
  if (value === undefined || value === null || value === '') {
    warnings.push(
      `Snippet '${input.key}' has no engine declaration; assuming compatible with any engine`
    )
    return undefined
  }
  const list = Array.isArray(value) ? value : [value]
  const cleaned: EngineTag[] = []
  for (const v of list) {
    const s = String(v).toLowerCase()
    if (!VALID_ENGINES.includes(s as EngineTag)) {
      throw new SavedQueryError(
        `Unknown engine '${s}' (allowed: ${VALID_ENGINES.join(', ')})`,
        'PARSE_ERROR',
        input.file
      )
    }
    cleaned.push(s as EngineTag)
  }
  if (cleaned.length > 1) {
    const families = new Set(cleaned.map(familyOf))
    if (families.size > 1) {
      throw new SavedQueryError(
        `Snippet '${input.key}' mixes engine families: ${cleaned.join(', ')}`,
        'ENGINE_MIXED_FAMILIES',
        input.file
      )
    }
  }
  return cleaned
}

function normaliseParams(value: unknown, input: ParseInput): ParamSpec[] {
  if (value === undefined || value === null) return []
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new SavedQueryError(`'params' must be a map`, 'PARSE_ERROR', input.file)
  }
  return Object.entries(value as Record<string, Record<string, unknown> | undefined>).map(
    ([name, spec]) => {
      const type = String(spec?.type ?? 'string') as ParamType
      if (!VALID_TYPES.includes(type)) {
        throw new SavedQueryError(
          `Param '${name}': invalid type '${type}'`,
          'PARSE_ERROR',
          input.file
        )
      }
      const hasDefault = spec && Object.prototype.hasOwnProperty.call(spec, 'default')
      return {
        name,
        type,
        required: spec?.required === true ? true : !hasDefault,
        default: hasDefault ? (spec.default as ParamSpec['default']) : undefined,
        description: typeof spec?.description === 'string' ? spec.description : undefined,
        enum: Array.isArray(spec?.enum) ? spec.enum : undefined,
      }
    }
  )
}

export function validateBody(body: string, input: ParseInput): void {
  const stripped = stripCommentsAndStrings(body)
  const trimmed = stripped.trim()
  if (!trimmed) {
    throw new SavedQueryError(
      `Snippet '${input.key}' has empty SQL body`,
      'PARSE_ERROR',
      input.file
    )
  }

  const firstKeyword = trimmed.match(/^[A-Za-z]+/)?.[0]?.toUpperCase() ?? ''
  if (firstKeyword !== 'SELECT' && firstKeyword !== 'WITH') {
    throw new SavedQueryError(
      `Snippet '${input.key}' must start with SELECT or WITH (got '${firstKeyword || '<empty>'}')`,
      'NOT_SELECT',
      input.file
    )
  }

  // Multi-statement: any non-whitespace, non-comment after the first ';'
  const semi = trimmed.indexOf(';')
  if (semi !== -1) {
    const tail = trimmed.slice(semi + 1)
    if (/[A-Za-z0-9_]/.test(tail)) {
      throw new SavedQueryError(
        `Snippet '${input.key}' contains multiple statements; only one SELECT is allowed`,
        'MULTI_STATEMENT',
        input.file
      )
    }
  }

  // Template syntax — checked on the ORIGINAL body so templates inside literals also fail.
  if (/\$\{[^}]*\}|\{\{[^}]*\}\}/.test(body)) {
    throw new SavedQueryError(
      `Snippet '${input.key}' uses template syntax; use :name bind parameters instead`,
      'TEMPLATE_SYNTAX',
      input.file
    )
  }
}

/**
 * Replace string literals (single, double, dollar-quote) and SQL comments with spaces
 * so downstream regex passes ignore them. Length is preserved.
 */
export function stripCommentsAndStrings(sql: string): string {
  let out = ''
  let i = 0
  while (i < sql.length) {
    const c = sql[i]
    const next = sql[i + 1]
    if (c === '-' && next === '-') {
      while (i < sql.length && sql[i] !== '\n') {
        out += ' '
        i++
      }
      continue
    }
    if (c === '/' && next === '*') {
      out += '  '
      i += 2
      while (i < sql.length && !(sql[i] === '*' && sql[i + 1] === '/')) {
        out += sql[i] === '\n' ? '\n' : ' '
        i++
      }
      if (i < sql.length) {
        out += '  '
        i += 2
      }
      continue
    }
    if (c === "'" || c === '"') {
      const quote = c
      out += ' '
      i++
      while (i < sql.length) {
        if (sql[i] === '\\' && i + 1 < sql.length) {
          out += '  '
          i += 2
          continue
        }
        if (sql[i] === quote) {
          out += ' '
          i++
          break
        }
        out += sql[i] === '\n' ? '\n' : ' '
        i++
      }
      continue
    }
    if (c === '$' && next === '$') {
      out += '  '
      i += 2
      while (i < sql.length && !(sql[i] === '$' && sql[i + 1] === '$')) {
        out += sql[i] === '\n' ? '\n' : ' '
        i++
      }
      if (i < sql.length) {
        out += '  '
        i += 2
      }
      continue
    }
    out += c
    i++
  }
  return out
}
