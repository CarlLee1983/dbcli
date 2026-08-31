/**
 * Shared types for the Redis command-metadata table, size guard, and
 * blacklist enforcer. Pure data/type definitions — no I/O.
 */

export type KeyArity =
  | { kind: 'no-key' }
  | { kind: 'single'; argIndex: number }
  | { kind: 'multi-fixed'; argIndices: number[] }
  | { kind: 'multi-variable'; startIndex: number; step: number }
  | { kind: 'pattern'; argIndex: number }
  // Every argument after a marker token is treated as a key. `XREAD ... STREAMS
  // <key...> <id...>` is the case: the split between keys and ids is positional
  // and depends on the count, so the ids are checked too. That over-refuses a
  // stream id that happens to match a blacklist pattern, in the direction that
  // withholds.
  | { kind: 'after-token'; token: string }
  // A glob the user supplies, at no fixed position: `SCAN <cursor> [MATCH
  // <pattern>] [COUNT n] [TYPE t]`. Checked by overlap against the blacklist,
  // the same way `KEYS <pattern>` is.
  | { kind: 'pattern-after-token'; token: string }

export type SizeGuardStrategy =
  | { kind: 'unbounded' }
  | { kind: 'rewrite-count'; argIndex: number } // SCAN family — inject/cap COUNT
  | { kind: 'rewrite-stop'; argIndex: number } // LRANGE/ZRANGE — clamp stop
  | { kind: 'rewrite-limit'; argIndex: number } // ZRANGEBYSCORE — inject/cap LIMIT
  | { kind: 'truncate' } // HGETALL/SMEMBERS/KEYS
  | { kind: 'reject'; reason: string } // FLUSHDB/SHUTDOWN/etc.

/**
 * Where a command's keys are, and how much it may return.
 *
 * Deliberately *not* where its permission tier is. This interface carried a
 * `permissionTier` that nothing enforced — `REDIS_COMMAND_PERMISSION` in
 * `src/core/permission/redis.ts` is the map that decides — and the two had
 * drifted on five commands, including `KEYS` and `INFO`, which this table
 * called `query-only` while the enforcing map required `admin`. The type could
 * not even spell `data-admin`, so `DEL` was recorded as `read-write`.
 *
 * A second copy of an authority is not a cross-check, it is a thing to be
 * wrong. The tier now has one owner, and `command-table-parity.test.ts` holds
 * the one relationship that matters: everything the permission map allows has
 * an entry here, so the blacklist always knows where the keys are.
 */
export interface RedisCommandSpec {
  readOnly: boolean
  sizeGuard: SizeGuardStrategy
  keyArity: KeyArity
}

export class BlacklistRejection extends Error {
  constructor(
    message: string,
    public readonly command: string,
    public readonly matchedKey: string | null,
    public readonly matchedPattern: string
  ) {
    super(message)
    this.name = 'BlacklistRejection'
    Object.setPrototypeOf(this, BlacklistRejection.prototype)
  }
}

export const REDIS_LIMIT_DEFAULT = 1000
