/** Exercise the actual integration file in children, with isolated env flags. */
import { describe, expect, test } from 'bun:test'
import { createServer } from 'node:http'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dir, '../../..')
const SUCCESS = 'Elasticsearch roundtrip verified: create, insert, refresh, query, schema, cleanup'

interface RequestRecord {
  method: string
  path: string
  body: unknown
}

async function fixture(failure?: 'handshake' | 'query') {
  const requests: RequestRecord[] = []
  let properties: unknown
  let document: unknown
  const server = createServer(async (req, res) => {
    let raw = ''
    for await (const chunk of req) raw += chunk
    const path = new URL(req.url!, 'http://localhost').pathname
    const body: unknown = raw ? JSON.parse(raw) : undefined
    requests.push({ method: req.method!, path, body })
    res.setHeader('content-type', 'application/json')
    if (failure === 'handshake' && path === '/') {
      res.writeHead(500)
      res.end(JSON.stringify({ error: { reason: 'fixture handshake failed' }, status: 500 }))
      return
    }
    const index = path.split('/')[1]!
    let response: unknown
    if (path === '/') response = { version: { number: '8.13.0' } }
    else if (req.method === 'PUT' && /^\/test-index-\d+$/.test(path)) {
      properties = (body as { mappings: { properties: unknown } }).mappings.properties
      response = { acknowledged: true }
    } else if (req.method === 'PUT' && path.endsWith('/_doc/doc1')) {
      document = body
      response = { _id: 'doc1', result: 'created' }
    } else if (req.method === 'POST' && path.endsWith('/_refresh')) {
      response = { _shards: { successful: 1 } }
    } else if (path.endsWith('/_search')) {
      response = { hits: { hits: failure === 'query' ? [] : [{ _id: 'doc1', _source: document }] } }
    } else if (path.endsWith('/_mapping')) {
      response = { [index]: { mappings: { properties } } }
    } else if (req.method === 'DELETE' && /^\/test-index-\d+$/.test(path)) {
      response = { acknowledged: true }
    } else {
      res.writeHead(500)
      response = { error: { reason: `unexpected fixture request ${req.method} ${path}` } }
    }
    res.end(JSON.stringify(response))
  })
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  const port = (server.address() as { port: number }).port
  return {
    port,
    requests,
    async close() {
      server.closeAllConnections()
      await new Promise<void>((done) => server.close(() => done()))
    },
  }
}

async function run(port: number, options: { required?: boolean; skip?: boolean } = {}) {
  const child = Bun.spawn(
    [process.execPath, 'test', '--timeout', '10000', './tests/integration/elasticsearch.test.ts'],
    {
      cwd: ROOT,
      env: {
        ...process.env,
        ES_HOST: '127.0.0.1',
        ES_PORT: String(port),
        SKIP_INTEGRATION_TESTS: String(options.skip ?? false),
        REQUIRE_INTEGRATION_SERVICES: String(options.required ?? false),
        NO_COLOR: '1',
      },
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
    }
  )
  const timer = setTimeout(() => child.kill(), 15_000)
  try {
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    return { code, output: `${stdout}\n${stderr}` }
  } finally {
    clearTimeout(timer)
  }
}

describe('Elasticsearch integration execution policy', () => {
  test('required healthy service executes every roundtrip operation and cleanup', async () => {
    const endpoint = await fixture()
    try {
      const result = await run(endpoint.port, { required: true })
      expect(result.output).toContain(SUCCESS)
      expect(result.code).toBe(0)
      expect(result.output).toContain('1 pass')
      expect(result.output).not.toContain('(skip)')
      expect(
        endpoint.requests.map(
          ({ method, path }) => `${method} ${path.replace(/test-index-\d+/, '<index>')}`
        )
      ).toEqual([
        'GET /',
        'PUT /<index>',
        'PUT /<index>/_doc/doc1',
        'POST /<index>/_refresh',
        'GET /<index>/_search',
        'GET /<index>/_mapping',
        'DELETE /<index>',
      ])
      expect(endpoint.requests[2]!.body).toEqual({ title: 'Hello ES', tags: ['test'] })
    } finally {
      await endpoint.close()
    }
  })

  test('an explicit local opt-out is a visible skip and makes no HTTP requests', async () => {
    const endpoint = await fixture()
    try {
      const result = await run(endpoint.port, { skip: true })
      expect(result.code).toBe(0)
      expect(result.output).toContain('1 skip')
      expect(result.output).toContain('SKIP_INTEGRATION_TESTS=true')
      expect(result.output).not.toContain(SUCCESS)
      expect(endpoint.requests).toEqual([])
    } finally {
      await endpoint.close()
    }
  })

  test('conflicting required and skip flags fail before contacting the service', async () => {
    const endpoint = await fixture()
    try {
      const result = await run(endpoint.port, { required: true, skip: true })
      expect(result.code).not.toBe(0)
      expect(result.output).toContain('they ask for opposite things')
      expect(result.output).not.toContain(SUCCESS)
      expect(endpoint.requests).toEqual([])
    } finally {
      await endpoint.close()
    }
  })

  test('absent local service is visibly skipped but required absence fails', async () => {
    const endpoint = await fixture()
    await endpoint.close()
    const optional = await run(endpoint.port)
    expect(optional.code).toBe(0)
    expect(optional.output).toContain('1 skip')
    expect(optional.output).toContain('is not listening')
    expect(optional.output).not.toContain(SUCCESS)
    const required = await run(endpoint.port, { required: true })
    expect(required.code).not.toBe(0)
    expect(required.output).toContain('REQUIRE_INTEGRATION_SERVICES is set')
    expect(required.output).not.toContain(SUCCESS)
  })

  test('invalid endpoint configuration is an error rather than optional absence', async () => {
    for (const required of [false, true]) {
      for (const port of [Number.NaN, 0, 65536]) {
        const result = await run(port, { required })
        expect(result.code).not.toBe(0)
        expect(result.output).toContain('Invalid ES_PORT')
        expect(result.output).not.toContain('1 skip')
        expect(result.output).not.toContain(SUCCESS)
      }
    }
  })

  for (const required of [false, true]) {
    test(`unexpected connection error fails when required=${required}`, async () => {
      const endpoint = await fixture('handshake')
      try {
        const result = await run(endpoint.port, { required })
        expect(result.code).not.toBe(0)
        expect(result.output).toContain('fixture handshake failed')
        expect(result.output).not.toContain(SUCCESS)
        expect(result.output).not.toContain('1 skip')
        expect(endpoint.requests.map((request) => request.path)).toEqual(['/'])
      } finally {
        await endpoint.close()
      }
    })
  }

  test('a failed roundtrip assertion still cleans up and never reports success', async () => {
    const endpoint = await fixture('query')
    try {
      const result = await run(endpoint.port, { required: true })
      expect(result.code).not.toBe(0)
      expect(result.output).toContain('toHaveLength')
      expect(result.output).not.toContain(SUCCESS)
      expect(endpoint.requests.at(-1)!.method).toBe('DELETE')
      expect(endpoint.requests.some((request) => request.path.endsWith('/_search'))).toBe(true)
    } finally {
      await endpoint.close()
    }
  })
})
