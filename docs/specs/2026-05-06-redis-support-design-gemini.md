# dbcli Redis Support Design Specification

**Date**: 2026-05-06
**Target Version**: v1.8.0
**Status**: Superseded by `2026-05-06-redis-support-design.md`

---

## 1. Overview

This specification details the implementation of Redis support in `dbcli`. The goal is to provide a consistent interface for interacting with Redis while maintaining the safety and productivity features of `dbcli`.

## 2. Architecture

### 2.1 RedisAdapter
A new `RedisAdapter` will be implemented in `src/adapters/redis-adapter.ts`. It will implement the `QueryableAdapter` interface.

- **Driver**: `ioredis` (v5+).
- **Interface Alignment**: 
    - `connect()`: Establish connection to Redis.
    - `disconnect()`: Close the connection.
    - `execute(commandString)`: Parse and execute Redis commands.
    - `listCollections()`: List keys via `SCAN`.
    - `getTableSchema(key)`: Inspect key metadata (Type, TTL, Size).
    - `insert/update/delete`: Map to `SET/HSET`, etc.

### 2.2 Factory Integration
`AdapterFactory.createAdapter` will be updated to handle `system: 'redis'`.

## 3. Functional Details

### 3.1 Query Execution (`dbcli query`)
- **Syntax**: Standard Redis string commands (e.g., `GET key`, `HGETALL user:1`, `LRANGE list 0 -1`).
- **Parsing**: A robust string parser will handle quoted arguments to support keys with spaces.
- **Formatting**: 
    - `HGETALL`: Returns `Field | Value` table.
    - `LRANGE/SMEMBERS`: Returns a single-column table of values.
    - `SCAN`: Returns a list of keys.
    - Simple values: Wrapped in a single-row/single-column table.

### 3.2 Key Discovery (`dbcli list`)
- **Behavior**: Executes `SCAN 0 COUNT 1000`.
- **Summary**: Displays `DBSIZE` to show total keys in the database.
- **Output**: `Key | Type | TTL`.

### 3.3 Key Metadata (`dbcli schema <key>`)
- **Type**: Derived from `TYPE <key>`.
- **TTL**: Derived from `TTL <key>` or `PTTL <key>`.
- **Size**: Derived from `STRLEN`, `HLEN`, `LLEN`, `SCARD`, or `ZCARD` depending on type.

## 4. Security & Safeguards

### 4.1 Permission Levels
- **Query-only**: `GET`, `MGET`, `HGET`, `HGETALL`, `LRANGE`, `SMEMBERS`, `ZRANGE`, `SCAN`, `TYPE`, `TTL`, `EXISTS`.
- **Read-Write**: Adds `SET`, `SETEX`, `HSET`, `LPUSH`, `RPUSH`, `SADD`, `ZADD`, `DEL`, `EXPIRE`.
- **Admin**: Adds `FLUSHDB`, `CONFIG`, `INFO`, `CLIENT LIST`.

### 4.2 Blacklisting
- **Key Patterns**: Uses the existing `blacklist.tables` configuration mapped to Redis key patterns (e.g., `auth:*`).
- **Command Filtering**: Blocked keys will be intercepted before command execution.

### 4.3 Size Guard
- **`KEYS *` Protection**: Intercept `KEYS *` and suggest `SCAN` or automatically convert it with a warning.
- **Large Structure Warning**: Warn users when performing `HGETALL` or `LRANGE` on keys with high element counts (e.g., > 10,000).

## 5. Implementation Roadmap
1. Implement `RedisAdapter` and basic `execute` logic.
2. Integrate into `AdapterFactory`.
3. Update `dbcli query` with Redis-specific formatting.
4. Update `dbcli list` and `dbcli schema`.
5. Implement Permission and Blacklist guards.
6. Add unit and integration tests.

## Lifecycle note

This alternative design is retained for provenance, but its proposed `ioredis`
driver and associated implementation shape were not adopted. The implemented
Redis contract is recorded in
[`2026-05-06-redis-support-design.md`](./2026-05-06-redis-support-design.md),
which documents the Bun-native client decision and current evidence.
