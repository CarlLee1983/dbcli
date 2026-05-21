import { test, expect } from 'bun:test'
import { runEsRequest } from '@/commands/es-shell'

function fakeAdapter(captured: { method?: string; path?: string; body?: unknown }) {
  return {
    request: async (method: string, path: string, body?: unknown) => {
      captured.method = method
      captured.path = path
      captured.body = body
      return { ok: true }
    },
  }
}

test('blocks blacklisted index', async () => {
  const captured: Record<string, unknown> = {}
  await expect(
    runEsRequest({ method: 'GET', path: '/secrets/_search' }, fakeAdapter(captured) as never, [
      'secrets',
    ])
  ).rejects.toThrow('blacklist')
  expect(captured.path).toBeUndefined()
})

test('injects size cap into a _search body lacking size', async () => {
  const captured: Record<string, unknown> = {}
  await runEsRequest(
    { method: 'POST', path: '/users/_search', body: { query: { match_all: {} } } },
    fakeAdapter(captured) as never,
    []
  )
  expect((captured.body as { size?: number }).size).toBe(1000)
})

test('passes non-search requests through unchanged', async () => {
  const captured: Record<string, unknown> = {}
  const res = await runEsRequest(
    { method: 'GET', path: '/_cat/indices' },
    fakeAdapter(captured) as never,
    []
  )
  expect(res).toEqual({ ok: true })
  expect(captured.body).toBeUndefined()
})
