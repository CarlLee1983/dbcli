import type { Permission } from '@/types'
import {
  PermissionError,
  permissionAtLeast,
  type StatementClassification,
  type StatementType,
} from '@/core/permission-guard'

// ============================================================================
// REDIS CLASSIFICATION
// ============================================================================

/**
 * Mapping from Redis command (uppercased) to the lowest permission tier
 * that may run it. Anything not in this map is denied by default.
 */
const REDIS_COMMAND_PERMISSION: Record<string, Permission> = {
  GET: 'query-only',
  MGET: 'query-only',
  STRLEN: 'query-only',
  EXISTS: 'query-only',
  TTL: 'query-only',
  PTTL: 'query-only',
  TYPE: 'query-only',
  SCAN: 'query-only',
  HGET: 'query-only',
  HGETALL: 'query-only',
  HKEYS: 'query-only',
  HVALS: 'query-only',
  HLEN: 'query-only',
  HEXISTS: 'query-only',
  HMGET: 'query-only',
  LRANGE: 'query-only',
  LLEN: 'query-only',
  LINDEX: 'query-only',
  SMEMBERS: 'query-only',
  SCARD: 'query-only',
  SISMEMBER: 'query-only',
  ZRANGE: 'query-only',
  ZREVRANGE: 'query-only',
  ZRANGEBYSCORE: 'query-only',
  ZCARD: 'query-only',
  ZSCORE: 'query-only',
  PING: 'query-only',
  ECHO: 'query-only',
  SET: 'read-write',
  SETEX: 'read-write',
  SETNX: 'read-write',
  PSETEX: 'read-write',
  MSET: 'read-write',
  MSETNX: 'read-write',
  APPEND: 'read-write',
  INCR: 'read-write',
  INCRBY: 'read-write',
  DECR: 'read-write',
  DECRBY: 'read-write',
  HSET: 'read-write',
  HSETNX: 'read-write',
  HMSET: 'read-write',
  HINCRBY: 'read-write',
  LPUSH: 'read-write',
  RPUSH: 'read-write',
  LPOP: 'read-write',
  RPOP: 'read-write',
  LSET: 'read-write',
  LREM: 'read-write',
  SADD: 'read-write',
  SREM: 'read-write',
  ZADD: 'read-write',
  ZREM: 'read-write',
  XADD: 'read-write',
  XDEL: 'data-admin',
  XLEN: 'query-only',
  XREAD: 'query-only',
  XRANGE: 'query-only',
  XREVRANGE: 'query-only',
  EXPIRE: 'read-write',
  EXPIREAT: 'read-write',
  PEXPIRE: 'read-write',
  PERSIST: 'read-write',
  RENAME: 'read-write',
  DEL: 'data-admin',
  UNLINK: 'data-admin',
  HDEL: 'data-admin',
  FLUSHDB: 'admin',
  FLUSHALL: 'admin',
  CONFIG: 'admin',
  INFO: 'admin',
  CLIENT: 'admin',
  DEBUG: 'admin',
  SHUTDOWN: 'admin',
  KEYS: 'admin',
  MONITOR: 'admin',
  SAVE: 'admin',
  BGSAVE: 'admin',
  BGREWRITEAOF: 'admin',
  REPLICAOF: 'admin',
  SLAVEOF: 'admin',
  ACL: 'admin',
}

/** Statement-style classification for a Redis command. */
export interface RedisCommandClassification {
  command: string
  requiredPermission: Permission | 'unknown'
  type: StatementType
  isDangerous: boolean
}

/**
 * Classify a Redis command into the minimum permission tier required.
 * Returns 'unknown' when the command is not whitelisted.
 */
export function classifyRedisCommand(command: string): RedisCommandClassification {
  const head = command.trim().split(/\s+/)[0]?.toUpperCase() ?? ''
  const required = REDIS_COMMAND_PERMISSION[head]

  let type: StatementType
  if (!required) type = 'UNKNOWN'
  else if (required === 'query-only') type = 'SELECT'
  else if (required === 'read-write') type = 'UPDATE'
  else if (required === 'data-admin') type = 'DELETE'
  else type = 'DROP'

  return {
    command: head,
    requiredPermission: required ?? 'unknown',
    type,
    isDangerous: required === 'admin' || required === 'data-admin',
  }
}

/**
 * Throw PermissionError if the Redis command is not allowed under the
 * given permission tier. Returns the classification on success.
 */
export function enforceRedisPermission(
  command: string,
  permission: Permission
): RedisCommandClassification {
  const classification = classifyRedisCommand(command)
  const required = classification.requiredPermission

  const stmt: StatementClassification = {
    type: classification.type,
    isDangerous: classification.isDangerous,
    keywords: [classification.command],
    isComposite: false,
    confidence: required === 'unknown' ? 'LOW' : 'HIGH',
  }

  if (required === 'unknown') {
    throw new PermissionError(
      `Redis command "${classification.command}" is not whitelisted; refusing to execute`,
      stmt,
      'admin'
    )
  }

  if (!permissionAtLeast(permission, required)) {
    throw new PermissionError(
      `Redis command "${classification.command}" requires ${required} permission`,
      stmt,
      required
    )
  }

  return classification
}
