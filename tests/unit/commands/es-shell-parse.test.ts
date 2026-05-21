import { test, expect } from 'bun:test'
import { parseEsRequest, extractIndexFromPath } from '@/commands/es-shell'

test('parses method + path with no body', () => {
  expect(parseEsRequest('GET /users/_search')).toEqual({ method: 'GET', path: '/users/_search' })
})

test('parses method + path + multi-line JSON body', () => {
  const block = 'POST /users/_search\n{\n  "query": { "match_all": {} }\n}'
  expect(parseEsRequest(block)).toEqual({
    method: 'POST',
    path: '/users/_search',
    body: { query: { match_all: {} } },
  })
})

test('uppercases the method', () => {
  expect(parseEsRequest('get /_cat/indices').method).toBe('GET')
})

test('throws on missing path', () => {
  expect(() => parseEsRequest('GET')).toThrow('path')
})

test('throws on malformed JSON body', () => {
  expect(() => parseEsRequest('POST /x/_search\n{ not json }')).toThrow()
})

test('extractIndexFromPath returns the first segment', () => {
  expect(extractIndexFromPath('/users/_search')).toBe('users')
  expect(extractIndexFromPath('/_cat/indices')).toBeUndefined()
})
