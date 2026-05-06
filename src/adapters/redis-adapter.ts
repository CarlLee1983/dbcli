/**
 * Redis adapter using ioredis driver
 * Implements the QueryableAdapter interface so Redis shares the
 * MongoDB-style command surface (query/list/schema) rather than the
 * SQL DatabaseAdapter contract.
 */

import type { Redis as RedisClientType } from 'ioredis'
import { ConnectionError } from './types'
import type {
  ConnectionOptions,
  ExecutionResult,
  QueryableAdapter,
  TableSchema,
} from './types'

type RedisCtor = new (opts: {
  host?: string
  port?: number
  password?: string
  db?: number
  connectTimeout?: number
  lazyConnect?: boolean
  maxRetriesPerRequest?: number | null
  enableReadyCheck?: boolean
}) => RedisClientType

export class RedisAdapter implements QueryableAdapter {
  private client: RedisClientType | null = null

  constructor(
    private options: ConnectionOptions,
    private ClientClass: RedisCtor | null = null
  ) {
    if (options.port < 1 || options.port > 65535) {
      throw new Error(`Invalid port number: ${options.port}`)
    }
  }

  private async resolveClientClass(): Promise<RedisCtor> {
    if (this.ClientClass) return this.ClientClass
    const mod = await import('ioredis')
    return (mod.default ?? (mod as unknown as RedisCtor)) as RedisCtor
  }

  private requireClient(): RedisClientType {
    if (!this.client) {
      throw new ConnectionError('UNKNOWN', '尚未連線，請先呼叫 connect()', [
        '請先呼叫 connect()',
      ])
    }
    return this.client
  }

