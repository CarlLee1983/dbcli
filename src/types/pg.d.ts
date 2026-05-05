declare module 'pg' {
  export interface QueryResult<T = Record<string, unknown>> {
    rows: T[]
    rowCount: number | null
  }

  export interface PoolClient {
    release(): void
  }

  export class Pool {
    constructor(options?: Record<string, unknown>)
    query<T = Record<string, unknown>>(
      sql: string,
      params?: (string | number | boolean | null)[]
    ): Promise<QueryResult<T>>
    end(): Promise<void>
  }
}
