import type { RedisCommandSpec } from './types'

const tbl = (s: RedisCommandSpec) => s

export const REDIS_COMMAND_TABLE: Readonly<Record<string, RedisCommandSpec>> = Object.freeze({
  // ---- read-only, unbounded ----
  PING: tbl({
    readOnly: true,
    sizeGuard: { kind: 'unbounded' },
    keyArity: { kind: 'no-key' },
  }),
  INFO: tbl({
    readOnly: true,
    sizeGuard: { kind: 'unbounded' },
    keyArity: { kind: 'no-key' },
  }),
  DBSIZE: tbl({
    readOnly: true,
    sizeGuard: { kind: 'unbounded' },
    keyArity: { kind: 'no-key' },
  }),
  TYPE: tbl({
    readOnly: true,
    sizeGuard: { kind: 'unbounded' },
    keyArity: { kind: 'single', argIndex: 0 },
  }),
  EXISTS: tbl({
    readOnly: true,
    sizeGuard: { kind: 'unbounded' },
    keyArity: { kind: 'multi-variable', startIndex: 0, step: 1 },
  }),
  TTL: tbl({
    readOnly: true,
    sizeGuard: { kind: 'unbounded' },
    keyArity: { kind: 'single', argIndex: 0 },
  }),
  GET: tbl({
    readOnly: true,
    sizeGuard: { kind: 'unbounded' },
    keyArity: { kind: 'single', argIndex: 0 },
  }),
  MGET: tbl({
    readOnly: true,
    sizeGuard: { kind: 'unbounded' },
    keyArity: { kind: 'multi-variable', startIndex: 0, step: 1 },
  }),
  STRLEN: tbl({
    readOnly: true,
    sizeGuard: { kind: 'unbounded' },
    keyArity: { kind: 'single', argIndex: 0 },
  }),
  HGET: tbl({
    readOnly: true,
    sizeGuard: { kind: 'unbounded' },
    keyArity: { kind: 'single', argIndex: 0 },
  }),
  HEXISTS: tbl({
    readOnly: true,
    sizeGuard: { kind: 'unbounded' },
    keyArity: { kind: 'single', argIndex: 0 },
  }),
  HLEN: tbl({
    readOnly: true,
    sizeGuard: { kind: 'unbounded' },
    keyArity: { kind: 'single', argIndex: 0 },
  }),
  HMGET: tbl({
    readOnly: true,
    sizeGuard: { kind: 'unbounded' },
    keyArity: { kind: 'single', argIndex: 0 },
  }),
  LLEN: tbl({
    readOnly: true,
    sizeGuard: { kind: 'unbounded' },
    keyArity: { kind: 'single', argIndex: 0 },
  }),
  LINDEX: tbl({
    readOnly: true,
    sizeGuard: { kind: 'unbounded' },
    keyArity: { kind: 'single', argIndex: 0 },
  }),
  SCARD: tbl({
    readOnly: true,
    sizeGuard: { kind: 'unbounded' },
    keyArity: { kind: 'single', argIndex: 0 },
  }),
  SISMEMBER: tbl({
    readOnly: true,
    sizeGuard: { kind: 'unbounded' },
    keyArity: { kind: 'single', argIndex: 0 },
  }),
  ZCARD: tbl({
    readOnly: true,
    sizeGuard: { kind: 'unbounded' },
    keyArity: { kind: 'single', argIndex: 0 },
  }),
  ZSCORE: tbl({
    readOnly: true,
    sizeGuard: { kind: 'unbounded' },
    keyArity: { kind: 'single', argIndex: 0 },
  }),
  XLEN: tbl({
    readOnly: true,
    sizeGuard: { kind: 'unbounded' },
    keyArity: { kind: 'single', argIndex: 0 },
  }),

  // ---- read-only, rewrite ----
  SCAN: tbl({
    readOnly: true,
    sizeGuard: { kind: 'rewrite-count', argIndex: 0 },
    // `no-key` was true and useless: `SCAN` names no key, but it *takes a glob*
    // and returns key names, which is the disclosure `KEYS` is gated for.
    keyArity: { kind: 'pattern-after-token', token: 'MATCH' },
  }),
  HSCAN: tbl({
    readOnly: true,
    sizeGuard: { kind: 'rewrite-count', argIndex: 1 },
    keyArity: { kind: 'single', argIndex: 0 },
  }),
  SSCAN: tbl({
    readOnly: true,
    sizeGuard: { kind: 'rewrite-count', argIndex: 1 },
    keyArity: { kind: 'single', argIndex: 0 },
  }),
  ZSCAN: tbl({
    readOnly: true,
    sizeGuard: { kind: 'rewrite-count', argIndex: 1 },
    keyArity: { kind: 'single', argIndex: 0 },
  }),
  LRANGE: tbl({
    readOnly: true,
    sizeGuard: { kind: 'rewrite-stop', argIndex: 2 },
    keyArity: { kind: 'single', argIndex: 0 },
  }),
  ZRANGE: tbl({
    readOnly: true,
    sizeGuard: { kind: 'rewrite-stop', argIndex: 2 },
    keyArity: { kind: 'single', argIndex: 0 },
  }),
  ZREVRANGE: tbl({
    readOnly: true,
    sizeGuard: { kind: 'rewrite-stop', argIndex: 2 },
    keyArity: { kind: 'single', argIndex: 0 },
  }),
  ZRANGEBYSCORE: tbl({
    readOnly: true,
    sizeGuard: { kind: 'rewrite-limit', argIndex: 3 },
    keyArity: { kind: 'single', argIndex: 0 },
  }),

  // ---- read-only, truncate ----
  HGETALL: tbl({
    readOnly: true,
    sizeGuard: { kind: 'truncate' },
    keyArity: { kind: 'single', argIndex: 0 },
  }),
  HKEYS: tbl({
    readOnly: true,
    sizeGuard: { kind: 'truncate' },
    keyArity: { kind: 'single', argIndex: 0 },
  }),
  HVALS: tbl({
    readOnly: true,
    sizeGuard: { kind: 'truncate' },
    keyArity: { kind: 'single', argIndex: 0 },
  }),
  SMEMBERS: tbl({
    readOnly: true,
    sizeGuard: { kind: 'truncate' },
    keyArity: { kind: 'single', argIndex: 0 },
  }),
  KEYS: tbl({
    readOnly: true,
    sizeGuard: { kind: 'truncate' },
    keyArity: { kind: 'pattern', argIndex: 0 },
  }),

  // ---- writes ----
  SET: tbl({
    readOnly: false,
    sizeGuard: { kind: 'unbounded' },
    keyArity: { kind: 'single', argIndex: 0 },
  }),
  SETEX: tbl({
    readOnly: false,
    sizeGuard: { kind: 'unbounded' },
    keyArity: { kind: 'single', argIndex: 0 },
  }),
  MSET: tbl({
    readOnly: false,
    sizeGuard: { kind: 'unbounded' },
    keyArity: { kind: 'multi-variable', startIndex: 0, step: 2 },
  }),
  HSET: tbl({
    readOnly: false,
    sizeGuard: { kind: 'unbounded' },
    keyArity: { kind: 'single', argIndex: 0 },
  }),
  HMSET: tbl({
    readOnly: false,
    sizeGuard: { kind: 'unbounded' },
    keyArity: { kind: 'single', argIndex: 0 },
  }),
  HDEL: tbl({
    readOnly: false,
    sizeGuard: { kind: 'unbounded' },
    keyArity: { kind: 'single', argIndex: 0 },
  }),
  RPUSH: tbl({
    readOnly: false,
    sizeGuard: { kind: 'unbounded' },
    keyArity: { kind: 'single', argIndex: 0 },
  }),
  LPUSH: tbl({
    readOnly: false,
    sizeGuard: { kind: 'unbounded' },
    keyArity: { kind: 'single', argIndex: 0 },
  }),
  LREM: tbl({
    readOnly: false,
    sizeGuard: { kind: 'unbounded' },
    keyArity: { kind: 'single', argIndex: 0 },
  }),
  SADD: tbl({
    readOnly: false,
    sizeGuard: { kind: 'unbounded' },
    keyArity: { kind: 'single', argIndex: 0 },
  }),
  SREM: tbl({
    readOnly: false,
    sizeGuard: { kind: 'unbounded' },
    keyArity: { kind: 'single', argIndex: 0 },
  }),
  ZADD: tbl({
    readOnly: false,
    sizeGuard: { kind: 'unbounded' },
    keyArity: { kind: 'single', argIndex: 0 },
  }),
  ZREM: tbl({
    readOnly: false,
    sizeGuard: { kind: 'unbounded' },
    keyArity: { kind: 'single', argIndex: 0 },
  }),
  DEL: tbl({
    readOnly: false,
    sizeGuard: { kind: 'unbounded' },
    keyArity: { kind: 'multi-variable', startIndex: 0, step: 1 },
  }),
  UNLINK: tbl({
    readOnly: false,
    sizeGuard: { kind: 'unbounded' },
    keyArity: { kind: 'multi-variable', startIndex: 0, step: 1 },
  }),
  EXPIRE: tbl({
    readOnly: false,
    sizeGuard: { kind: 'unbounded' },
    keyArity: { kind: 'single', argIndex: 0 },
  }),
  PERSIST: tbl({
    readOnly: false,
    sizeGuard: { kind: 'unbounded' },
    keyArity: { kind: 'single', argIndex: 0 },
  }),
  RENAME: tbl({
    readOnly: false,
    sizeGuard: { kind: 'unbounded' },
    keyArity: { kind: 'multi-fixed', argIndices: [0, 1] },
  }),

  // ---- admin reject ----
  FLUSHDB: tbl({
    readOnly: false,
    sizeGuard: { kind: 'reject', reason: 'FLUSHDB destroys data' },
    keyArity: { kind: 'no-key' },
  }),
  FLUSHALL: tbl({
    readOnly: false,
    sizeGuard: { kind: 'reject', reason: 'FLUSHALL destroys data' },
    keyArity: { kind: 'no-key' },
  }),
  SHUTDOWN: tbl({
    readOnly: false,
    sizeGuard: { kind: 'reject', reason: 'SHUTDOWN stops the server' },
    keyArity: { kind: 'no-key' },
  }),
  DEBUG: tbl({
    readOnly: false,
    sizeGuard: { kind: 'reject', reason: 'DEBUG is unsafe' },
    keyArity: { kind: 'no-key' },
  }),
  // ---- added when the two tables were reconciled ----
  //
  // Every one of these was in `REDIS_COMMAND_PERMISSION` and not here, so
  // `checkKeyArgs` had no idea where their keys were and let them through. The
  // size guards are all `unbounded`, which is what a missing spec already
  // meant: this change is about *where the keys are*, and widening or narrowing
  // a response cap at the same time would hide which of the two did what.
  PTTL: tbl({
    readOnly: true,
    sizeGuard: { kind: 'unbounded' },
    keyArity: { kind: 'single', argIndex: 0 },
  }),
  SETNX: tbl({
    readOnly: false,
    sizeGuard: { kind: 'unbounded' },
    keyArity: { kind: 'single', argIndex: 0 },
  }),
  PSETEX: tbl({
    readOnly: false,
    sizeGuard: { kind: 'unbounded' },
    keyArity: { kind: 'single', argIndex: 0 },
  }),
  APPEND: tbl({
    readOnly: false,
    sizeGuard: { kind: 'unbounded' },
    keyArity: { kind: 'single', argIndex: 0 },
  }),
  INCR: tbl({
    readOnly: false,
    sizeGuard: { kind: 'unbounded' },
    keyArity: { kind: 'single', argIndex: 0 },
  }),
  INCRBY: tbl({
    readOnly: false,
    sizeGuard: { kind: 'unbounded' },
    keyArity: { kind: 'single', argIndex: 0 },
  }),
  DECR: tbl({
    readOnly: false,
    sizeGuard: { kind: 'unbounded' },
    keyArity: { kind: 'single', argIndex: 0 },
  }),
  DECRBY: tbl({
    readOnly: false,
    sizeGuard: { kind: 'unbounded' },
    keyArity: { kind: 'single', argIndex: 0 },
  }),
  HSETNX: tbl({
    readOnly: false,
    sizeGuard: { kind: 'unbounded' },
    keyArity: { kind: 'single', argIndex: 0 },
  }),
  HINCRBY: tbl({
    readOnly: false,
    sizeGuard: { kind: 'unbounded' },
    keyArity: { kind: 'single', argIndex: 0 },
  }),
  LPOP: tbl({
    readOnly: false,
    sizeGuard: { kind: 'unbounded' },
    keyArity: { kind: 'single', argIndex: 0 },
  }),
  RPOP: tbl({
    readOnly: false,
    sizeGuard: { kind: 'unbounded' },
    keyArity: { kind: 'single', argIndex: 0 },
  }),
  LSET: tbl({
    readOnly: false,
    sizeGuard: { kind: 'unbounded' },
    keyArity: { kind: 'single', argIndex: 0 },
  }),
  XADD: tbl({
    readOnly: false,
    sizeGuard: { kind: 'unbounded' },
    keyArity: { kind: 'single', argIndex: 0 },
  }),
  XDEL: tbl({
    readOnly: false,
    sizeGuard: { kind: 'unbounded' },
    keyArity: { kind: 'single', argIndex: 0 },
  }),
  XRANGE: tbl({
    readOnly: true,
    sizeGuard: { kind: 'unbounded' },
    keyArity: { kind: 'single', argIndex: 0 },
  }),
  XREVRANGE: tbl({
    readOnly: true,
    sizeGuard: { kind: 'unbounded' },
    keyArity: { kind: 'single', argIndex: 0 },
  }),
  EXPIREAT: tbl({
    readOnly: false,
    sizeGuard: { kind: 'unbounded' },
    keyArity: { kind: 'single', argIndex: 0 },
  }),
  PEXPIRE: tbl({
    readOnly: false,
    sizeGuard: { kind: 'unbounded' },
    keyArity: { kind: 'single', argIndex: 0 },
  }),
  MSETNX: tbl({
    readOnly: false,
    sizeGuard: { kind: 'unbounded' },
    keyArity: { kind: 'multi-variable', startIndex: 0, step: 2 },
  }),
  // `XREAD [COUNT n] [BLOCK ms] STREAMS <key...> <id...>` — the keys start after
  // the `STREAMS` token and there is no fixed index for them.
  XREAD: tbl({
    readOnly: true,
    sizeGuard: { kind: 'unbounded' },
    keyArity: { kind: 'after-token', token: 'STREAMS' },
  }),
  ECHO: tbl({
    readOnly: true,
    sizeGuard: { kind: 'unbounded' },
    keyArity: { kind: 'no-key' },
  }),
  CONFIG: tbl({
    readOnly: false,
    sizeGuard: { kind: 'unbounded' },
    keyArity: { kind: 'no-key' },
  }),
  CLIENT: tbl({
    readOnly: false,
    sizeGuard: { kind: 'unbounded' },
    keyArity: { kind: 'no-key' },
  }),
  MONITOR: tbl({
    readOnly: false,
    sizeGuard: { kind: 'unbounded' },
    keyArity: { kind: 'no-key' },
  }),
  SAVE: tbl({
    readOnly: false,
    sizeGuard: { kind: 'unbounded' },
    keyArity: { kind: 'no-key' },
  }),
  BGSAVE: tbl({
    readOnly: false,
    sizeGuard: { kind: 'unbounded' },
    keyArity: { kind: 'no-key' },
  }),
  BGREWRITEAOF: tbl({
    readOnly: false,
    sizeGuard: { kind: 'unbounded' },
    keyArity: { kind: 'no-key' },
  }),
  REPLICAOF: tbl({
    readOnly: false,
    sizeGuard: { kind: 'unbounded' },
    keyArity: { kind: 'no-key' },
  }),
  SLAVEOF: tbl({
    readOnly: false,
    sizeGuard: { kind: 'unbounded' },
    keyArity: { kind: 'no-key' },
  }),
  ACL: tbl({
    readOnly: false,
    sizeGuard: { kind: 'unbounded' },
    keyArity: { kind: 'no-key' },
  }),
  'CONFIG SET': tbl({
    readOnly: false,
    sizeGuard: { kind: 'reject', reason: 'CONFIG SET mutates server state' },
    keyArity: { kind: 'no-key' },
  }),
})

export function getCommandSpec(name: string): RedisCommandSpec | undefined {
  return REDIS_COMMAND_TABLE[name.toUpperCase()]
}
