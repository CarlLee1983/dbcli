import type { MongoClient as MongoClientType, Db } from 'mongodb'
import { resolveSrv, resolveTxt } from 'node:dns/promises'
import { ConnectionError } from './types'
import { assertNoMongoServerSideScript } from './server-side-script'
import type { ConnectionOptions, ExecutionResult, QueryableAdapter, TableSchema } from './types'

type MongoClientConstructor = new (uri: string, opts?: object) => MongoClientType
type SrvRecord = { name?: string; target?: string; port: number }

export class MongoDBAdapter implements QueryableAdapter {
  private client: MongoClientType | null = null

  constructor(
    private options: ConnectionOptions,
    private ClientClass: MongoClientConstructor | null = null
  ) {}

  private async resolveClientClass(): Promise<MongoClientConstructor> {
    if (this.ClientClass) return this.ClientClass
    const { MongoClient } = await import('mongodb')
    return MongoClient as unknown as MongoClientConstructor
  }

  /**
   * Build the canonical URI from the field-based config. The result may be a
   * `mongodb+srv://` URI — SRV expansion is handled uniformly in
   * buildResolvedUri(), so both this path and an explicit `uri` share it.
   */
  private buildUri(): string {
    if (this.options.uri) return this.options.uri
    const { user, password, host, port, database, authSource, replicaSet, tls, srv } = this.options

    // Reject anything that would move the authority boundary or silently turn
    // into an unreadable driver error. `:` is included because the port belongs
    // in its own field — an embedded one produces `host:1234:27017`.
    if (!host) {
      throw new ConnectionError('UNKNOWN', 'MongoDB host 未設定', [
        '請填寫 host，或改用 uri 欄位指定完整連線字串',
      ])
    }
    // IPv6 literals carry colons and must be bracketed, exactly as the driver
    // expects. Everything else may not contain a colon at all — an embedded
    // port would otherwise produce `host:1234:27017`.
    const isBracketedIpv6 = /^\[[0-9a-f:]+\]$/i.test(host)
    if (!isBracketedIpv6 && /[/@?#:\s\\]/.test(host)) {
      throw new ConnectionError('UNKNOWN', `MongoDB host 含有非法字元: ${host}`, [
        'host 只應包含主機名稱或 IP，不要含 /、@、?、#、: 或空白',
        '埠號請填在 port 欄位，不要併進 host',
        'IPv6 位址請加方括號，例如 [::1]',
        '若要指定完整連線字串，請改用 uri 欄位',
      ])
    }

    if (user && !password) {
      throw new ConnectionError('UNKNOWN', '已指定 user 但未提供 password', [
        '請補上 password，或改用環境變數參照 {"$env": "..."}',
        '若確定要以無認證方式連線，請一併清空 user',
      ])
    }

    const userInfo = user ? `${encodeURIComponent(user)}:${encodeURIComponent(password)}@` : ''
    const scheme = srv ? 'mongodb+srv://' : 'mongodb://'
    const authority = srv ? host : `${host}:${port}`
    const path = database ? `/${encodeURIComponent(database)}` : '/'

    const query = new URLSearchParams()
    // `||` not `??`: the schema allows an empty string, which must not become `authSource=`
    if (user) query.set('authSource', authSource || 'admin')
    if (replicaSet) query.set('replicaSet', replicaSet)
    if (tls !== undefined) query.set('tls', String(tls))

    const search = query.toString()
    return `${scheme}${userInfo}${authority}${path}${search ? `?${search}` : ''}`
  }

  private parseTxtRecords(records: string[][]): Record<string, string> {
    const combined = records
      .flat()
      .map((record) => record.replace(/^"|"$/g, ''))
      .join('&')

    if (!combined) return {}

    const params = new URLSearchParams(combined)
    return Object.fromEntries(params.entries())
  }

  private async resolveSrvHosts(hostname: string): Promise<string[]> {
    const srvName = `_mongodb._tcp.${hostname}`

    try {
      const records = (await resolveSrv(srvName)) as SrvRecord[]
      if (!records.length) {
        throw new Error(`No SRV records found for ${srvName}`)
      }
      return records.map((record) => {
        const target = String(record.name || record.target || '').replace(/\.$/, '')
        return `${target}:${record.port}`
      })
    } catch (error) {
      const code = (error as { code?: string })?.code
      if (!['ECONNREFUSED', 'ENOTFOUND', 'ETIMEOUT', 'ETIMEDOUT'].includes(code ?? '')) {
        throw error
      }
    }

    const response = await fetch(
      `https://dns.google/resolve?name=${encodeURIComponent(srvName)}&type=SRV`
    )
    if (!response.ok) {
      throw new Error(`SRV lookup failed with HTTP ${response.status}`)
    }

    const payload = (await response.json()) as {
      Status?: number
      Answer?: Array<{ data: string }>
      Comment?: string
    }

    if (payload.Status !== 0 || !payload.Answer?.length) {
      throw new Error(payload.Comment || `No SRV records found for ${srvName}`)
    }

    return payload.Answer.map((answer) => {
      const parts = answer.data.trim().split(/\s+/)
      const port = parts[2]
      const target = parts.slice(3).join(' ').replace(/\.$/, '')
      return `${target}:${port}`
    })
  }

  private async resolveTxtOptions(hostname: string): Promise<Record<string, string>> {
    try {
      const records = await resolveTxt(hostname)
      return this.parseTxtRecords(records)
    } catch (error) {
      const code = (error as { code?: string })?.code
      if (!['ECONNREFUSED', 'ENOTFOUND', 'ETIMEOUT', 'ETIMEDOUT'].includes(code ?? '')) {
        throw error
      }
    }

    const response = await fetch(
      `https://dns.google/resolve?name=${encodeURIComponent(hostname)}&type=TXT`
    )
    if (!response.ok) {
      throw new Error(`TXT lookup failed with HTTP ${response.status}`)
    }

    const payload = (await response.json()) as {
      Status?: number
      Answer?: Array<{ data: string }>
    }

    if (payload.Status !== 0 || !payload.Answer?.length) {
      return {}
    }

    return this.parseTxtRecords(payload.Answer.map((answer) => [answer.data]))
  }

  private async buildResolvedUri(): Promise<string> {
    // Both an explicit `uri` and the field-based config funnel through the same
    // SRV expansion — `srv: true` is just another way to produce mongodb+srv://.
    const canonical = this.buildUri()

    if (!canonical.startsWith('mongodb+srv://')) {
      return canonical
    }

    const url = new URL(canonical)
    const hosts = await this.resolveSrvHosts(url.hostname)
    const txtOptions = await this.resolveTxtOptions(url.hostname)
    const query = new URLSearchParams(url.searchParams)

    for (const [key, value] of Object.entries(txtOptions)) {
      if (!query.has(key)) {
        query.set(key, value)
      }
    }

    if (!query.has('tls') && !query.has('ssl')) {
      query.set('tls', 'true')
    }

    if ((url.username || url.password) && !query.has('authSource')) {
      query.set('authSource', 'admin')
    }

    const userInfo =
      url.username || url.password
        ? `${encodeURIComponent(decodeURIComponent(url.username))}${
            url.password ? `:${encodeURIComponent(decodeURIComponent(url.password))}` : ''
          }@`
        : ''

    const path =
      url.pathname && url.pathname !== '/' ? url.pathname : `/${this.options.database || 'test'}`
    const search = query.toString()

    return `mongodb://${userInfo}${hosts.join(',')}${path}${search ? `?${search}` : ''}`
  }

  /**
   * Map a driver error to actionable hints about the connection config.
   *
   * Driver messages routinely echo the original URI back, so bare tokens like
   * `SRV`, `TLS` or `DNS` would match a connection string rather than the
   * failure. Structured error codes come first; the message patterns that
   * follow are phrases the driver actually emits, not substrings that can
   * appear inside a URI.
   */
  private connectionHints(error: unknown, message: string): string[] {
    const AUTH_HINTS = [
      '認證失敗：請確認 user / password 正確',
      '請確認 authSource 指向存放該帳號的資料庫（Atlas 與多數自架環境為 admin）',
    ]
    const DNS_HINTS = [
      'DNS/SRV 解析失敗：請確認 host 為 SRV 網域，且 srv 設定與它一致',
      '若該主機不是 SRV 網域，請關閉 srv 並改填 host 與 port',
      '請確認本機 DNS 或網路（VPN、公司網路）允許 SRV 查詢',
    ]
    const TLS_HINTS = [
      'TLS 握手失敗：請確認 tls 欄位設定與伺服器一致',
      '自簽憑證環境需要在伺服器端或系統信任鏈中安裝 CA 憑證',
    ]

    const err = error as { code?: unknown; codeName?: string; cause?: { code?: string } }
    const causeCode = String(err?.cause?.code ?? err?.code ?? '')

    if (err?.code === 18 || err?.codeName === 'AuthenticationFailed') return AUTH_HINTS
    if (['ENOTFOUND', 'EAI_AGAIN'].includes(causeCode)) return DNS_HINTS
    if (causeCode.startsWith('ERR_TLS') || causeCode.startsWith('SELF_SIGNED')) return TLS_HINTS

    if (/authentication failed|not authorized|bad auth/i.test(message)) return AUTH_HINTS
    if (/querySrv|getaddrinfo (ENOTFOUND|EAI_AGAIN)/i.test(message)) return DNS_HINTS
    if (
      /unable to verify the first certificate|self.signed certificate|certificate has expired|ERR_TLS/i.test(
        message
      )
    ) {
      return TLS_HINTS
    }

    return ['請確認 MongoDB 服務正在執行', '請確認連線設定（URI 或 host/port）正確']
  }

  private getDatabase(): Db {
    if (!this.client) {
      throw new ConnectionError('UNKNOWN', '尚未連線，請先呼叫 connect()', [])
    }

    return this.client.db(this.options.database || undefined)
  }

  async connect(): Promise<void> {
    const ClientClass = await this.resolveClientClass()
    const uri = await this.buildResolvedUri()
    try {
      this.client = new ClientClass(uri, { serverSelectionTimeoutMS: this.options.timeout ?? 5000 })
      await this.client.connect()
    } catch (err) {
      const message = (err as Error).message ?? 'Unknown error'
      const code = message.includes('ECONNREFUSED')
        ? 'ECONNREFUSED'
        : message.includes('ETIMEDOUT')
          ? 'ETIMEDOUT'
          : 'UNKNOWN'
      throw new ConnectionError(
        code,
        `MongoDB 連線失敗: ${message}`,
        this.connectionHints(err, message)
      )
    }
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.close()
      this.client = null
    }
  }

