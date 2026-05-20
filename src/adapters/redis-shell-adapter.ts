import type { DatabaseAdapter, ExecutionResult, TableSchema } from './types'
import type { RedisAdapter } from './redis-adapter'

/**
 * Thin wrapper exposing a RedisAdapter through the SQL-style DatabaseAdapter
 * interface so Redis connections can drive the shared ReplEngine. Unlike the
 * Mongo shell wrapper, raw command execution IS supported here.
 */
export class RedisShellAdapter implements DatabaseAdapter {
  constructor(private readonly inner: RedisAdapter) {}

  async connect(): Promise<void> {
    return this.inner.connect()
  }

  async disconnect(): Promise<void> {
    return this.inner.disconnect()
  }

  async listTables(): Promise<TableSchema[]> {
    const cols = await this.inner.listCollections()
    return cols.map((c) => ({ name: c.name, columns: [] as TableSchema['columns'] }))
  }

  async getTableSchema(name: string): Promise<TableSchema> {
    return this.inner.getTableSchema(name)
  }

  async execute<T>(
    command: string,
    _params?: (string | number | boolean | null)[],
    options?: { noLimit?: boolean }
  ): Promise<ExecutionResult<T>> {
    return this.inner.execute<T>(command, undefined, options)
  }

  async testConnection(): Promise<boolean> {
    return this.inner.testConnection()
  }

  async getServerVersion(): Promise<string> {
    return this.inner.getServerVersion()
  }
}
