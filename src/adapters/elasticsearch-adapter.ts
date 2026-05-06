import type {
  ConnectionOptions,
  DatabaseAdapter,
  ExecutionResult,
  QueryableAdapter,
  TableSchema,
} from './types'
import { ConnectionError } from './types'

export class ElasticsearchAdapter implements QueryableAdapter {
  private options: ConnectionOptions
  private baseUrl: string = ''
  private currentNodeIndex: number = 0

  constructor(options: ConnectionOptions) {
    this.options = options
    this.baseUrl = this.resolveBaseUrl()
  }

  async connect(): Promise<void> {
    try {
      await this.request('GET', '/')
    } catch (error) {
      if (error instanceof ConnectionError) throw error
      throw new ConnectionError('UNKNOWN', `Could not connect to Elasticsearch: ${(error as Error).message}`, [
        'Check if Elasticsearch is running',
        'Verify host and port',
        'Check network connectivity',
      ])
    }
  }

  async disconnect(): Promise<void> {
    // No persistent connection to close for fetch-based adapter
  }

  async execute<T>(
    query: string,
    params?: unknown[],
    options?: { limit?: number }
  ): Promise<ExecutionResult<T>> {
    const indexName = params?.[0] as string
    if (!indexName) {
      throw new Error('Index name is required as the first parameter to execute()')
    }

    const isDsl = query.trim().startsWith('{')
    const limit = options?.limit ?? 100
    let path = `/${indexName}/_search`
    let body: any = undefined

    if (isDsl) {
      body = JSON.parse(query)
      if (body.size === undefined) {
        body.size = limit
      }
    } else {
      path += `?q=${encodeURIComponent(query)}&size=${limit}`
    }

    const response = await this.request<any>(body ? 'POST' : 'GET', path, body)
    const hits = response.hits?.hits || []

    const rows = hits.map((hit: any) => {
      const row: any = { _id: hit._id }
      this.flattenSource('', hit._source || {}, row)
      return row
    })

    return {
      rows: rows as T[],
      affectedRows: rows.length,
    }
  }