  async execute<T>(
    query: string,
    params?: unknown[],
    options?: { limit?: number; projection?: Record<string, 0 | 1> }
  ): Promise<ExecutionResult<T>> {
    const db = this.getDatabase()
    const collectionName = params?.[0] as string
    const collection = db.collection(collectionName)

    let parsed: unknown
    try {
      parsed = JSON.parse(query)
    } catch {
      throw new Error('MongoDB 查詢必須是有效的 JSON（object filter 或 array pipeline）')
    }

    // 所有呼叫路徑共用的攔截點（#47）：$where 等於在資料庫上跑任意 JS
    assertNoMongoServerSideScript(parsed)

    const limit = options?.limit
    let docs: T[]
    if (Array.isArray(parsed)) {
      const stages = parsed as Record<string, unknown>[]
      const alreadyHasLimit = stages.some(
        (stage) => stage !== null && typeof stage === 'object' && '$limit' in stage
      )
      const limitedStages =
        typeof limit === 'number' && limit > 0 && !alreadyHasLimit
          ? [...stages, { $limit: limit }]
          : stages
      const finalStages = options?.projection
        ? [...limitedStages, { $project: options.projection }]
        : limitedStages
      docs = (await collection.aggregate(finalStages).toArray()) as T[]
    } else {
      // mongo driver treats limit(0) as "no limit"
      const cap = typeof limit === 'number' && limit > 0 ? limit : 0
      const cursor = options?.projection
        ? collection.find(parsed as object, { projection: options.projection })
        : collection.find(parsed as object)
      docs = (await cursor.limit(cap).toArray()) as T[]
    }

    return { rows: docs, affectedRows: docs.length }
  }

