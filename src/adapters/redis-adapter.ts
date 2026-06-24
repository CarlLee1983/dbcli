/**
 * Redis adapter using Bun's native Redis client (Bun.RedisClient).
 * Implements the QueryableAdapter interface so Redis shares the
 * MongoDB-style command surface (query/list/schema) rather than the
 * SQL DatabaseAdapter contract.
 */

import type { RedisClient } from 'bun'
import { ConnectionError } from './types'
import type { ConnectionOptions, ExecutionResult, QueryableAdapter, TableSchema } from './types'
import { rewriteArgs, truncateResult } from './redis/size-guard'
import { checkKeyArgs, globToRegex } from './redis/blacklist-enforcer'
import { BlacklistRejection } from './redis/types'
import { getCommandSpec } from './redis/command-metadata'
import { maskRedisRows } from './redis/value-masker'
import type { RedisMaskRule } from '@/types/blacklist'

type RedisClientOptions = {
  connectionTimeout?: number
  idleTimeout?: number
  autoReconnect?: boolean
  maxRetries?: number
  enableOfflineQueue?: boolean
  enableAutoPipelining?: boolean
  tls?: boolean
}

type RedisCtor = new (url?: string, options?: RedisClientOptions) => RedisClient

export class RedisAdapter implements QueryableAdapter {
  private client: RedisClient | null = null
  private blacklistRules: string[] = []

  constructor(
    private options: ConnectionOptions,
    private ClientClass: RedisCtor | null = null
  ) {
    if (options.port < 1 || options.port > 65535) {
      throw new Error(`Invalid port number: ${options.port}`)
    }
  }

  setBlacklistRules(rules: string[]): void {
    this.blacklistRules = rules
  }

  private maskRules: RedisMaskRule[] = []

  setMaskRules(rules: RedisMaskRule[]): void {
    this.maskRules = rules
  }

  private async resolveClientClass(): Promise<RedisCtor> {
    if (this.ClientClass) return this.ClientClass
    const mod = (await import('bun')) as unknown as { RedisClient: RedisCtor }
    return mod.RedisClient
  }

  private requireClient(): RedisClient {
    if (!this.client) {
      throw new ConnectionError('UNKNOWN', '尚未連線，請先呼叫 connect()', ['請先呼叫 connect()'])
    }
    return this.client
  }

  async connect(): Promise<void> {
    const ClientClass = await this.resolveClientClass()
    const url = buildRedisUrl(this.options)
    try {
      this.client = new ClientClass(url, {
        connectionTimeout: this.options.timeout ?? 5000,
        autoReconnect: false,
        maxRetries: 0,
        enableOfflineQueue: false,
      })
      // Silence the close handler so a failed handshake doesn't surface
      // as an unhandled error event — we report failures via the rejected
      // connect() Promise instead. Mock clients in unit tests don't expose
      // onclose, so guard the assignment.
      try {
        ;(this.client as unknown as { onclose?: (err?: unknown) => void }).onclose = () => {}
      } catch {
        // ignore — mocks may freeze the property
      }
      await this.client.connect()
    } catch (err) {
      // Ensure background reconnect loops stop after a failed handshake.
      try {
        ;(this.client as unknown as { close?: () => void } | null)?.close?.()
      } catch {
        // ignore
      }
      this.client = null

      const message = (err as Error).message ?? 'Unknown error'
      const code = inferConnectionCode(message, (err as { code?: string }).code)
      throw new ConnectionError(code, `Redis 連線失敗: ${message}`, [
        '請確認 Redis 服務正在執行（例如：redis-cli ping）',
        `請確認 host/port 正確：${this.options.host}:${this.options.port}`,
        '若有設密碼請確認 password 與 ACL 設定一致',
      ])
    }
  }

  async disconnect(): Promise<void> {
    if (!this.client) return
    try {
      this.client.close()
    } catch {
      // ignore — disconnect must never throw
    } finally {
      this.client = null
    }
  }

