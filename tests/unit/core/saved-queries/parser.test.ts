import { describe, test, expect } from 'bun:test'
import { parseSavedQuery, validateBody } from '@/core/saved-queries/parser'
import { SavedQueryError } from '@/core/saved-queries/types'

const wrap = (sql: string, fm = ''): string => (fm ? `-- ---\n${fm}\n-- ---\n\n${sql}` : sql)

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
      parseSavedQuery({
        key: '@i',
        file: 'i.sql',
        source: 'shared',
        text: 'INSERT INTO t VALUES (1);',
      })
    ).toThrow(SavedQueryError)
  })

  test('rejects DELETE', () => {
    expect(() =>
      parseSavedQuery({ key: '@d', file: 'd.sql', source: 'shared', text: 'DELETE FROM t;' })
    ).toThrow(SavedQueryError)
  })

  test('rejects multi-statement', () => {
    expect(() =>
      parseSavedQuery({
        key: '@m',
        file: 'm.sql',
        source: 'shared',
        text: 'SELECT 1; DROP TABLE x;',
      })
    ).toThrow(SavedQueryError)
  })

  test('allows trailing semicolon and comments', () => {
    const text = 'SELECT 1; -- trailing\n/* end */'
    const out = parseSavedQuery({ key: '@t', file: 't.sql', source: 'shared', text })
    expect(out.query.sqlBody.trim().startsWith('SELECT 1')).toBe(true)
  })

  test('rejects ${...} template', () => {
    expect(() =>
      parseSavedQuery({
        key: '@t',
        file: 't.sql',
        source: 'shared',
        text: 'SELECT * FROM ${table}',
      })
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

describe('parseSavedQuery — multi-engine extensions', () => {
  test('accepts engine: elasticsearch with index field', () => {
    const text = wrap(
      '{ "query": { "match_all": {} } }',
      ['-- engine: elasticsearch', "-- index: 'events-*'"].join('\n')
    )
    const out = parseSavedQuery({ key: '@es', file: 'es.sql', source: 'shared', text })
    expect(out.query.meta.engine).toEqual(['elasticsearch'])
    expect(out.query.meta.index).toBe('events-*')
  })

  test('accepts engine: redis without index field', () => {
    const text = wrap('GET key', '-- engine: redis')
    const out = parseSavedQuery({ key: '@r', file: 'r.sql', source: 'shared', text })
    expect(out.query.meta.engine).toEqual(['redis'])
  })

  test('rejects mixed-family engine list', () => {
    const text = wrap('SELECT 1', '-- engine: [postgres, elasticsearch]')
    expect(() => parseSavedQuery({ key: '@bad', file: 'bad.sql', source: 'shared', text })).toThrow(
      /families/i
    )
  })

  test('rejects elasticsearch snippet without index', () => {
    const text = wrap('{ "query": { "match_all": {} } }', '-- engine: elasticsearch')
    expect(() => parseSavedQuery({ key: '@es', file: 'es.sql', source: 'shared', text })).toThrow(
      /index/i
    )
  })
})

describe('parseSavedQuery — intent', () => {
  test('parses legal intent value', () => {
    const text = wrap('SELECT 1;', 'name: x\nengine: postgres\nintent: perf.slow-query')
    const out = parseSavedQuery({ key: '@x', file: 'x.sql', source: 'builtin', text })
    expect(out.query.meta.intent).toBe('perf.slow-query')
  })

  test('missing intent → undefined (backward compat)', () => {
    const text = wrap('SELECT 1;', 'name: x\nengine: postgres')
    const out = parseSavedQuery({ key: '@x', file: 'x.sql', source: 'builtin', text })
    expect(out.query.meta.intent).toBeUndefined()
  })

  test('rejects intent with uppercase', () => {
    const text = wrap('SELECT 1;', 'name: x\nengine: postgres\nintent: Perf.Slow')
    expect(() => parseSavedQuery({ key: '@x', file: 'x.sql', source: 'builtin', text })).toThrow(
      SavedQueryError
    )
  })

  test('rejects intent with whitespace', () => {
    const text = wrap('SELECT 1;', 'name: x\nengine: postgres\nintent: "perf slow"')
    expect(() => parseSavedQuery({ key: '@x', file: 'x.sql', source: 'builtin', text })).toThrow(
      /invalid intent/
    )
  })

  test('rejects empty intent string', () => {
    const text = wrap('SELECT 1;', 'name: x\nengine: postgres\nintent: ""')
    expect(() => parseSavedQuery({ key: '@x', file: 'x.sql', source: 'builtin', text })).toThrow(
      /invalid intent/
    )
  })
})

describe('validateBody — data-modifying CTEs', () => {
  const input = { key: '@t', file: '/tmp/t.sql' } as any

  test('rejects a WITH clause whose CTE deletes rows', () => {
    expect(() =>
      validateBody('WITH gone AS (DELETE FROM users WHERE id = 1 RETURNING *) SELECT * FROM gone', input)
    ).toThrow(/read-only|DELETE/i)
  })

  test('rejects a WITH clause whose CTE updates rows', () => {
    expect(() =>
      validateBody('WITH bumped AS (UPDATE users SET n = n + 1 RETURNING *) SELECT * FROM bumped', input)
    ).toThrow(/read-only|UPDATE/i)
  })

  test('rejects a WITH clause whose CTE inserts rows', () => {
    expect(() =>
      validateBody('WITH added AS (INSERT INTO users (n) VALUES (1) RETURNING *) SELECT * FROM added', input)
    ).toThrow(/read-only|INSERT/i)
  })

  test('still accepts an ordinary read-only CTE', () => {
    expect(() =>
      validateBody('WITH recent AS (SELECT * FROM users ORDER BY created_at DESC) SELECT * FROM recent', input)
    ).not.toThrow()
  })

  test('does not reject a literal that merely mentions delete', () => {
    expect(() => validateBody("SELECT * FROM logs WHERE action = 'DELETE'", input)).not.toThrow()
  })
})

describe('verify.query must be read-only', () => {
  const withVerify = (verifyQuery: string) =>
    parseSavedQuery({
      key: '@t',
      file: 't.sql',
      source: 'shared',
      text: wrap(
        'SELECT * FROM users',
        [
          '-- name: t',
          '-- engine: postgres',
          '-- verify:',
          `--   query: "${verifyQuery}"`,
          '--   expects: "count > 0"',
        ].join('\n')
      ),
    })

  test('rejects a verification query that deletes rows', () => {
    expect(() => withVerify('DELETE FROM users')).toThrow(/read-only|DELETE/i)
  })

  test('accepts an ordinary verification count', () => {
    expect(() => withVerify('SELECT count(*) AS count FROM users')).not.toThrow()
  })
})

describe('validateBody — read-only proof does not over-block', () => {
  const input = (engine?: string) =>
    ({ key: '@t', file: 't.sql', engine: engine ? [engine] : undefined }) as any

  test('accepts a locking read (FOR UPDATE takes a lock, it does not write)', () => {
    expect(() =>
      validateBody('SELECT * FROM users WHERE id = :id FOR UPDATE', input('postgres'))
    ).not.toThrow()
  })

  test('accepts FOR NO KEY UPDATE and FOR SHARE', () => {
    expect(() =>
      validateBody('SELECT * FROM users FOR NO KEY UPDATE', input('postgres'))
    ).not.toThrow()
    expect(() => validateBody('SELECT * FROM users FOR SHARE', input('postgres'))).not.toThrow()
  })

  test('accepts backtick-quoted identifiers that spell keywords', () => {
    expect(() =>
      validateBody('SELECT `update`, `create` FROM `orders`', input('mysql'))
    ).not.toThrow()
  })

  test('accepts a MySQL # comment mentioning a keyword', () => {
    expect(() =>
      validateBody('SELECT id FROM users # drop this column later\n', input('mysql'))
    ).not.toThrow()
  })

  test('accepts a dotted column whose name spells a keyword', () => {
    expect(() => validateBody('SELECT a.create FROM a', input('postgres'))).not.toThrow()
  })

  test('still rejects a real write hiding behind a lock clause', () => {
    expect(() =>
      validateBody(
        'WITH gone AS (DELETE FROM users RETURNING *) SELECT * FROM gone FOR UPDATE',
        input('postgres')
      )
    ).toThrow(/read-only|DELETE/i)
  })

  test('still rejects a write keyword that a different dialect would execute', () => {
    // Backticks are not string quoting in PostgreSQL, so this is executable there.
    expect(() => validateBody('SELECT `x`; DROP TABLE t', input('postgres'))).toThrow(
      /read-only|DROP/i
    )
  })
})
