import { describe, test, expect } from 'bun:test'
import { parseSavedQuery } from '@/core/saved-queries/parser'
import { SavedQueryError } from '@/core/saved-queries/types'

const wrap = (sql: string, fm = ''): string =>
  fm ? `-- ---\n${fm}\n-- ---\n\n${sql}` : sql

describe('parseSavedQuery — frontmatter', () => {
  test('parses full frontmatter', () => {
    const text = wrap(
      'SELECT 1 AS x;',
      [
        '-- name: Sample',
        '-- description: just a sample',
        '-- engine: postgres',
        '-- params:',
        '--   days:',
        '--     type: int',
        '--     default: 7',
        '-- tags: [analytics]',
      ].join('\n')
    )
    const out = parseSavedQuery({ key: '@sample', file: 'sample.sql', source: 'shared', text })
    expect(out.query.meta.name).toBe('Sample')
    expect(out.query.meta.engine).toEqual(['postgres'])
    expect(out.query.meta.params).toEqual([
      { name: 'days', type: 'int', required: false, default: 7 },
    ])
    expect(out.query.meta.tags).toEqual(['analytics'])
    expect(out.warnings).toEqual([])
  })

  test('warns when engine missing', () => {
    const text = wrap('SELECT 1;', '-- name: x')
    const out = parseSavedQuery({ key: '@x', file: 'x.sql', source: 'local', text })
    expect(out.warnings.some((w) => /engine/i.test(w))).toBe(true)
  })

  test('treats engine as inline list', () => {
    const text = wrap('SELECT 1;', '-- name: x\n-- engine: [postgres, mysql]')
    const out = parseSavedQuery({ key: '@x', file: 'x.sql', source: 'shared', text })
    expect(out.query.meta.engine).toEqual(['postgres', 'mysql'])
  })
})

describe('parseSavedQuery — SQL body invariants', () => {
  test('rejects INSERT', () => {
    expect(() =>
      parseSavedQuery({ key: '@i', file: 'i.sql', source: 'shared', text: 'INSERT INTO t VALUES (1);' })
    ).toThrow(SavedQueryError)
  })

  test('rejects DELETE', () => {
    expect(() =>
      parseSavedQuery({ key: '@d', file: 'd.sql', source: 'shared', text: 'DELETE FROM t;' })
    ).toThrow(SavedQueryError)
  })

  test('rejects multi-statement', () => {
    expect(() =>
      parseSavedQuery({ key: '@m', file: 'm.sql', source: 'shared', text: 'SELECT 1; DROP TABLE x;' })
    ).toThrow(SavedQueryError)
  })

  test('allows trailing semicolon and comments', () => {
    const text = 'SELECT 1; -- trailing\n/* end */'
    const out = parseSavedQuery({ key: '@t', file: 't.sql', source: 'shared', text })
    expect(out.query.sqlBody.trim().startsWith('SELECT 1')).toBe(true)
  })

  test('rejects ${...} template', () => {
    expect(() =>
      parseSavedQuery({ key: '@t', file: 't.sql', source: 'shared', text: 'SELECT * FROM ${table}' })
    ).toThrow(/use :name/i)
  })

  test('rejects {{...}} template', () => {
    expect(() =>
      parseSavedQuery({ key: '@t', file: 't.sql', source: 'shared', text: 'SELECT {{x}}' })
    ).toThrow(/use :name/i)
  })

  test('rejects template inside string literal', () => {
    expect(() =>
      parseSavedQuery({
        key: '@t',
        file: 't.sql',
        source: 'shared',
        text: "SELECT * FROM users WHERE name = '${name}'",
      })
    ).toThrow(/use :name/i)
  })

  test('rejects oversized file (> 64KB)', () => {
    const big = 'SELECT 1; ' + 'a'.repeat(64 * 1024)
    expect(() =>
      parseSavedQuery({ key: '@b', file: 'b.sql', source: 'shared', text: big })
    ).toThrow(/64/)
  })

  test('accepts WITH (CTE) as first keyword', () => {
    const text = 'WITH a AS (SELECT 1) SELECT * FROM a;'
    const out = parseSavedQuery({ key: '@cte', file: 'c.sql', source: 'shared', text })
    expect(out.query.sqlBody.trim().startsWith('WITH')).toBe(true)
  })
})
