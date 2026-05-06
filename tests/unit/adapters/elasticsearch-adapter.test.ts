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
