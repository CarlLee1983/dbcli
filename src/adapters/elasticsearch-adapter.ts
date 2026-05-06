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
    throw new Error('Method not implemented.')
  }

  async listCollections(options?: { includeSystem?: boolean }): Promise<{ name: string; documentCount?: number }[]> {
    throw new Error('Method not implemented.')
  }

  async listTables(options?: { includeSystem?: boolean }): Promise<TableSchema[]> {
    throw new Error('Method not implemented.')
  }

  async getTableSchema(tableName: string, options?: { sampleSize?: number }): Promise<TableSchema> {
    throw new Error('Method not implemented.')
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
