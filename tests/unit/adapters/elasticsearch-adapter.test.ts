import { describe, test, expect, beforeEach, afterEach, spyOn } from 'bun:test'
import { ElasticsearchAdapter } from '@/adapters/elasticsearch-adapter'
import { ConnectionError } from '@/adapters/types'

describe('ElasticsearchAdapter', () => {
  test('resolves basic host/port/protocol URL', () => {
    const adapter = new ElasticsearchAdapter({
      system: 'elasticsearch',
      protocol: 'http',
      host: 'localhost',
      port: 9200,
      user: '',
      password: '',
      database: '',
    })
    // @ts-ignore - accessing private for test
    expect(adapter.getBaseUrl()).toBe('http://localhost:9200')
  })

  test('resolves cloudId to https URL', () => {
    const adapter = new ElasticsearchAdapter({
      system: 'elasticsearch',
      cloudId: 'deployment:dXMtZWFzdC0xLmF3cy5mb3VuZC5pbyQ0YTY1ZDE3ZTIxYTM0YmRjOGZlYmY2MTU5Y2FmNGM5ZCQyYmY4ZTY3YmRjYmE0YmFlYmFmYmJlYmFmYmJlYmFmYg==',
      user: '',
      password: '',
      database: '',
    } as any)
    // @ts-ignore
    expect(adapter.getBaseUrl()).toBe('https://4a65d17e21a34bdc8febf6159caf4c9d.us-east-1.aws.found.io:443')
  })

  test('builds API key auth header', async () => {
    const adapter = new ElasticsearchAdapter({
      system: 'elasticsearch',
      apiKey: 'my-key',
      host: 'localhost',
      port: 9200,
      user: '',
      password: '',
      database: '',
    })
    // @ts-ignore
    const headers = await adapter.getHeaders()
    expect(headers.Authorization).toBe('ApiKey my-key')
  })

  test('builds basic auth header', async () => {
    const adapter = new ElasticsearchAdapter({
      system: 'elasticsearch',
      user: 'elastic',
      password: 'password',
      host: 'localhost',
      port: 9200,
      database: '',
    })
    // @ts-ignore
    const headers = await adapter.getHeaders()
    expect(headers.Authorization).toBe('Basic ' + btoa('elastic:password'))
  })

  test('maps 401 to AUTH_FAILED', async () => {
    const adapter = new ElasticsearchAdapter({
      system: 'elasticsearch',
      host: 'localhost',
      port: 9200,
      user: '',
      password: '',
      database: '',
    })
    
    // Mock fetch
    const mockFetch = spyOn(globalThis, 'fetch').mockResolvedValue(new Response('Unauthorized', { status: 401 }))
    
    try {
      await adapter.connect()
      expect.unreachable('Should have thrown')
    } catch (error: any) {
      expect(error).toBeInstanceOf(ConnectionError)
      expect(error.code).toBe('AUTH_FAILED')
    } finally {
      mockFetch.mockRestore()
    }
  })
})

describe('ElasticsearchAdapter list/schema', () => {
  let originalFetch: typeof fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  test('listCollections returns indices and doc counts', async () => {
    const adapter = new ElasticsearchAdapter({ system: 'elasticsearch', protocol: 'http', host: 'localhost', port: 9200, user: '', password: '', database: '' })
    
    const mockIndices = {
      'users': { settings: { index: { creation_date: '...' } } },
      '.security': { settings: { index: { creation_date: '...' } } },
    }
    
    const mockStats = {
      indices: {
        'users': { total: { docs: { count: 100 } } },
        '.security': { total: { docs: { count: 5 } } },
      }
    }
    
    // @ts-ignore
    globalThis.fetch = Response.json ? async (url: string) => {
        if (url.includes('_settings')) return Response.json(mockIndices)
        if (url.includes('_stats')) return Response.json(mockStats)
        return Response.json({})
    } : async (url: string) => {
        if (url.includes('_settings')) return new Response(JSON.stringify(mockIndices))
        if (url.includes('_stats')) return new Response(JSON.stringify(mockStats))
        return new Response('{}')
    }
      
    const collections = await adapter.listCollections()
    expect(collections).toHaveLength(1)
    expect(collections[0].name).toBe('users')
    expect(collections[0].documentCount).toBe(100)
    
    const allCollections = await adapter.listCollections({ includeSystem: true })
    expect(allCollections).toHaveLength(2)
  })

  test('getTableSchema flattens mappings', async () => {
    const adapter = new ElasticsearchAdapter({ system: 'elasticsearch', protocol: 'http', host: 'localhost', port: 9200, user: '', password: '', database: '' })
    
    const mockMapping = {
      'users': {
        mappings: {
          properties: {
            'id': { type: 'keyword' },
            'name': { type: 'text', fields: { 'keyword': { type: 'keyword' } } },
            'profile': {
              properties: {
                'email': { type: 'keyword' },
                'age': { type: 'integer' }
              }
            }
          }
        }
      }
    }
    
    // @ts-ignore
    globalThis.fetch = async () => new Response(JSON.stringify(mockMapping))
    
    const schema = await adapter.getTableSchema('users')
    expect(schema.name).toBe('users')
    const columnNames = schema.columns.map(c => c.name)
    expect(columnNames).toContain('id')
    expect(columnNames).toContain('name')
    expect(columnNames).toContain('name.keyword')
    expect(columnNames).toContain('profile.email')
    expect(columnNames).toContain('profile.age')
  })
})
