import type { ParamMap } from '../binder'
import type { RunOptions } from '../runner'
import { SavedQueryError, type ParamSpec, type SavedQuery } from '../types'
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
      (before !== undefined && /\S/.test(before)) ||
      (after !== undefined && /\S/.test(after))
    if (spec?.type === 'string' && adjacentNonWs) {
      warnings.push(
        `Param ':${name}' is adjacent to other characters; wrap in quotes if value may contain whitespace`
      )
    }
    return value === null || value === undefined ? '' : String(value)
  })

  return { command, warnings }
}

const REDIS_READONLY_VERBS = new Set([
  'GET', 'MGET',
  'HGET', 'HGETALL', 'HMGET', 'HKEYS', 'HVALS', 'HLEN', 'HEXISTS',
  'LRANGE', 'LLEN', 'LINDEX',
  'SMEMBERS', 'SISMEMBER', 'SCARD',
  'ZRANGE', 'ZRANGEBYSCORE', 'ZRANGEBYLEX', 'ZSCORE', 'ZCARD', 'ZCOUNT', 'ZRANK',
  'TYPE', 'EXISTS', 'TTL', 'PTTL', 'STRLEN', 'OBJECT',
  'SCAN', 'HSCAN', 'SSCAN', 'ZSCAN',
])

const REDIS_HARD_REJECT = new Set([
  'FLUSHDB', 'FLUSHALL', 'CONFIG', 'DEBUG', 'SHUTDOWN',
  'EVAL', 'EVALSHA', 'SCRIPT',
  'KEYS',
])

export const redisStrategy: EngineStrategy = {
  family: 'redis',

  validateBody(body, meta, file) {
    const trimmed = body.replace(/\r\n/g, '\n').trim()
    if (!trimmed) {
      throw new SavedQueryError(
        `Snippet '${meta.key}' has empty body`,
        'REDIS_EMPTY_BODY',
        file
      )
    }
    const lines = trimmed.split('\n').map((l) => l.trim()).filter(Boolean)
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

  prepare(_snippet: SavedQuery, _params: ParamMap, _opts: RunOptions): PreparedExecution {
    // Implemented in Tasks 12–14
    throw new Error('redisStrategy.prepare: not yet implemented')
  },
}