  async testConnection(): Promise<boolean> {
    const client = this.requireClient()
    const reply = await client.send('PING', [])
    return reply === 'PONG'
  }

  async getServerVersion(): Promise<string> {
    const client = this.requireClient()
    const info = (await client.send('INFO', ['server'])) as string
    const match = info.match(/^redis_version:(.+)$/m)
    return match?.[1]?.trim() ?? 'unknown'
  }

  // --- Discovery & schema (Task 3) ---------------------------------------

  async listCollections(): Promise<{ name: string; documentCount?: number }[]> {
    const client = this.requireClient()
    const keys = await scanAllKeys(client, '*', 1000)
    const rules = this.blacklistRules
    if (rules.length === 0) return keys.map((name) => ({ name }))
    const regexes = rules.map((p) => globToRegex(p))
    return keys.filter((k) => !regexes.some((r) => r.test(k))).map((name) => ({ name }))
  }

  /**
   * Sample up to `limit` key names for shell tab completion, applying the same
   * blacklist filtering as listCollections. `truncated` is true when the raw
   * scan hit the budget (i.e. the keyspace is larger than the sample), which is
   * derived before blacklist filtering since truncation is a property of the scan.
   */
  async sampleKeyNames(limit: number): Promise<{ names: string[]; truncated: boolean }> {
    const client = this.requireClient()
    const keys = await scanAllKeys(client, '*', limit, limit)
    const truncated = keys.length >= limit
    const rules = this.blacklistRules
    if (rules.length === 0) return { names: keys, truncated }
    const regexes = rules.map((p) => globToRegex(p))
    const names = keys.filter((k) => !regexes.some((r) => r.test(k)))
    return { names, truncated }
  }

  async getDbSize(): Promise<number> {
    const client = this.requireClient()
    const reply = (await client.send('DBSIZE', [])) as number
    return reply
  }

  async listTables(): Promise<TableSchema[]> {
    const collections = await this.listCollections()
    return collections.map((c) => ({ name: c.name, columns: [] }))
  }

  async getTableSchema(keyName: string): Promise<TableSchema> {
    const blk = checkKeyArgs('GET', [keyName], this.blacklistRules)
    if (!blk.ok) {
      throw new BlacklistRejection(
        `BlacklistRejection: schema lookup on key '${keyName}' rejected\n  matched blacklist pattern: ${blk.matchedPattern}`,
        'SCHEMA',
        keyName,
        blk.matchedPattern!
      )
    }
    const client = this.requireClient()
    const type = (await client.send('TYPE', [keyName])) as string as RedisType
    if (type === 'none') {
      return { name: keyName, columns: [], tableType: 'table' }
    }

    const ttl = await client.ttl(keyName)
    const sizeInfo = await readSizeInfo(client, keyName, type)

    const columns = [
      { name: 'type', type, nullable: false },
      {
        name: 'ttl',
        type: ttl >= 0 ? `${ttl}s` : ttl === -1 ? 'no expiry' : 'missing',
        nullable: false,
      },
      { name: 'size', type: String(sizeInfo.size), nullable: false },
    ]
    if (sizeInfo.sample) {
      columns.push({ name: 'sample', type: sizeInfo.sample, nullable: true })
    }

    return {
      name: keyName,
      columns,
      tableType: 'table',
      estimatedRowCount: sizeInfo.size,
    }
  }

  // --- Command execution (Task 4) ----------------------------------------

  private async dispatchCommand<T>(head: string, rest: string[]): Promise<T[]> {
    const client = this.requireClient()
    const reply = await client.send(head, rest)
    return wrapReply<T>(head, reply)
  }

