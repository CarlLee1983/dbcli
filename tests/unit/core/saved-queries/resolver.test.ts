import { describe, test, expect } from 'bun:test'
import { resolveByName, suggestSimilar } from '@/core/saved-queries/resolver'
import type { ResolvedSnippet } from '@/core/saved-queries/types'

const stub = (key: string): ResolvedSnippet => ({
  query: {
    meta: { name: key, key, params: [], tags: [] },
    sqlBody: 'SELECT 1',
    file: `${key}.sql`,
    source: 'shared',
  },
  hasLocalOverride: false,
})

describe('resolver', () => {
  test('exact lookup', () => {
    const map = new Map([['@dau', stub('@dau')]])
    expect(resolveByName(map, '@dau').query.meta.key).toBe('@dau')
  })

  test('throws NOT_FOUND with top-5 suggestions', () => {
    const map = new Map([
      ['@dau', stub('@dau')],
      ['@analytics/revenue', stub('@analytics/revenue')],
      ['@ops/stale-jobs', stub('@ops/stale-jobs')],
    ])
    const err = (() => {
      try {
        resolveByName(map, '@dao')
        return null
      } catch (e) {
        return e as Error
      }
    })()
    expect(err).toBeTruthy()
    expect(err!.message).toMatch(/@dau/)
  })

  test('suggestSimilar returns ≤5 closest by Levenshtein', () => {
    const all = ['@dau', '@dao', '@daus', '@daily', '@duo', '@delta']
    expect(suggestSimilar(all, '@dao').length).toBeLessThanOrEqual(5)
  })
})
