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
const VALID_ENGINES: EngineTag[] = ['postgres', 'mysql']

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
  validateBody(body, input)

  const meta = fm.meta
  meta.key = input.key
  if (!meta.name) meta.name = input.key

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
  const engine = normaliseEngine(raw.engine, warnings)
  const params = normaliseParams(raw.params, input)
  const tags = Array.isArray(raw.tags) ? raw.tags.map(String) : []

  return {
    meta: {
      name: typeof raw.name === 'string' ? raw.name : '',
      key: input.key,
      description: typeof raw.description === 'string' ? raw.description : undefined,
      engine,
      params,
      tags,
    },
    warnings,
  }
}

function normaliseEngine(value: unknown, warnings: string[]): EngineTag[] | undefined {
  if (value === undefined || value === null || value === '') {
    warnings.push('Snippet has no engine declaration; assuming any engine')
    return undefined
  }
  const list = Array.isArray(value) ? value : [value]
  const cleaned: EngineTag[] = []
  for (const v of list) {
    const s = String(v).toLowerCase()
    if (!VALID_ENGINES.includes(s as EngineTag)) {
      throw new SavedQueryError(`Unknown engine '${s}' (allowed: postgres, mysql)`, 'PARSE_ERROR')
    }
    cleaned.push(s as EngineTag)
  }
  return cleaned
}

function normaliseParams(value: unknown, input: ParseInput): ParamSpec[] {
  if (value === undefined || value === null) return []
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new SavedQueryError(`'params' must be a map`, 'PARSE_ERROR', input.file)
  }
  return Object.entries(value as Record<string, Record<string, unknown> | undefined>).map(([name, spec]) => {
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
  })
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