  async execute<T>(
    command: string,
    _params?: unknown[],
    options?: { limit?: number; noLimit?: boolean }
  ): Promise<ExecutionResult<T>> {
    const tokens = parseRedisCommand(command)
    if (tokens.length === 0) {
      throw new Error('Redis 指令不可為空')
    }
    const head = String(tokens[0]).toUpperCase()
    const rest = tokens.slice(1).map(String)

    const blk = checkKeyArgs(head, rest, this.blacklistRules)
    if (!blk.ok) {
      const msg = blk.matchedKey
        ? `BlacklistRejection: command ${head} on key '${blk.matchedKey}' rejected\n  matched blacklist pattern: ${blk.matchedPattern}`
        : `BlacklistRejection: ${head} pattern overlaps blacklist pattern: ${blk.matchedPattern}`
      throw new BlacklistRejection(msg, head, blk.matchedKey ?? null, blk.matchedPattern!)
    }

    const noLimit = options?.noLimit === true
    const rw = rewriteArgs(head, rest, { noLimit })
    const warnings: NonNullable<ExecutionResult<T>['warnings']> = []
    if (rw.warning) warnings.push(rw.warning)

    const spec = getCommandSpec(head)
    if (spec?.sizeGuard.kind === 'truncate') {
      const client = this.requireClient()
      const rawReply = await client.send(head, rw.rewritten)
      const tr = truncateResult(head, rawReply, { noLimit })
      if (tr.warning) warnings.push(tr.warning)
      const rows = wrapReply<T>(head, tr.value)
      const masked = maskRedisRows(head, rest, rows as Record<string, unknown>[], this.maskRules)
      return finishResult<T>(masked as T[], warnings)
    }

    const rows = await this.dispatchCommand<T>(head, rw.rewritten)
    const masked = maskRedisRows(head, rest, rows as Record<string, unknown>[], this.maskRules)
    return finishResult<T>(masked as T[], warnings)
  }

  async insert(keyName: string, data: Record<string, unknown>): Promise<ExecutionResult<unknown>> {
    const client = this.requireClient()
    const type = data.__type ?? 'string'
    if (type === 'string') {
      const value = String(data.value ?? '')
      await client.set(keyName, value)
      if (typeof data.ttl === 'number' && data.ttl > 0) {
        await client.expire(keyName, data.ttl)
      }
      return { rows: [], affectedRows: 1 }
    }
    if (type === 'hash') {
      const fields = data.fields as Record<string, string> | undefined
      if (!fields) throw new Error('hash insert 需要 fields 物件')
      const flat: string[] = []
      for (const [k, v] of Object.entries(fields)) flat.push(k, String(v))
      await client.hmset(keyName, flat)
      return { rows: [], affectedRows: Object.keys(fields).length }
    }
    if (type === 'list') {
      const values = data.values as string[] | undefined
      if (!values || !Array.isArray(values)) throw new Error('list insert 需要 values 陣列')
      await client.send('RPUSH', [keyName, ...values.map(String)])
      return { rows: [], affectedRows: values.length }
    }
    if (type === 'set') {
      const values = data.values as string[] | undefined
      if (!values || !Array.isArray(values)) throw new Error('set insert 需要 values 陣列')
      await client.send('SADD', [keyName, ...values.map(String)])
      return { rows: [], affectedRows: values.length }
    }
    if (type === 'zset') {
      const members = data.members as Record<string, number> | undefined
      if (!members) throw new Error('zset insert 需要 members 物件 (member -> score)')
      const flat: string[] = []
      for (const [m, s] of Object.entries(members)) flat.push(String(s), m)
      await client.send('ZADD', [keyName, ...flat])
      return { rows: [], affectedRows: Object.keys(members).length }
    }
    throw new Error(`不支援的 insert 類型: ${String(type)}`)
  }

