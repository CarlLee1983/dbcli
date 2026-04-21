import type { MongoClient as MongoClientType, Db } from 'mongodb'
import { ConnectionError } from './types'
import type { ConnectionOptions, ExecutionResult, QueryableAdapter } from './types'

type MongoClientConstructor = new (uri: string, opts?: object) => MongoClientType

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

  async connect(): Promise<void> {
    const ClientClass = await this.resolveClientClass()
    const uri = this.buildUri()
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
    if (!this.client) {
      throw new ConnectionError('UNKNOWN', '尚未連線，請先呼叫 connect()', [])
    }
    const collectionName = params?.[0] as string
    const db: Db = this.client.db()
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
    if (!this.client) {
      throw new ConnectionError('UNKNOWN', '尚未連線，請先呼叫 connect()', [])
    }
    const db: Db = this.client.db()
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
    await this.client.db().command({ ping: 1 })
    return true
  }

  async getServerVersion(): Promise<string> {
    if (!this.client) {
      throw new ConnectionError('UNKNOWN', '尚未連線，請先呼叫 connect()', [])
    }
    const info = (await this.client.db().admin().serverInfo()) as { version?: string }
    return info.version ?? 'unknown'
  }
}
