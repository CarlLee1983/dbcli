import type { ParamMap } from '../binder'
import { SavedQueryError, type ParamSpec } from '../types'
import type { EngineStrategy, PreparedExecution } from './types'

const REDIS_NAME_RE = /:([a-zA-Z_][a-zA-Z0-9_]*)/g

export function substituteRedisParams(
  body: string,
  params: ParamMap,
  specs: ParamSpec[]
): { command: string; warnings: string[] } {
  const warnings: string[] = []
  const specByName = new Map(specs.map((s) => [s.name, s]))

  const command = body.replace(REDIS_NAME_RE, (match, name: string, offset: number) => {
    if (!Object.prototype.hasOwnProperty.call(params, name)) return match
    const value = params[name]
    const spec = specByName.get(name)
    const before = body[offset - 1]
    const after = body[offset + match.length]
    const adjacentNonWs =
      (before !== undefined && /\S/.test(before)) || (after !== undefined && /\S/.test(after))
    if (spec?.type === 'string' && adjacentNonWs) {
      warnings.push(
        `Param ':${name}' is adjacent to other characters; wrap in quotes if value may contain whitespace`
      )
    }
    return value === null || value === undefined ? '' : String(value)
  })

  return { command, warnings }
}

const REDIS_RANGE_CAP = 1000
const RANGE_VERBS = new Set(['LRANGE', 'ZRANGE', 'ZRANGEBYSCORE', 'ZRANGEBYLEX'])
const SCAN_VERBS = new Set(['SCAN', 'HSCAN', 'SSCAN', 'ZSCAN'])

export function applyRedisSizeGuard(
  command: string,
  noLimit: boolean
): { command: string; warnings: string[] } {
  if (noLimit) return { command, warnings: [] }
  const warnings: string[] = []
  const tokens = command.split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return { command, warnings }
  const verb = tokens[0]!.toUpperCase()

  if (RANGE_VERBS.has(verb) && tokens.length >= 4) {
    const stop = parseInt(tokens[3]!, 10)
    if (Number.isFinite(stop) && (stop < 0 || stop > REDIS_RANGE_CAP)) {
      warnings.push(`${verb} stop=${tokens[3]} exceeds cap ${REDIS_RANGE_CAP}; overriding`)
      tokens[3] = String(REDIS_RANGE_CAP)
      return { command: tokens.join(' '), warnings }
    }
    return { command, warnings }
  }

  if (SCAN_VERBS.has(verb)) {
    const idx = tokens.findIndex((t) => t.toUpperCase() === 'COUNT')
    if (idx === -1) {
      tokens.push('COUNT', String(REDIS_RANGE_CAP))
      return { command: tokens.join(' '), warnings }
    }
    const cur = parseInt(tokens[idx + 1] ?? '', 10)
    if (Number.isFinite(cur) && cur > REDIS_RANGE_CAP) {
      warnings.push(`${verb} COUNT=${cur} exceeds cap ${REDIS_RANGE_CAP}; overriding`)
      tokens[idx + 1] = String(REDIS_RANGE_CAP)
      return { command: tokens.join(' '), warnings }
    }
    return { command, warnings }
  }

  return { command, warnings }
}

const REDIS_READONLY_VERBS = new Set([
  'GET',
  'MGET',
  'HGET',
  'HGETALL',
  'HMGET',
  'HKEYS',
  'HVALS',
  'HLEN',
  'HEXISTS',
  'LRANGE',
  'LLEN',
  'LINDEX',
  'SMEMBERS',
  'SISMEMBER',
  'SCARD',
  'ZRANGE',
  'ZRANGEBYSCORE',
  'ZRANGEBYLEX',
  'ZSCORE',
  'ZCARD',
  'ZCOUNT',
  'ZRANK',
  'TYPE',
  'EXISTS',
  'TTL',
  'PTTL',
  'STRLEN',
  'OBJECT',
  'SCAN',
  'HSCAN',
  'SSCAN',
  'ZSCAN',
])

const REDIS_HARD_REJECT = new Set([
  'FLUSHDB',
  'FLUSHALL',
  'CONFIG',
  'DEBUG',
  'SHUTDOWN',
  'EVAL',
  'EVALSHA',
  'SCRIPT',
  'KEYS',
])

export const redisStrategy: EngineStrategy = {
  family: 'redis',

  validateBody(body, meta, file) {
    const trimmed = body.replace(/\r\n/g, '\n').trim()
    if (!trimmed) {
      throw new SavedQueryError(`Snippet '${meta.key}' has empty body`, 'REDIS_EMPTY_BODY', file)
    }
    const lines = trimmed
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
    if (lines.length > 1) {
      throw new SavedQueryError(
        `Snippet '${meta.key}' has multiple lines; only single command is allowed`,
        'REDIS_MULTI_LINE',
        file
      )
    }
    const verb = (lines[0]!.match(/^[A-Z_]+/i)?.[0] ?? '').toUpperCase()
    if (REDIS_HARD_REJECT.has(verb)) {
      throw new SavedQueryError(
        `Snippet '${meta.key}' uses banned command '${verb}'`,
        'REDIS_COMMAND_NOT_ALLOWED',
        file
      )
    }
    if (!REDIS_READONLY_VERBS.has(verb)) {
      throw new SavedQueryError(
        `Snippet '${meta.key}' uses '${verb}' which is not in the read-only allowlist`,
        'REDIS_COMMAND_NOT_ALLOWED',
        file
      )
    }
  },

  prepare(snippet, params, opts): PreparedExecution {
    const { command: substituted, warnings: subWarnings } = substituteRedisParams(
      snippet.sqlBody.trim(),
      params,
      snippet.meta.params
    )
    const guarded = applyRedisSizeGuard(substituted, opts.noLimit)
    return {
      driver: { sql: guarded.command, values: [] },
      rewrittenBody: substituted,
      warnings: [...subWarnings, ...guarded.warnings],
    }
  },
}
