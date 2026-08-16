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

  // Why the reason is reported rather than assumed: this file spent months
  // printing "container not running" while the container was running and
  // healthy — a global happy-dom registration was giving `fetch` a same-origin
  // policy, so `connect()` threw `Cross-Origin Request Blocked` and the skip
  // branch swallowed it (#109). A skip that states its cause can be checked.
  let unreachable: string | null = null

  beforeAll(async () => {
    try {
      await adapter.connect()
    } catch (error) {
      unreachable = error instanceof Error ? error.message : String(error)
      console.warn(
        `Skipping Elasticsearch integration tests — ${ES_HOST}:${ES_PORT} unreachable: ${unreachable}`
      )
    }
  })

  test('can create index, insert document, and query it', async () => {
    if (unreachable) return

    const index = 'test-index-' + Date.now()

    // 1. Create index with mapping (using fetch directly since adapter doesn't have createIndex)
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
    await adapter.request('DELETE', `/${index}`)
  })
})
