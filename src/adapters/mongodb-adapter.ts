import type { MongoClient as MongoClientType, Db } from 'mongodb'
import { resolveSrv, resolveTxt } from 'node:dns/promises'
import { ConnectionError } from './types'
import type { ConnectionOptions, ExecutionResult, QueryableAdapter } from './types'

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

  private buildUri(): string {
    if (this.options.uri) return this.options.uri
    const { user, password, host, port, database, authSource } = this.options
    if (user && password) {
      const auth = authSource ?? 'admin'
      return `mongodb://${user}:${encodeURIComponent(password)}@${host}:${port}/${database}?authSource=${auth}`
    }
    return `mongodb://${host}:${port}/${database}`
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
      if (code !== 'ECONNREFUSED') {
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
      if (code !== 'ECONNREFUSED') {
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
    if (!this.options.uri) {
      return this.buildUri()
    }

    if (!this.options.uri.startsWith('mongodb+srv://')) {
      return this.options.uri
    }

    const url = new URL(this.options.uri)
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
      throw new ConnectionError(code, `MongoDB 連線失敗: ${message}`, [
        '請確認 MongoDB 服務正在執行',
        '請確認連線設定（URI 或 host/port）正確',
      ])
    }
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.close()
      this.client = null
    }
  }

  async execute<T>(query: string, params?: unknown[]): Promise<ExecutionResult<T>> {
    const db = this.getDatabase()
    const collectionName = params?.[0] as string
    const collection = db.collection(collectionName)

    let parsed: unknown
    try {
      parsed = JSON.parse(query)
    } catch {
      throw new Error('MongoDB 查詢必須是有效的 JSON（object filter 或 array pipeline）')
    }

    let docs: T[]
    if (Array.isArray(parsed)) {
      docs = (await collection.aggregate(parsed as object[]).toArray()) as T[]
    } else {
      docs = (await collection.find(parsed as object).toArray()) as T[]
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

  async testConnection(): Promise<boolean> {
    if (!this.client) return false
    await this.getDatabase().command({ ping: 1 })
    return true
  }

  async getServerVersion(): Promise<string> {
    const info = (await this.getDatabase().admin().serverInfo()) as { version?: string }
    return info.version ?? 'unknown'
  }

  async insert(collection: string, data: Record<string, any>): Promise<ExecutionResult<any>> {
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
    filter: Record<string, any>,
    update: Record<string, any>
  ): Promise<ExecutionResult<any>> {
    const db = this.getDatabase()
    const result = await db.collection(collection).updateMany(filter, update)
    return {
      rows: [],
      affectedRows: result.modifiedCount,
    }
  }

  async delete(collection: string, filter: Record<string, any>): Promise<ExecutionResult<any>> {
    const db = this.getDatabase()
    const result = await db.collection(collection).deleteMany(filter)
    return {
      rows: [],
      affectedRows: result.deletedCount,
    }
  }
}
