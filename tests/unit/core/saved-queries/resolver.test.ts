import { describe, test, expect } from 'bun:test'
import { resolveByName, suggestSimilar } from '@/core/saved-queries/resolver'
import type { ResolvedSnippet, SavedQuery, SnippetSource } from '@/core/saved-queries/types'

function mkQuery(
  key: string,
  engine: 'postgres' | 'mysql' | undefined,
  source: SnippetSource
): ResolvedSnippet {
  const meta = {
    key,
    name: key,
    params: [],
    tags: [],
    ...(engine ? { engine: [engine] } : {}),
  }
  return {
    query: { meta, sqlBody: 'SELECT 1', file: 'x', source } as SavedQuery,
    hasLocalOverride: false,
  }
}

const stub = (key: string, source: SnippetSource = 'shared'): ResolvedSnippet =>
  mkQuery(key, 'postgres', source)

describe('resolver', () => {
  test('exact lookup', () => {
    const map = new Map<string, ResolvedSnippet[]>([['@dau', [stub('@dau')]]])
    expect(resolveByName(map, '@dau', 'postgres').query.meta.key).toBe('@dau')
  })

  test('throws NOT_FOUND with top-5 suggestions', () => {
    const map = new Map<string, ResolvedSnippet[]>([
      ['@dau', [stub('@dau')]],
      ['@analytics/revenue', [stub('@analytics/revenue')]],
      ['@ops/stale-jobs', [stub('@ops/stale-jobs')]],
    ])
    const err = (() => {
      try {
        resolveByName(map, '@dao', 'postgres')
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

  test('resolveByName picks engine-matching variant', () => {
    const map = new Map<string, ResolvedSnippet[]>([
      [
        '@diag/x',
        [mkQuery('@diag/x', 'postgres', 'builtin'), mkQuery('@diag/x', 'mysql', 'builtin')],
      ],
    ])
    const r = resolveByName(map, '@diag/x', 'postgres')
    expect(r.query.meta.engine).toEqual(['postgres'])
  })

  test('resolveByName prefers local > shared > builtin within same engine', () => {
    const map = new Map<string, ResolvedSnippet[]>([
      ['@x', [mkQuery('@x', 'postgres', 'builtin'), mkQuery('@x', 'postgres', 'local')]],
    ])
    const r = resolveByName(map, '@x', 'postgres')
    expect(r.query.source).toBe('local')
  })

  test('resolveByName returns engine-agnostic snippet when no engine declared', () => {
    const map = new Map<string, ResolvedSnippet[]>([['@x', [mkQuery('@x', undefined, 'shared')]]])
    const r = resolveByName(map, '@x', 'postgres')
    expect(r.query.source).toBe('shared')
  })

  test('resolveByName throws ENGINE_MISMATCH when no variant matches', () => {
    const map = new Map<string, ResolvedSnippet[]>([['@x', [mkQuery('@x', 'mysql', 'builtin')]]])
    expect(() => resolveByName(map, '@x', 'postgres')).toThrow(/ENGINE_MISMATCH|engine/)
  })
})
