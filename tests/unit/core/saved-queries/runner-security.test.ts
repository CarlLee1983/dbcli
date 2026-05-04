import { describe, test, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { prepareExecution } from '@/core/saved-queries/runner'
import { parseSavedQuery } from '@/core/saved-queries/parser'
import { SavedQueryError, type ResolvedSnippet, type SavedQuery } from '@/core/saved-queries/types'

const make = (
  sqlBody: string,
  engine?: ('postgres' | 'mysql')[],
  params: any[] = []
): ResolvedSnippet => ({
  query: {
    meta: { name: 'x', key: '@x', params, tags: [], engine },
    sqlBody,
    file: 'x.sql',
    source: 'shared',
  } as SavedQuery,
  hasLocalOverride: false,
})

describe('prepareExecution — engine matching', () => {
  test('passes when engine matches', () => {
    const out = prepareExecution(
      make('SELECT 1', ['postgres']),
      { engine: 'postgres', noLimit: false },
      {},
      {}
    )
    expect(out.driver.sql).toContain('SELECT 1')
  })

  test('fails when engine mismatches', () => {
    expect(() =>
      prepareExecution(make('SELECT 1', ['postgres']), { engine: 'mysql', noLimit: false }, {}, {})
    ).toThrow(SavedQueryError)
  })

  test('hard-errors on mongo connection', () => {
    expect(() =>
      prepareExecution(
        make('SELECT 1', ['postgres']),
        { engine: 'mongodb' as any, noLimit: false },
        {},
        {}
      )
    ).toThrow(/mongo/i)
  })

  test('warns when engine missing in meta (no throw)', () => {
    const out = prepareExecution(make('SELECT 1'), { engine: 'postgres', noLimit: false }, {}, {})
    expect(out.warnings.some((w) => /engine/i.test(w))).toBe(true)
  })
})

describe('prepareExecution — guards', () => {
  test('wraps with size guard', () => {
    const out = prepareExecution(
      make('SELECT * FROM t'),
      { engine: 'postgres', noLimit: false },
      {},
      {}
    )
    expect(out.driver.sql).toContain('_dbcli_guard')
  })

  test('skips wrap with --no-limit', () => {
    const out = prepareExecution(
      make('SELECT * FROM t'),
      { engine: 'postgres', noLimit: true },
      {},
      {}
    )
    expect(out.driver.sql).not.toContain('_dbcli_guard')
  })
})

const fix = (rel: string) =>
  readFileSync(
    join(import.meta.dir, '..', '..', '..', 'fixtures', 'saved-queries', 'invalid', rel),
    'utf8'
  )

describe('red-line fixtures', () => {
  for (const f of [
    'insert.sql',
    'multi.sql',
    'template-dollar.sql',
    'template-handlebar.sql',
    'too-large.sql',
  ]) {
    test(`rejects ${f}`, () => {
      expect(() =>
        parseSavedQuery({ key: '@x', file: f, source: 'shared', text: fix(f) })
      ).toThrow()
    })
  }
})
