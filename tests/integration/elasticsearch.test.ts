import { describe, test, expect, beforeAll } from 'bun:test'
import { ElasticsearchAdapter } from '@/adapters/elasticsearch-adapter'
import { ES_HOST, ES_PORT } from './helpers'

describe('Elasticsearch Integration', () => {
  const options = {
    system: 'elasticsearch' as const,
    protocol: 'http' as const,
    host: ES_HOST,
    port: ES_PORT, // Docker port
    user: '',
    password: '',
    database: '',
  }

  const adapter = new ElasticsearchAdapter(options)

  beforeAll(async () => {
    // Skip if Elasticsearch is not running
    try {
      await adapter.connect()
    } catch {
      console.warn('Skipping Elasticsearch integration tests (container not running on port 9201)')
    }
  })

  test('can create index, insert document, and query it', async () => {
    try {
      await adapter.connect()
    } catch {
      return // skip
    }

    const index = 'test-index-' + Date.now()

    // 1. Create index with mapping (using fetch directly since adapter doesn't have createIndex)
    // @ts-expect-error - accessing private request() for test setup
    await adapter.request('PUT', `/${index}`, {
      mappings: {
        properties: {
          title: { type: 'text' },
          tags: { type: 'keyword' },
        },
      },
    })

    // 2. Insert document
    await adapter.insert(index, { id: 'doc1', title: 'Hello ES', tags: ['test'] })

    // Refresh index
    // @ts-expect-error - accessing private request() for test setup
    await adapter.request('POST', `/${index}/_refresh`)

    // 3. Query document
    const result = await adapter.execute('title:Hello', [index])
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]).toMatchObject({
      _id: 'doc1',
      title: 'Hello ES',
      tags: ['test'],
    })

    // 4. Schema
    const schema = await adapter.getTableSchema(index)
    expect(schema.name).toBe(index)
    expect(schema.columns).toContainEqual({ name: 'title', type: 'text', nullable: true })
    expect(schema.columns).toContainEqual({ name: 'tags', type: 'keyword', nullable: true })

    // Cleanup
    // @ts-expect-error - accessing private request() for test cleanup
    await adapter.request('DELETE', `/${index}`)
  })
})
