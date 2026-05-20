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

export type SizeGuardStrategy =
  | { kind: 'unbounded' }
  | { kind: 'rewrite-count'; argIndex: number } // SCAN family — inject/cap COUNT
  | { kind: 'rewrite-stop'; argIndex: number } // LRANGE/ZRANGE — clamp stop
  | { kind: 'rewrite-limit'; argIndex: number } // ZRANGEBYSCORE — inject/cap LIMIT
  | { kind: 'truncate' } // HGETALL/SMEMBERS/KEYS
  | { kind: 'reject'; reason: string } // FLUSHDB/SHUTDOWN/etc.

export type PermissionTier = 'query-only' | 'read-write' | 'admin'

export interface RedisCommandSpec {
  readOnly: boolean
  sizeGuard: SizeGuardStrategy
  keyArity: KeyArity
  permissionTier: PermissionTier
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
