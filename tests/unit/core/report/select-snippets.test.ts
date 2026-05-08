import { describe, test, expect } from 'bun:test'
import { selectSnippets } from '@/core/report/select-snippets'
import type { ResolvedSnippet } from '@/core/saved-queries'

function snippet(opts: {
  key: string
  engine: 'postgres' | 'mysql' | 'redis' | 'elasticsearch'
  intent: string
  required?: boolean
  hasDefault?: boolean
  source?: 'builtin' | 'shared' | 'local'
}): ResolvedSnippet {
  const param = opts.required
    ? [
        {
          name: 'min_seconds',
          type: 'int' as const,
          required: !opts.hasDefault,
          ...(opts.hasDefault ? { default: 30 } : {}),
        },
      ]
    : []
  return {
    query: {
      meta: {
        name: opts.key,
        key: opts.key,
        description: '',
        engine: [opts.engine],
        params: param,
        tags: [],
        intent: opts.intent,
      },
      sqlBody: 'SELECT 1',
      file: `assets/${opts.key}.sql`,
      source: opts.source ?? 'builtin',
    },
    hasLocalOverride: false,
  }
}

function asMap(list: ResolvedSnippet[]): Map<string, ResolvedSnippet[]> {
  const out = new Map<string, ResolvedSnippet[]>()
  for (const s of list) {
    const arr = out.get(s.query.meta.key) ?? []
    arr.push(s)
    out.set(s.query.meta.key, arr)
  }
  return out
}

describe('selectSnippets', () => {
  test('picks postgres variants for postgres engine across requested sections', () => {
    const map = asMap([
      snippet({ key: '@diag/db-size', engine: 'postgres', intent: 'capacity.size' }),
      snippet({ key: '@diag/db-size', engine: 'mysql', intent: 'capacity.size' }),
      snippet({ key: '@diag/long-running', engine: 'postgres', intent: 'perf.slow-query' }),
    ])
    const out = selectSnippets({ map, engine: 'postgres', sections: ['capacity', 'perf'] })
    expect(out.map((s) => s.query.meta.key)).toEqual(['@diag/db-size', '@diag/long-running'])
    expect(out.every((s) => s.query.meta.engine?.includes('postgres'))).toBe(true)
  })

  test('skips snippets whose intent is outside requested sections', () => {
    const map = asMap([
      snippet({ key: '@diag/cache-hit', engine: 'postgres', intent: 'perf.cache-hit' }),
      snippet({ key: '@diag/db-size', engine: 'postgres', intent: 'capacity.size' }),
    ])
    const out = selectSnippets({ map, engine: 'postgres', sections: ['capacity'] })
    expect(out.map((s) => s.query.meta.key)).toEqual(['@diag/db-size'])
  })

  test('skips snippets with required params that have no default', () => {
    const map = asMap([
      snippet({
        key: '@diag/long-running',
        engine: 'postgres',
        intent: 'perf.slow-query',
        required: true,
        hasDefault: false,
      }),
      snippet({
        key: '@diag/long-running-with-default',
        engine: 'postgres',
        intent: 'perf.slow-query',
        required: true,
        hasDefault: true,
      }),
    ])
    const out = selectSnippets({ map, engine: 'postgres', sections: ['perf'] })
    expect(out.map((s) => s.query.meta.key)).toEqual(['@diag/long-running-with-default'])
  })

  test('returns empty list when no variant matches the engine', () => {
    const map = asMap([snippet({ key: '@diag/db-size', engine: 'mysql', intent: 'capacity.size' })])
    const out = selectSnippets({ map, engine: 'redis', sections: ['capacity'] })
    expect(out).toEqual([])
  })

  test('preserves intent ordering from section-map (deterministic)', () => {
    const map = asMap([
      snippet({ key: '@diag/locks', engine: 'postgres', intent: 'safety.locks' }),
      snippet({ key: '@diag/connections', engine: 'postgres', intent: 'safety.connections' }),
    ])
    const out = selectSnippets({ map, engine: 'postgres', sections: ['health'] })
    expect(out.map((s) => s.query.meta.key)).toEqual(['@diag/connections', '@diag/locks'])
  })
})
