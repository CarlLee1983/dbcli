import { describe, test, expect } from 'bun:test'
import { suggestSnippets } from '@/core/saved-queries/suggest'
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

describe('suggestSnippets', () => {
  test('exact intent match', () => {
    const hits = suggestSnippets(
      [
        row({ name: '@a', intent: 'perf.slow-query' }),
        row({ name: '@b', intent: 'perf.cache-hit' }),
      ],
      { intent: 'perf.slow-query' }
    )
    expect(hits.map((h) => h.name)).toEqual(['@a'])
  })

  test('prefix intent match', () => {
    const hits = suggestSnippets(
      [
        row({ name: '@a', intent: 'perf.slow-query' }),
        row({ name: '@b', intent: 'perf.cache-hit' }),
        row({ name: '@c', intent: 'capacity.size' }),
      ],
      { intent: 'perf' }
    )
    expect(hits.map((h) => h.name).sort()).toEqual(['@a', '@b'])
  })

  test('prefix does not partial-match across non-dot boundary', () => {
    const hits = suggestSnippets(
      [
        row({ name: '@a', intent: 'perf.slow-query' }),
        row({ name: '@b', intent: 'performance.foo' }),
      ],
      { intent: 'perf' }
    )
    expect(hits.map((h) => h.name)).toEqual(['@a'])
  })

  test('snippets without intent are excluded', () => {
    const hits = suggestSnippets(
      [row({ name: '@a' }), row({ name: '@b', intent: 'perf.slow-query' })],
      { intent: 'perf' }
    )
    expect(hits.map((h) => h.name)).toEqual(['@b'])
  })

  test('engineFilter narrows results', () => {
    const hits = suggestSnippets(
      [
        row({ name: '@a', engines: ['postgres'], intent: 'perf.slow-query' }),
        row({ name: '@b', engines: ['mysql'], intent: 'perf.slow-query' }),
      ],
      { intent: 'perf', engineFilter: 'postgres' }
    )
    expect(hits.map((h) => h.name)).toEqual(['@a'])
  })

  test('ordering: intent asc → engine asc → name asc', () => {
    const hits = suggestSnippets(
      [
        row({ name: '@a', engines: ['postgres'], intent: 'perf.slow-query' }),
        row({ name: '@b', engines: ['mysql'], intent: 'perf.cache-hit' }),
        row({ name: '@c', engines: ['mysql'], intent: 'perf.cache-hit' }),
      ],
      { intent: 'perf' }
    )
    expect(hits.map((h) => h.name)).toEqual(['@b', '@c', '@a'])
  })

  test('zero matches returns []', () => {
    expect(suggestSnippets([row({ intent: 'perf.slow-query' })], { intent: 'safety' })).toEqual([])
  })
})