  async listCollections(): Promise<{ name: string; documentCount?: number }[]> {
    const db = this.getDatabase()
    const colls = await db.listCollections().toArray()
    const results = await Promise.all(
      colls.map(async (col: { name: string }) => {
        try {
          const count = await db.collection(col.name).estimatedDocumentCount()
          return { name: col.name, documentCount: count }
        } catch {
          return { name: col.name }
        }
      })
    )
    return results
  }

  async listTables(): Promise<TableSchema[]> {
    const collections = await this.listCollections()
    return collections.map((c) => ({
      name: c.name,
      estimatedRowCount: c.documentCount,
      columns: [], // listTables doesn't need columns usually
    }))
  }

  async getTableSchema(
    collectionName: string,
    options?: { sampleSize?: number; sampleMethod?: 'random' | 'natural' }
  ): Promise<TableSchema> {
    const db = this.getDatabase()
    const collection = db.collection(collectionName)

    const estimatedRowCount = await collection.estimatedDocumentCount()
    const requested = options?.sampleSize
    const desired = typeof requested === 'number' && requested >= 1 ? requested : 100
    const sampleSize = Math.min(desired, 1000)
    const method = options?.sampleMethod ?? 'random'

    let samples: Record<string, unknown>[] = []
    if (method === 'random') {
      try {
        samples = (await collection
          .aggregate([{ $sample: { size: sampleSize } }])
          .toArray()) as Record<string, unknown>[]
      } catch (err) {
        console.error(
          `[mongo] $sample failed (${(err as Error).message}); falling back to natural order.`
        )
        samples = (await collection.find().limit(sampleSize).toArray()) as Record<string, unknown>[]
      }
    } else {
      samples = (await collection.find().limit(sampleSize).toArray()) as Record<string, unknown>[]
    }

    const accumulator = new Map<string, { types: Set<string>; count: number }>()
    for (const doc of samples) accumulateDocPaths(doc, '', accumulator)

    const denom = Math.max(samples.length, 1)
    const columns = Array.from(accumulator.entries()).map(([name, info]) => ({
      name,
      type: Array.from(info.types).sort().join(' | '),
      nullable: info.types.has('null') || info.count < denom,
      presence: info.count / denom,
    }))

    return {
      name: collectionName,
      columns,
      estimatedRowCount,
      tableType: 'table',
    }
  }

