import type { DatabaseAdapter, ExecutionResult, TableSchema } from './types'
import type { QueryableAdapter } from './types'

export class MongoShellAdapter implements DatabaseAdapter {
  constructor(private readonly adapter: QueryableAdapter) {}

  async connect(): Promise<void> {
    await this.adapter.connect()
  }

  async disconnect(): Promise<void> {
    await this.adapter.disconnect()
  }

  async execute<T>(): Promise<ExecutionResult<T>> {
    throw new Error(
      'MongoDB shell does not support raw SQL. Use `query <json>` with `--collection`.'
    )
  }

  async listTables(): Promise<TableSchema[]> {
    const collections = await this.adapter.listCollections()
    return collections.map((collection) => ({
      name: collection.name,
      columns: [],
      columnCount: 0,
      estimatedRowCount: collection.documentCount,
      tableType: 'table',
    }))
  }

  async getTableSchema(): Promise<TableSchema> {
    throw new Error('MongoDB shell does not support table schema inspection.')
  }

  async testConnection(): Promise<boolean> {
    return this.adapter.testConnection()
  }

  async getServerVersion(): Promise<string> {
    return this.adapter.getServerVersion()
  }
}
