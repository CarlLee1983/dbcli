import type { ParamMap } from '../binder'
import type { RunOptions } from '../runner'
import { SavedQueryError, type SavedQuery } from '../types'
import type { EngineStrategy, PreparedExecution } from './types'

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
