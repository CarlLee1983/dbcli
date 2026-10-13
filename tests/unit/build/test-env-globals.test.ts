/** Real HTTP regressions for the network globals retained by the DOM preload. */
import { test, expect } from 'bun:test'
import { createServer, type RequestListener } from 'node:http'
import { ElasticsearchAdapter } from '@/adapters/elasticsearch-adapter'
import {
  runtimeFetch,
  runtimeAbortController,
  runtimeAbortSignal,
} from '../../helpers/setup-happy-dom'

async function withServer(listener: RequestListener, run: (port: number) => Promise<void>) {
  // happy-dom also replaces Response; node:http avoids that unrelated fixture
  // incompatibility while still exercising native fetch in this shared process.
  const server = createServer(listener)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    await run((server.address() as { port: number }).port)
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

function adapter(port: number) {
  return new ElasticsearchAdapter({
    system: 'elasticsearch',
    protocol: 'http',
    host: '127.0.0.1',
    port,
    user: '',
    password: '',
    database: '',
  })
}

test('fetch and both abort primitives are the runtime implementations', () => {
  expect(globalThis.fetch).toBe(runtimeFetch)
  expect(globalThis.AbortController).toBe(runtimeAbortController)
  expect(globalThis.AbortSignal).toBe(runtimeAbortSignal)
  expect(new AbortController().signal).toBeInstanceOf(runtimeAbortSignal)
  expect(typeof document.createElement).toBe('function')
})

test('native fetch reads a cross-origin response with a native signal', async () => {
  const received: string[] = []
  await withServer(
    (req, res) => {
      received.push(req.url!)
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ fixture: 'no-cors-headers' }))
    },
    async (port) => {
      const response = await fetch(`http://127.0.0.1:${port}/probe`, {
        signal: new AbortController().signal,
      })
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ fixture: 'no-cors-headers' })
      expect(received).toEqual(['/probe'])
    }
  )
})

test('the Elasticsearch adapter performs real timed HTTP requests after DOM preload', async () => {
  const received: string[] = []
  await withServer(
    (req, res) => {
      received.push(req.url!)
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ version: { number: '8.13.0' } }))
    },
    async (port) => {
      const client = adapter(port)
      await client.connect()
      expect(await client.request<{ version: { number: string } }>('GET', '/probe')).toEqual({
        version: { number: '8.13.0' },
      })
      expect(received).toEqual(['/', '/probe'])
    }
  )
})

test('native aborts still reach the adapter timeout error path', async () => {
  const received: string[] = []
  await withServer(
    (req) => {
      received.push(req.url!)
      // Intentionally leave the fixture response pending until the adapter aborts.
    },
    async (port) => {
      await expect(
        adapter(port).request('GET', '/slow', undefined, { timeout: 1000 })
      ).rejects.toMatchObject({
        code: 'ETIMEDOUT',
      })
      expect(received).toEqual(['/slow'])
    }
  )
})