  async update(
    keyName: string,
    _filter: Record<string, unknown>,
    update: Record<string, unknown>
  ): Promise<ExecutionResult<unknown>> {
    const client = this.requireClient()
    const fields = update.fields as Record<string, string> | undefined
    if (fields) {
      const flat: string[] = []
      for (const [k, v] of Object.entries(fields)) flat.push(k, String(v))
      await client.hmset(keyName, flat)
      return { rows: [], affectedRows: Object.keys(fields).length }
    }
    const type = update.__type
    if (type === 'list') {
      const values = update.values as string[]
      await client.send('RPUSH', [keyName, ...values.map(String)])
      return { rows: [], affectedRows: values.length }
    }
    if (type === 'set') {
      const values = update.values as string[]
      await client.send('SADD', [keyName, ...values.map(String)])
      return { rows: [], affectedRows: values.length }
    }
    if (type === 'zset') {
      const members = update.members as Record<string, number>
      const flat: string[] = []
      for (const [m, s] of Object.entries(members)) flat.push(String(s), m)
      await client.send('ZADD', [keyName, ...flat])
      return { rows: [], affectedRows: Object.keys(members).length }
    }
    if ('value' in update) {
      await client.set(keyName, String(update.value))
      return { rows: [], affectedRows: 1 }
    }
    throw new Error('update 需要 fields, values, members 或 value')
  }

  async delete(
    keyName: string,
    filter: Record<string, unknown>
  ): Promise<ExecutionResult<unknown>> {
    const client = this.requireClient()
    const field = filter.field as string | undefined
    if (field) {
      const removed = (await client.send('HDEL', [keyName, field])) as number
      return { rows: [], affectedRows: removed }
    }
    const value = filter.value as string | undefined
    if (value) {
      const type = (await client.send('TYPE', [keyName])) as string
      let removed = 0
      if (type === 'list') {
        removed = (await client.send('LREM', [keyName, '0', value])) as number
      } else if (type === 'set') {
        removed = (await client.send('SREM', [keyName, value])) as number
      } else if (type === 'zset') {
        removed = (await client.send('ZREM', [keyName, value])) as number
      }
      return { rows: [], affectedRows: removed }
    }
    const removed = await client.del(keyName)
    return { rows: [], affectedRows: removed }
  }
}

// ============================================================================
// Module-level helpers
// ============================================================================

function finishResult<T>(
  rows: T[],
  warnings: NonNullable<ExecutionResult<T>['warnings']>
): ExecutionResult<T> {
  const columnNames = rows[0] ? Object.keys(rows[0] as Record<string, unknown>) : ['value']
  return {
    rows,
    affectedRows: rows.length,
    rowCount: rows.length,
    columnNames,
    ...(warnings.length > 0 ? { warnings } : {}),
  }
}

type RedisType = 'string' | 'list' | 'hash' | 'set' | 'zset' | 'stream' | 'none'

/**
 * Build a redis:// URL from ConnectionOptions. Bun's RedisClient takes a URL
 * rather than discrete host/port/password fields.
 */
export function buildRedisUrl(opts: ConnectionOptions): string {
  let auth = ''
  if (opts.user || opts.password) {
    const u = encodeURIComponent(opts.user || '')
    const p = encodeURIComponent(opts.password || '')
    auth = `${u}:${p}@`
  }
  const dbPart = opts.database ? `/${opts.database}` : ''
  return `redis://${auth}${opts.host}:${opts.port}${dbPart}`
}

function inferConnectionCode(
  message: string,
  driverCode?: string
): 'ECONNREFUSED' | 'ETIMEDOUT' | 'AUTH_FAILED' | 'ENOTFOUND' | 'UNKNOWN' {
  const m = message.toLowerCase()
  if (driverCode === 'ERR_REDIS_AUTHENTICATION_FAILED') return 'AUTH_FAILED'
  if (driverCode === 'ERR_REDIS_CONNECTION_CLOSED') return 'ECONNREFUSED'
  if (driverCode === 'ECONNREFUSED' || m.includes('econnrefused') || m.includes('refused')) {
    return 'ECONNREFUSED'
  }
  if (driverCode === 'ETIMEDOUT' || m.includes('timeout') || m.includes('timed out')) {
    return 'ETIMEDOUT'
  }
  if (driverCode === 'ENOTFOUND' || m.includes('enotfound') || m.includes('getaddrinfo')) {
    return 'ENOTFOUND'
  }
  if (m.includes('noauth') || m.includes('wrongpass') || m.includes('auth')) {
    return 'AUTH_FAILED'
  }
  return 'UNKNOWN'
}

