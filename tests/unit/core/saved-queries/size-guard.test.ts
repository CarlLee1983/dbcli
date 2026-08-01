import { describe, test, expect } from 'bun:test'
import { applySnippetGuard, SNIPPET_GUARD_LIMIT } from '@/core/saved-queries/size-guard'

describe('applySnippetGuard', () => {
  test('wraps SELECT body with a one-row lookahead over the guard limit', () => {
    const out = applySnippetGuard('SELECT * FROM events ORDER BY id', { noLimit: false })
    expect(out.sql).toBe(
      'SELECT * FROM (SELECT * FROM events ORDER BY id) AS _dbcli_guard LIMIT 1001'
    )
    expect(out.guardLimit).toBe(SNIPPET_GUARD_LIMIT)
  })

  test('strips trailing semicolon before wrapping', () => {
    const out = applySnippetGuard('SELECT 1;', { noLimit: false })
    expect(out.sql).toBe('SELECT * FROM (SELECT 1) AS _dbcli_guard LIMIT 1001')
    expect(out.guardLimit).toBe(SNIPPET_GUARD_LIMIT)
  })

  test('no wrap and no guard limit when --no-limit', () => {
    const out = applySnippetGuard('SELECT * FROM t', { noLimit: true })
    expect(out.sql).toBe('SELECT * FROM t')
    expect(out.guardLimit).toBeUndefined()
  })

  test('no wrap when literal outer LIMIT < 1000', () => {
    const out = applySnippetGuard('SELECT * FROM t LIMIT 50', { noLimit: false })
    expect(out.sql).toBe('SELECT * FROM t LIMIT 50')
    expect(out.guardLimit).toBeUndefined()
  })

  test('wraps when LIMIT is parameterised (LIMIT :max)', () => {
    const out = applySnippetGuard('SELECT * FROM t LIMIT :max', { noLimit: false })
    expect(out.sql).toBe('SELECT * FROM (SELECT * FROM t LIMIT :max) AS _dbcli_guard LIMIT 1001')
    expect(out.guardLimit).toBe(SNIPPET_GUARD_LIMIT)
  })

  test('wraps when literal LIMIT >= 1000', () => {
    const out = applySnippetGuard('SELECT * FROM t LIMIT 5000', { noLimit: false })
    expect(out.sql).toBe('SELECT * FROM (SELECT * FROM t LIMIT 5000) AS _dbcli_guard LIMIT 1001')
    expect(out.guardLimit).toBe(SNIPPET_GUARD_LIMIT)
  })
})