  async testConnection(): Promise<boolean> {
    if (!this.client) return false
    await this.getDatabase().command({ ping: 1 })
    return true
  }

  async getServerVersion(): Promise<string> {
    const info = (await this.getDatabase().admin().serverInfo()) as { version?: string }
    return info.version ?? 'unknown'
  }

  async insert(
    collection: string,
    data: Record<string, unknown>
  ): Promise<ExecutionResult<unknown>> {
    const db = this.getDatabase()
    const result = await db.collection(collection).insertOne(data)
    return {
      rows: [],
      affectedRows: result.acknowledged ? 1 : 0,
      lastInsertId: result.insertedId.toString(),
    }
  }

  async update(
    collection: string,
    filter: Record<string, unknown>,
    update: Record<string, unknown>
  ): Promise<ExecutionResult<unknown>> {
    const db = this.getDatabase()
    // filter 與 update 都可能夾帶 $where / $function（#47：所有路徑一致受檢）
    assertNoMongoServerSideScript(filter)
    assertNoMongoServerSideScript(update)
    const result = await db.collection(collection).updateMany(filter, update)
    return {
      rows: [],
      affectedRows: result.modifiedCount,
    }
  }

  async delete(
    collection: string,
    filter: Record<string, unknown>
  ): Promise<ExecutionResult<unknown>> {
    const db = this.getDatabase()
    assertNoMongoServerSideScript(filter)
    const result = await db.collection(collection).deleteMany(filter)
    return {
      rows: [],
      affectedRows: result.deletedCount,
    }
  }
}

type MongoTypeName =
  | 'string'
  | 'number'
  | 'boolean'
  | 'null'
  | 'array'
  | 'object'
  | 'Date'
  | 'ObjectId'
  | 'Binary'
  | 'Decimal128'

function detectMongoType(v: unknown): MongoTypeName {
  if (v === null || v === undefined) return 'null'
  if (Array.isArray(v)) return 'array'
  if (v instanceof Date) return 'Date'
  if (typeof v === 'object') {
    const ctor = (v as object).constructor?.name
    if (ctor === 'ObjectId') return 'ObjectId'
    if (ctor === 'Binary') return 'Binary'
    if (ctor === 'Decimal128') return 'Decimal128'
    return 'object'
  }
  if (typeof v === 'string') return 'string'
  if (typeof v === 'number') return 'number'
  if (typeof v === 'boolean') return 'boolean'
  return 'string'
}

function accumulateDocPaths(
  doc: Record<string, unknown>,
  prefix: string,
  acc: Map<string, { types: Set<string>; count: number }>
): void {
  for (const [k, v] of Object.entries(doc)) {
    const path = prefix === '' ? k : `${prefix}.${k}`
    const t = detectMongoType(v)
    const slot = acc.get(path) ?? { types: new Set<string>(), count: 0 }
    slot.types.add(t)
    slot.count += 1
    acc.set(path, slot)
    if (t === 'object' && v && typeof v === 'object') {
      accumulateDocPaths(v as Record<string, unknown>, path, acc)
    }
  }
}
