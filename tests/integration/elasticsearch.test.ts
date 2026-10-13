import { describe, test, expect, beforeAll } from 'bun:test'
import { ElasticsearchAdapter } from '@/adapters/elasticsearch-adapter'
import { ES_HOST, ES_PORT, REQUIRE_SERVICES, SKIP_BY_ENV } from './helpers'

if (SKIP_BY_ENV && REQUIRE_SERVICES) {
  throw new Error(
    'SKIP_INTEGRATION_TESTS and REQUIRE_INTEGRATION_SERVICES are both set; ' +
      'they ask for opposite things. Unset one.'
  )
}

async function optionalServiceIsAbsent(): Promise<boolean> {
  if (!Number.isInteger(ES_PORT) || ES_PORT < 1 || ES_PORT > 65535) {
    throw new Error(`Invalid ES_PORT: ${ES_PORT}; expected an integer from 1 to 65535`)
  }
  try {
    const socket = await Bun.connect({
      hostname: ES_HOST,
      port: ES_PORT,
      socket: {
        data() {},
        open(socket) {
          socket.end()
        },
        error() {},
        connectError() {},
      },
    })
    socket.end()
    return false
  } catch (error) {
    // Only a refused connection proves that this optional service is absent.
    // Bad configuration, DNS/permission errors, and unexpected exceptions fail.
    if (
      !REQUIRE_SERVICES &&
      error instanceof Error &&
      'code' in error &&
      error.code === 'ECONNREFUSED'
    ) {
      return true
    }
    if (REQUIRE_SERVICES) {
      throw new Error(
        `REQUIRE_INTEGRATION_SERVICES is set, but Elasticsearch at ${ES_HOST}:${ES_PORT} ` +
          `is not available: ${error instanceof Error ? error.message : String(error)}. ` +
          'Start it with: docker compose -f docker-compose.test.yml up -d --wait',
        { cause: error }
      )
    }
    throw error
  }
}

// Explicit opt-out avoids any connection. After the TCP preflight succeeds,
// every adapter/setup failure propagates, regardless of required-service mode.
const skip = SKIP_BY_ENV || (await optionalServiceIsAbsent())
if (skip) {
  console.warn(
    `Skipping Elasticsearch integration tests: ${
      SKIP_BY_ENV ? 'SKIP_INTEGRATION_TESTS=true' : `${ES_HOST}:${ES_PORT} is not listening`
    }`
  )
}

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
    if (!skip) await adapter.connect()
  })

  test.skipIf(skip)('can create index, insert document, and query it', async () => {
    expect.hasAssertions()
    const index = 'test-index-' + Date.now()
    let created = false

    try {
      // 1. Create index with mapping (using fetch directly since adapter doesn't have createIndex)
      await adapter.request('PUT', `/${index}`, {
        mappings: {
          properties: {
            title: { type: 'text' },
            tags: { type: 'keyword' },
          },
        },
      })
      created = true

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
    } finally {
      if (created) await adapter.request('DELETE', `/${index}`)
    }
    console.log('Elasticsearch roundtrip verified: create, insert, refresh, query, schema, cleanup')
  })
})