  private flattenSource(prefix: string, source: any, target: any) {
    for (const [key, value] of Object.entries(source)) {
      const fullKey = prefix ? `${prefix}.${key}` : key
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        this.flattenSource(fullKey, value, target)
      } else {
        target[fullKey] = value
      }
    }
  }

  async listCollections(options?: {
    includeSystem?: boolean
  }): Promise<{ name: string; documentCount?: number }[]> {
    const indices = await this.request<Record<string, any>>('GET', '/_settings')
    const stats = await this.request<any>('GET', '/_stats/docs')

    return Object.keys(indices)
      .filter((name) => options?.includeSystem || !name.startsWith('.'))
      .map((name) => ({
        name,
        documentCount: stats.indices?.[name]?.total?.docs?.count ?? 0,
      }))
  }

  async listTables(options?: { includeSystem?: boolean }): Promise<TableSchema[]> {
    const collections = await this.listCollections(options)
    return collections.map((c) => ({
      name: c.name,
      columns: [],
      estimatedRowCount: c.documentCount,
      tableType: 'table',
    }))
  }

  async getTableSchema(tableName: string, _options?: { sampleSize?: number }): Promise<TableSchema> {
    const mapping = await this.request<any>('GET', `/${tableName}/_mapping`)
    const indexMapping = mapping[tableName] || Object.values(mapping)[0]

    if (!indexMapping) {
      throw new Error(`Index not found: ${tableName}`)
    }

    const columns: any[] = []
    this.flattenProperties('', indexMapping.mappings?.properties || {}, columns)

    return {
      name: tableName,
      columns,
      tableType: 'table',
    }
  }

  private flattenProperties(prefix: string, properties: any, columns: any[]) {
    for (const [name, config] of Object.entries<any>(properties)) {
      const fullName = prefix ? `${prefix}.${name}` : name

      if (config.properties) {
        this.flattenProperties(fullName, config.properties, columns)
      } else {
        columns.push({
          name: fullName,
          type: config.type || 'object',
          nullable: true,
        })

        if (config.fields) {
          for (const [fieldName, fieldConfig] of Object.entries<any>(config.fields)) {
            columns.push({
              name: `${fullName}.${fieldName}`,
              type: fieldConfig.type,
              nullable: true,
            })
          }
        }
      }
    }
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.connect()
      return true
    } catch {
      return false
    }
  }

  async getServerVersion(): Promise<string> {
    const info = await this.request<any>('GET', '/')
    return info.version?.number ?? 'unknown'
  }

  async insert(collection: string, data: Record<string, unknown>): Promise<ExecutionResult<unknown>> {
    throw new Error('Method not implemented.')
  }

  async update(
    collection: string,
    filter: Record<string, unknown>,
    update: Record<string, unknown>
  ): Promise<ExecutionResult<unknown>> {
    throw new Error('Method not implemented.')
  }

  async delete(collection: string, filter: Record<string, unknown>): Promise<ExecutionResult<unknown>> {
    throw new Error('Method not implemented.')
  }

  // ============================================================================
  // INTERNAL HELPERS
  // ============================================================================

  private resolveBaseUrl(): string {
    if (this.options.cloudId) {
      return this.decodeCloudId(this.options.cloudId)
    }

    if (this.options.nodes && this.options.nodes.length > 0) {
      // Use the first node for now; round-robin can be added later if needed
      return this.options.nodes[0].replace(/\/$/, '')
    }

    const protocol = this.options.protocol ?? 'https'
    const host = this.options.host || 'localhost'
    const port = this.options.port || 9200
    return `${protocol}://${host}:${port}`
  }

  private decodeCloudId(cloudId: string): string {
    try {
      const parts = cloudId.split(':')
      if (parts.length !== 2) throw new Error('Invalid format')
      const base64 = parts[1]
      const decoded = atob(base64)
      const [hostAndPort, ...rest] = decoded.split('$')
      // Format: host:port$elasticUuid$kibanaUuid
      // Or: host$elasticUuid$kibanaUuid (implies port 443)
      if (hostAndPort.includes('.')) {
         const [host, port] = hostAndPort.split(':')
         return `https://${rest[0]}.${host}:${port || 443}`
      }
      return `https://${rest[0]}.${hostAndPort}:443`
    } catch (error) {
      throw new Error(`Invalid Cloud ID: ${(error as Error).message}`)
    }
  }

  private async getHeaders(): Promise<Record<string, string>> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }

    if (this.options.apiKey) {
      headers['Authorization'] = `ApiKey ${this.options.apiKey}`
    } else if (this.options.user && this.options.password) {
      const auth = btoa(`${this.options.user}:${this.options.password}`)
      headers['Authorization'] = `Basic ${auth}`
    }

    return headers
  }

  private getBaseUrl(): string {
    return this.baseUrl
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    options?: { timeout?: number }
  ): Promise<T> {
    const url = `${this.baseUrl}${path.startsWith('/') ? '' : '/'}${path}`
    const headers = await this.getHeaders()
    const controller = new AbortController()
    const timeout = options?.timeout ?? this.options.timeout ?? 5000
    const timeoutId = setTimeout(() => controller.abort(), timeout)

    try {
      // @ts-ignore - Bun global fetch options
      const response = await fetch(url, {
        method,
        headers,
        body: body ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
        signal: controller.signal,
        tls: {
          rejectUnauthorized: this.options.rejectUnauthorized ?? true,
          ca: this.options.caPath ? await Bun.file(this.options.caPath).text() : undefined,
        },
      })

      if (!response.ok) {
        await this.handleErrorResponse(response)
      }

      return (await response.json()) as T
    } catch (error: any) {
      if (error.name === 'AbortError') {
        throw new ConnectionError('ETIMEDOUT', `Request timed out after ${timeout}ms`, [
          'Increase timeout in config if the cluster is slow',
          'Check if the network is congested',
        ])
      }
      if (error instanceof ConnectionError) throw error
      
      // Map common fetch errors
      const msg = error.message.toLowerCase()
      if (msg.includes('connection refused') || msg.includes('econnrefused')) {
        throw new ConnectionError('ECONNREFUSED', `Connection refused at ${this.baseUrl}`, [
          'Check if Elasticsearch is running',
          'Verify host and port',
        ])
      }
      if (msg.includes('not found') || msg.includes('enotfound')) {
        throw new ConnectionError('ENOTFOUND', `Host not found: ${this.baseUrl}`, [
          'Verify the hostname is correct',
          'Check DNS settings',
        ])
      }

      throw error
    } finally {
      clearTimeout(timeoutId)
    }
  }

  private async handleErrorResponse(response: Response): Promise<never> {
    let message = ''
    try {
      const errorBody = await response.json()
      message = errorBody?.error?.reason || errorBody?.message || response.statusText
    } catch {
      try {
        message = await response.text()
      } catch {
        message = response.statusText
      }
    }

    const status = response.status

    if (status === 401) {
      throw new ConnectionError('AUTH_FAILED', `Authentication failed: ${message}`, [
        'Check your API key or username/password',
        'Verify if the user has required roles',
      ])
    }
    if (status === 403) {
      throw new ConnectionError('AUTH_FAILED', `Permission denied: ${message}`, [
        'User does not have permission to perform this action',
      ])
    }

    throw new ConnectionError('UNKNOWN', `Elasticsearch error (${status}): ${message}`, [
      'Check Elasticsearch logs for more details',
      'Verify the request body is valid ES DSL',
    ])
  }
}
