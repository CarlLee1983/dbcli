import type { RedisCommandSpec } from './types'

const tbl = (s: RedisCommandSpec) => s

export const REDIS_COMMAND_TABLE: Readonly<Record<string, RedisCommandSpec>> = Object.freeze({
  // ---- read-only, unbounded ----
  PING: tbl({
    readOnly: true,
    sizeGuard: { kind: 'unbounded' },
    keyArity: { kind: 'no-key' },
    permissionTier: 'query-only',
  }),
  INFO: tbl({
    readOnly: true,
    sizeGuard: { kind: 'unbounded' },
    keyArity: { kind: 'no-key' },
    permissionTier: 'query-only',
  }),
  DBSIZE: tbl({
    readOnly: true,
    sizeGuard: { kind: 'unbounded' },
    keyArity: { kind: 'no-key' },
    permissionTier: 'query-only',
  }),
  TYPE: tbl({
    readOnly: true,
    sizeGuard: { kind: 'unbounded' },
    keyArity: { kind: 'single', argIndex: 0 },
    permissionTier: 'query-only',
  }),
  EXISTS: tbl({
    readOnly: true,
    sizeGuard: { kind: 'unbounded' },
    keyArity: { kind: 'multi-variable', startIndex: 0, step: 1 },
    permissionTier: 'query-only',
  }),
  TTL: tbl({
    readOnly: true,
    sizeGuard: { kind: 'unbounded' },
    keyArity: { kind: 'single', argIndex: 0 },
    permissionTier: 'query-only',
  }),
  GET: tbl({
    readOnly: true,
    sizeGuard: { kind: 'unbounded' },
    keyArity: { kind: 'single', argIndex: 0 },
    permissionTier: 'query-only',
  }),
  MGET: tbl({
    readOnly: true,
    sizeGuard: { kind: 'unbounded' },
    keyArity: { kind: 'multi-variable', startIndex: 0, step: 1 },
    permissionTier: 'query-only',
  }),
  STRLEN: tbl({
    readOnly: true,
    sizeGuard: { kind: 'unbounded' },
    keyArity: { kind: 'single', argIndex: 0 },
    permissionTier: 'query-only',
  }),
  HGET: tbl({
    readOnly: true,
    sizeGuard: { kind: 'unbounded' },
    keyArity: { kind: 'single', argIndex: 0 },
    permissionTier: 'query-only',
  }),
  HEXISTS: tbl({
    readOnly: true,
    sizeGuard: { kind: 'unbounded' },
    keyArity: { kind: 'single', argIndex: 0 },
    permissionTier: 'query-only',
  }),
  HLEN: tbl({
    readOnly: true,
    sizeGuard: { kind: 'unbounded' },
    keyArity: { kind: 'single', argIndex: 0 },
    permissionTier: 'query-only',
  }),
  HMGET: tbl({
    readOnly: true,
    sizeGuard: { kind: 'unbounded' },
    keyArity: { kind: 'single', argIndex: 0 },
    permissionTier: 'query-only',
  }),
  LLEN: tbl({
    readOnly: true,
    sizeGuard: { kind: 'unbounded' },
    keyArity: { kind: 'single', argIndex: 0 },
    permissionTier: 'query-only',
  }),
  LINDEX: tbl({
    readOnly: true,
    sizeGuard: { kind: 'unbounded' },
    keyArity: { kind: 'single', argIndex: 0 },
    permissionTier: 'query-only',
  }),
  SCARD: tbl({
    readOnly: true,
    sizeGuard: { kind: 'unbounded' },
    keyArity: { kind: 'single', argIndex: 0 },
    permissionTier: 'query-only',
  }),
  SISMEMBER: tbl({
    readOnly: true,
    sizeGuard: { kind: 'unbounded' },
    keyArity: { kind: 'single', argIndex: 0 },
    permissionTier: 'query-only',
  }),
  ZCARD: tbl({
    readOnly: true,
    sizeGuard: { kind: 'unbounded' },
    keyArity: { kind: 'single', argIndex: 0 },
    permissionTier: 'query-only',
  }),
  ZSCORE: tbl({
    readOnly: true,
    sizeGuard: { kind: 'unbounded' },
    keyArity: { kind: 'single', argIndex: 0 },
    permissionTier: 'query-only',
  }),
  XLEN: tbl({
    readOnly: true,
    sizeGuard: { kind: 'unbounded' },
    keyArity: { kind: 'single', argIndex: 0 },
    permissionTier: 'query-only',
  }),

  // ---- read-only, rewrite ----
  SCAN: tbl({
    readOnly: true,
    sizeGuard: { kind: 'rewrite-count', argIndex: 0 },
    keyArity: { kind: 'no-key' },
    permissionTier: 'query-only',
  }),
  HSCAN: tbl({
    readOnly: true,
    sizeGuard: { kind: 'rewrite-count', argIndex: 1 },
    keyArity: { kind: 'single', argIndex: 0 },
    permissionTier: 'query-only',
  }),
  SSCAN: tbl({
    readOnly: true,
    sizeGuard: { kind: 'rewrite-count', argIndex: 1 },
    keyArity: { kind: 'single', argIndex: 0 },
    permissionTier: 'query-only',
  }),
  ZSCAN: tbl({
    readOnly: true,
    sizeGuard: { kind: 'rewrite-count', argIndex: 1 },
    keyArity: { kind: 'single', argIndex: 0 },
    permissionTier: 'query-only',
  }),
  LRANGE: tbl({
    readOnly: true,
    sizeGuard: { kind: 'rewrite-stop', argIndex: 2 },
    keyArity: { kind: 'single', argIndex: 0 },
    permissionTier: 'query-only',
  }),
  ZRANGE: tbl({
    readOnly: true,
    sizeGuard: { kind: 'rewrite-stop', argIndex: 2 },
    keyArity: { kind: 'single', argIndex: 0 },
    permissionTier: 'query-only',
  }),
  ZREVRANGE: tbl({
    readOnly: true,
    sizeGuard: { kind: 'rewrite-stop', argIndex: 2 },
    keyArity: { kind: 'single', argIndex: 0 },
    permissionTier: 'query-only',
  }),
  ZRANGEBYSCORE: tbl({
    readOnly: true,
    sizeGuard: { kind: 'rewrite-limit', argIndex: 3 },
    keyArity: { kind: 'single', argIndex: 0 },
    permissionTier: 'query-only',
  }),

  // ---- read-only, truncate ----
  HGETALL: tbl({
    readOnly: true,
    sizeGuard: { kind: 'truncate' },
    keyArity: { kind: 'single', argIndex: 0 },
    permissionTier: 'query-only',
  }),
  HKEYS: tbl({
    readOnly: true,
    sizeGuard: { kind: 'truncate' },
    keyArity: { kind: 'single', argIndex: 0 },
    permissionTier: 'query-only',
  }),
  HVALS: tbl({
    readOnly: true,
    sizeGuard: { kind: 'truncate' },
    keyArity: { kind: 'single', argIndex: 0 },
    permissionTier: 'query-only',
  }),
  SMEMBERS: tbl({
    readOnly: true,
    sizeGuard: { kind: 'truncate' },
    keyArity: { kind: 'single', argIndex: 0 },
    permissionTier: 'query-only',
  }),
  KEYS: tbl({
    readOnly: true,
    sizeGuard: { kind: 'truncate' },
    keyArity: { kind: 'pattern', argIndex: 0 },
    permissionTier: 'query-only',
  }),

  // ---- writes ----
  SET: tbl({
    readOnly: false,
    sizeGuard: { kind: 'unbounded' },
    keyArity: { kind: 'single', argIndex: 0 },
    permissionTier: 'read-write',
  }),
  SETEX: tbl({
    readOnly: false,
    sizeGuard: { kind: 'unbounded' },
    keyArity: { kind: 'single', argIndex: 0 },
    permissionTier: 'read-write',
  }),
  MSET: tbl({
    readOnly: false,
    sizeGuard: { kind: 'unbounded' },
    keyArity: { kind: 'multi-variable', startIndex: 0, step: 2 },
    permissionTier: 'read-write',
  }),
  HSET: tbl({
    readOnly: false,
    sizeGuard: { kind: 'unbounded' },
    keyArity: { kind: 'single', argIndex: 0 },
    permissionTier: 'read-write',
  }),
  HMSET: tbl({
    readOnly: false,
    sizeGuard: { kind: 'unbounded' },
    keyArity: { kind: 'single', argIndex: 0 },
    permissionTier: 'read-write',
  }),
  HDEL: tbl({
    readOnly: false,
    sizeGuard: { kind: 'unbounded' },
    keyArity: { kind: 'single', argIndex: 0 },
    permissionTier: 'read-write',
  }),
  RPUSH: tbl({
    readOnly: false,
    sizeGuard: { kind: 'unbounded' },
    keyArity: { kind: 'single', argIndex: 0 },
    permissionTier: 'read-write',
  }),
  LPUSH: tbl({
    readOnly: false,
    sizeGuard: { kind: 'unbounded' },
    keyArity: { kind: 'single', argIndex: 0 },
    permissionTier: 'read-write',
  }),
  LREM: tbl({
    readOnly: false,
    sizeGuard: { kind: 'unbounded' },
    keyArity: { kind: 'single', argIndex: 0 },
    permissionTier: 'read-write',
  }),
  SADD: tbl({
    readOnly: false,
    sizeGuard: { kind: 'unbounded' },
    keyArity: { kind: 'single', argIndex: 0 },
    permissionTier: 'read-write',
  }),
  SREM: tbl({
    readOnly: false,
    sizeGuard: { kind: 'unbounded' },
    keyArity: { kind: 'single', argIndex: 0 },
    permissionTier: 'read-write',
  }),
  ZADD: tbl({
    readOnly: false,
    sizeGuard: { kind: 'unbounded' },
    keyArity: { kind: 'single', argIndex: 0 },
    permissionTier: 'read-write',
  }),
  ZREM: tbl({
    readOnly: false,
    sizeGuard: { kind: 'unbounded' },
    keyArity: { kind: 'single', argIndex: 0 },
    permissionTier: 'read-write',
  }),
  DEL: tbl({
    readOnly: false,
    sizeGuard: { kind: 'unbounded' },
    keyArity: { kind: 'multi-variable', startIndex: 0, step: 1 },
    permissionTier: 'read-write',
  }),
  UNLINK: tbl({
    readOnly: false,
    sizeGuard: { kind: 'unbounded' },
    keyArity: { kind: 'multi-variable', startIndex: 0, step: 1 },
    permissionTier: 'read-write',
  }),
  EXPIRE: tbl({
    readOnly: false,
    sizeGuard: { kind: 'unbounded' },
    keyArity: { kind: 'single', argIndex: 0 },
    permissionTier: 'read-write',
  }),
  PERSIST: tbl({
    readOnly: false,
    sizeGuard: { kind: 'unbounded' },
    keyArity: { kind: 'single', argIndex: 0 },
    permissionTier: 'read-write',
  }),
  RENAME: tbl({
    readOnly: false,
    sizeGuard: { kind: 'unbounded' },
    keyArity: { kind: 'multi-fixed', argIndices: [0, 1] },
    permissionTier: 'read-write',
  }),

  // ---- admin reject ----
  FLUSHDB: tbl({
    readOnly: false,
    sizeGuard: { kind: 'reject', reason: 'FLUSHDB destroys data' },
    keyArity: { kind: 'no-key' },
    permissionTier: 'admin',
  }),
  FLUSHALL: tbl({
    readOnly: false,
    sizeGuard: { kind: 'reject', reason: 'FLUSHALL destroys data' },
    keyArity: { kind: 'no-key' },
    permissionTier: 'admin',
  }),
  SHUTDOWN: tbl({
    readOnly: false,
    sizeGuard: { kind: 'reject', reason: 'SHUTDOWN stops the server' },
    keyArity: { kind: 'no-key' },
    permissionTier: 'admin',
  }),
  DEBUG: tbl({
    readOnly: false,
    sizeGuard: { kind: 'reject', reason: 'DEBUG is unsafe' },
    keyArity: { kind: 'no-key' },
    permissionTier: 'admin',
  }),
  'CONFIG SET': tbl({
    readOnly: false,
    sizeGuard: { kind: 'reject', reason: 'CONFIG SET mutates server state' },
    keyArity: { kind: 'no-key' },
    permissionTier: 'admin',
  }),
})

export function getCommandSpec(name: string): RedisCommandSpec | undefined {
  return REDIS_COMMAND_TABLE[name.toUpperCase()]
}
