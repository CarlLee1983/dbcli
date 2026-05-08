import { describe, test, expect } from 'bun:test'
import { foldVariants, type FoldedRow } from '@/core/saved-queries/fold'
import type { ResolvedSnippet } from '@/core/saved-queries/types'

const make = (
  source: 'builtin' | 'shared' | 'local',
  intent: string | undefined,
  description: string
): ResolvedSnippet => ({
  query: {
    meta: {
      name: '@x',
      key: '@x',
      description,
      engine: ['postgres'],
      params: [],
      tags: ['t'],
      intent,
    },
    sqlBody: 'SELECT 1',
    file: `${source}.sql`,
    source,
  },
  hasLocalOverride: false,
})

describe('foldVariants', () => {
  test('local intent overrides shared and builtin', () => {
    const row: FoldedRow = foldVariants('@x', [
      make('builtin', 'capacity.size', 'b'),
      make('shared', 'perf.cache-hit', 's'),
      make('local', 'perf.slow-query', 'l'),
    ])
    expect(row.intent).toBe('perf.slow-query')
    expect(row.description).toBe('l')
  })

  test('shared intent wins when no local exists', () => {
    const row = foldVariants('@x', [
      make('builtin', 'capacity.size', 'b'),
      make('shared', 'perf.cache-hit', 's'),
    ])
    expect(row.intent).toBe('perf.cache-hit')
  })

  test('intent stays undefined when none of the variants set it', () => {
    const row = foldVariants('@x', [make('builtin', undefined, 'b')])
    expect(row.intent).toBeUndefined()
  })
})
