import { describe, test, expect } from 'bun:test'
import { sqlStrategy } from '@/core/saved-queries/strategies/sql'
import { SavedQueryError, type SavedQuery } from '@/core/saved-queries/types'

const buildSnippet = (sqlBody: string, engine: 'postgres' | 'mysql' = 'postgres'): SavedQuery => ({
  meta: { name: 't', key: '@t', engine: [engine], params: [], tags: [] },
  sqlBody,
  file: '/tmp/t.sql',
  source: 'shared',
})

describe('sqlStrategy', () => {
  test('family is sql', () => {
    expect(sqlStrategy.family).toBe('sql')
  })

  test('validateBody accepts SELECT', () => {
    expect(() =>
      sqlStrategy.validateBody(
        'SELECT 1',
        { name: 't', key: '@t', params: [], tags: [] },
        '/tmp/t.sql'
      )
    ).not.toThrow()
  })

  test('validateBody rejects INSERT', () => {
    expect(() =>
      sqlStrategy.validateBody(
        'INSERT INTO t VALUES (1)',
        { name: 't', key: '@t', params: [], tags: [] },
        '/tmp/t.sql'
      )
    ).toThrow(SavedQueryError)
  })

  test('prepare wraps with size guard and rewrites :name (postgres)', () => {
    const snippet = buildSnippet('SELECT * FROM t WHERE id = :id')
    const prepared = sqlStrategy.prepare(
      snippet,
      { id: 42 },
      { engine: 'postgres', noLimit: false }
    )
    expect(prepared.driver.sql).toContain('LIMIT 1000')
    expect(prepared.driver.sql).toContain('$1')
    expect(prepared.driver.values).toEqual([42])
  })

  test('prepare uses ? for mysql', () => {
    const snippet = buildSnippet('SELECT * FROM t WHERE id = :id', 'mysql')
    const prepared = sqlStrategy.prepare(snippet, { id: 42 }, { engine: 'mysql', noLimit: false })
    expect(prepared.driver.sql).toContain('?')
  })
})

import { prepareExecution } from '@/core/saved-queries/runner'
import type { ResolvedSnippet } from '@/core/saved-queries/types'

describe('runner.prepareExecution dispatches to sql strategy', () => {
  const resolved: ResolvedSnippet = {
    query: {
      meta: { name: 't', key: '@t', engine: ['postgres'], params: [], tags: [] },
      sqlBody: 'SELECT 1',
      file: '/tmp/t.sql',
      source: 'shared',
    },
    hasLocalOverride: false,
  }

  test('still produces SQL with size guard for postgres', () => {
    const out = prepareExecution(resolved, { engine: 'postgres', noLimit: false }, {}, {})
    expect(out.driver.sql).toContain('LIMIT 1000')
  })

  test('mongodb connection throws clear error', () => {
    expect(() => prepareExecution(resolved, { engine: 'mongodb', noLimit: false }, {}, {})).toThrow(
      /MongoDB|mongodb/i
    )
  })
})
