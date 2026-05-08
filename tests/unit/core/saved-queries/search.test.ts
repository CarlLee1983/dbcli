import { describe, test, expect } from 'bun:test'
import { searchSnippets } from '@/core/saved-queries/search'
import type { FoldedRow } from '@/core/saved-queries/fold'

const row = (over: Partial<FoldedRow>): FoldedRow => ({
  name: '@x',
  sources: ['builtin'],
  engines: ['postgres'],
  params: [],
  description: '',
  tags: [],
  hasLocalOverride: false,
  ...over,
})

describe('searchSnippets', () => {
  test('empty query returns []', () => {
    expect(searchSnippets([row({})], { query: '' })).toEqual([])
  })

  test('single token hits name', () => {
    const hits = searchSnippets(
      [row({ name: '@long-running.postgres' }), row({ name: '@cache-hit.postgres' })],
      { query: 'long' }
    )
    expect(hits).toHaveLength(1)
    expect(hits[0]!.name).toBe('@long-running.postgres')
  })

  test('multi-token requires every token to match somewhere', () => {
    const hits = searchSnippets(
      [
        row({ name: '@long-running.postgres', description: 'queries running long' }),
        row({ name: '@cache-hit.postgres', description: 'cache' }),
      ],
      { query: 'long running' }
    )
    expect(hits.map((h) => h.name)).toEqual(['@long-running.postgres'])
  })

  test('name hit ranks above description hit (weight)', () => {
    const hits = searchSnippets(
      [
        row({ name: '@cache-hit.postgres', description: 'mentions slow somewhere' }),
        row({ name: '@slow-query.postgres', description: 'unrelated' }),
      ],
      { query: 'slow' }
    )
    expect(hits[0]!.name).toBe('@slow-query.postgres')
    expect(hits[0]!.score).toBeGreaterThan(hits[1]!.score)
  })

  test('intent and tag both contribute to hits', () => {
    const hits = searchSnippets(
      [row({ name: '@a', intent: 'perf.slow-query' }), row({ name: '@b', tags: ['perf'] })],
      { query: 'perf' }
    )
    expect(hits.map((h) => h.name).sort()).toEqual(['@a', '@b'])
  })

  test('engineFilter narrows results', () => {
    const hits = searchSnippets(
      [
        row({ name: '@a', engines: ['postgres'], description: 'slow' }),
        row({ name: '@b', engines: ['mysql'], description: 'slow' }),
      ],
      { query: 'slow', engineFilter: 'postgres' }
    )
    expect(hits.map((h) => h.name)).toEqual(['@a'])
  })

  test('source tie-break: local > shared > builtin', () => {
    const hits = searchSnippets(
      [
        row({ name: '@a', sources: ['builtin'], description: 'slow' }),
        row({ name: '@a', sources: ['local'], description: 'slow' }),
      ],
      { query: 'slow' }
    )
    expect(hits[0]!.source).toBe('local')
  })

  test('limit truncates results', () => {
    const hits = searchSnippets(
      [
        row({ name: '@a', description: 'slow' }),
        row({ name: '@b', description: 'slow' }),
        row({ name: '@c', description: 'slow' }),
      ],
      { query: 'slow', limit: 2 }
    )
    expect(hits).toHaveLength(2)
  })

  test('score is in [0,1]', () => {
    const hits = searchSnippets(
      [row({ name: '@long-running.postgres', description: 'queries running long' })],
      { query: 'long running' }
    )
    expect(hits[0]!.score).toBeGreaterThan(0)
    expect(hits[0]!.score).toBeLessThanOrEqual(1)
  })
})