/**
 * Parse a Redis command string into tokens, honouring single/double
 * quotes and backslash escapes. Whitespace separates tokens.
 */
export function parseRedisCommand(input: string): string[] {
  const tokens: string[] = []
  let buf = ''
  let quote: '"' | "'" | null = null
  let i = 0
  let inToken = false

  const push = () => {
    tokens.push(buf)
    buf = ''
    inToken = false
  }

  while (i < input.length) {
    const ch = input[i]!
    if (quote) {
      if (ch === '\\' && i + 1 < input.length) {
        buf += input[i + 1]
        i += 2
        continue
      }
      if (ch === quote) {
        quote = null
        i++
        continue
      }
      buf += ch
      i++
      continue
    }

    if (ch === '"' || ch === "'") {
      quote = ch
      inToken = true
      i++
      continue
    }
    if (/\s/.test(ch)) {
      if (inToken) push()
      i++
      continue
    }
    if (ch === '\\' && i + 1 < input.length) {
      buf += input[i + 1]
      i += 2
      inToken = true
      continue
    }
    buf += ch
    inToken = true
    i++
  }
  if (quote) {
    throw new Error('Redis 指令含有未閉合的引號')
  }
  if (inToken) push()
  return tokens
}

async function scanAllKeys(
  client: RedisClient,
  pattern: string,
  count: number,
  maxKeys: number = 100_000
): Promise<string[]> {
  const seen = new Set<string>()
  let cursor = '0'
  do {
    const reply = (await client.send('SCAN', [
      cursor,
      'MATCH',
      pattern,
      'COUNT',
      String(count),
    ])) as [string, string[]]
    const [next, batch] = reply
    for (const k of batch) seen.add(k)
    cursor = next
    if (seen.size >= maxKeys) break
  } while (cursor !== '0')
  return Array.from(seen)
}

async function readSizeInfo(
  client: RedisClient,
  key: string,
  type: RedisType
): Promise<{ size: number; sample?: string }> {
  switch (type) {
    case 'string': {
      const len = (await client.send('STRLEN', [key])) as number
      return { size: len }
    }
    case 'hash': {
      const len = (await client.send('HLEN', [key])) as number
      const fields = (await client.send('HKEYS', [key])) as string[]
      return { size: len, sample: fields.slice(0, 5).join(', ') }
    }
    case 'list': {
      const len = (await client.send('LLEN', [key])) as number
      return { size: len }
    }
    case 'set': {
      const len = (await client.send('SCARD', [key])) as number
      return { size: len }
    }
    case 'zset': {
      const len = (await client.send('ZCARD', [key])) as number
      return { size: len }
    }
    case 'stream': {
      const len = (await client.send('XLEN', [key])) as number
      return { size: len }
    }
    default:
      return { size: 0 }
  }
}

function wrapReply<T>(command: string, reply: unknown): T[] {
  const upper = command.toUpperCase()
  if (reply === null || reply === undefined) return [] as T[]

  // Handle Strings, Numbers, Booleans, and Buffers (scalars)
  if (
    typeof reply === 'string' ||
    typeof reply === 'number' ||
    typeof reply === 'boolean' ||
    Buffer.isBuffer(reply)
  ) {
    return [{ value: reply.toString() } as unknown as T]
  }

  if (Array.isArray(reply)) {
    if (upper === 'HGETALL') {
      // RESP2 returns flat [k1, v1, k2, v2, ...]
      const obj: Record<string, unknown> = {}
      for (let i = 0; i < reply.length; i += 2) {
        obj[String(reply[i])] = reply[i + 1]
      }
      return [obj as T]
    }
    // Generic list response
    return reply.map((value, idx) => ({ index: idx, value: String(value) }) as unknown as T)
  }

  if (typeof reply === 'object') {
    // RESP3 Map response (e.g. HGETALL) — already an object
    return [reply as T]
  }

  return [{ value: String(reply) } as unknown as T]
}