  async connect(): Promise<void> {
    const ClientClass = await this.resolveClientClass()
    try {
      this.client = new ClientClass({
        host: this.options.host,
        port: this.options.port,
        password: this.options.password || undefined,
        db: this.options.database ? Number(this.options.database) : 0,
        connectTimeout: this.options.timeout ?? 5000,
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        enableReadyCheck: true,
      })
      // Suppress ioredis's unhandled "error" event during the connect handshake
      // — we surface the failure through the rejected connect() Promise. The
      // mock client used in unit tests doesn't implement on/off, so guard.
      const emitter = this.client as unknown as {
        on?: (event: string, fn: () => void) => void
        off?: (event: string, fn: () => void) => void
      }
      const errorSink = () => {}
      emitter.on?.('error', errorSink)
      try {
        await (this.client as unknown as { connect(): Promise<void> }).connect()
      } finally {
        emitter.off?.('error', errorSink)
      }
    } catch (err) {
      // Ensure background reconnect loops stop after a failed handshake.
      try {
        ;(this.client as unknown as { disconnect(): void } | null)?.disconnect()
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
      await this.client.quit()
    } catch {
      try {
        this.client.disconnect()
      } catch {
        // ignore — disconnect must never throw
      }
    } finally {
      this.client = null
    }
  }

  async testConnection(): Promise<boolean> {
    const client = this.requireClient()
    const reply = await client.ping()
    return reply === 'PONG'
  }

  async getServerVersion(): Promise<string> {
    const client = this.requireClient()
    const info = await client.info('server')
    const match = info.match(/^redis_version:(.+)$/m)
    return match?.[1]?.trim() ?? 'unknown'
  }

  // --- Discovery & schema (Task 3) ---------------------------------------

  async listCollections(): Promise<{ name: string; documentCount?: number }[]> {
    const client = this.requireClient()
    const keys = await scanAllKeys(client, '*', 1000)
    return keys.map((name) => ({ name }))
  }

  async listTables(): Promise<TableSchema[]> {
    const collections = await this.listCollections()
    return collections.map((c) => ({ name: c.name, columns: [] }))
  }

  async getTableSchema(keyName: string): Promise<TableSchema> {
    const client = this.requireClient()
    const type = (await client.type(keyName)) as RedisType
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

  async execute<T>(
    command: string,
    _params?: unknown[],
    _options?: { limit?: number }
  ): Promise<ExecutionResult<T>> {
    const client = this.requireClient()
    const tokens = parseRedisCommand(command)
    if (tokens.length === 0) {
      throw new Error('Redis 指令不可為空')
    }
    const [head, ...rest] = tokens
    const reply = await (client as unknown as {
      call(cmd: string, ...args: unknown[]): Promise<unknown>
    }).call(head!, ...rest)
    const rows = wrapReply<T>(head!, reply)
    return { rows, affectedRows: rows.length }
  }

  async insert(
    keyName: string,
    data: Record<string, unknown>
  ): Promise<ExecutionResult<unknown>> {
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
      await (client as unknown as { hset(k: string, ...args: string[]): Promise<number> })
        .hset(keyName, ...flat)
      return { rows: [], affectedRows: Object.keys(fields).length }
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
      await (client as unknown as { hset(k: string, ...args: string[]): Promise<number> })
        .hset(keyName, ...flat)
      return { rows: [], affectedRows: Object.keys(fields).length }
    }
    if ('value' in update) {
      await client.set(keyName, String(update.value))
      return { rows: [], affectedRows: 1 }
    }
    throw new Error('update 需要 fields 或 value')
  }

  async delete(
    keyName: string,
    filter: Record<string, unknown>
  ): Promise<ExecutionResult<unknown>> {
    const client = this.requireClient()
    const field = filter.field as string | undefined
    if (field) {
      const removed = await client.hdel(keyName, field)
      return { rows: [], affectedRows: removed }
    }
    const removed = await client.del(keyName)
    return { rows: [], affectedRows: removed }
  }
}

// ============================================================================
// Module-level helpers
// ============================================================================

type RedisType = 'string' | 'list' | 'hash' | 'set' | 'zset' | 'stream' | 'none'

function inferConnectionCode(
  message: string,
  driverCode?: string
): 'ECONNREFUSED' | 'ETIMEDOUT' | 'AUTH_FAILED' | 'ENOTFOUND' | 'UNKNOWN' {
  const m = message.toLowerCase()
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
  client: RedisClientType,
  pattern: string,
  count: number
): Promise<string[]> {
  const seen = new Set<string>()
  let cursor = '0'
  do {
    const [next, batch] = (await client.scan(cursor, 'MATCH', pattern, 'COUNT', count)) as [
      string,
      string[],
    ]
    for (const k of batch) seen.add(k)
    cursor = next
    if (seen.size >= 100_000) break
  } while (cursor !== '0')
  return Array.from(seen)
}

async function readSizeInfo(
  client: RedisClientType,
  key: string,
  type: RedisType
): Promise<{ size: number; sample?: string }> {
  switch (type) {
    case 'string': {
      const len = await client.strlen(key)
      return { size: len }
    }
    case 'hash': {
      const len = await client.hlen(key)
      const fields = await (client as unknown as { hkeys(k: string): Promise<string[]> }).hkeys(key)
      return { size: len, sample: fields.slice(0, 5).join(', ') }
    }
    case 'list': {
      const len = await client.llen(key)
      return { size: len }
    }
    case 'set': {
      const len = await client.scard(key)
      return { size: len }
    }
    case 'zset': {
      const len = await client.zcard(key)
      return { size: len }
    }
    case 'stream': {
      const len = await (client as unknown as { xlen(k: string): Promise<number> }).xlen(key)
      return { size: len }
    }
    default:
      return { size: 0 }
  }
}

function wrapReply<T>(command: string, reply: unknown): T[] {
  const upper = command.toUpperCase()
  if (reply == null) return [] as T[]
  if (Array.isArray(reply)) {
    if (upper === 'HGETALL') {
      const obj: Record<string, unknown> = {}
      for (let i = 0; i < reply.length; i += 2) {
        obj[String(reply[i])] = reply[i + 1]
      }
      return [obj as T]
    }
    return reply.map((value, idx) => ({ index: idx, value }) as unknown as T)
  }
  if (typeof reply === 'object') {
    return [reply as T]
  }
  return [{ value: reply } as unknown as T]
}
