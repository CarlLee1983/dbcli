/**
 * A dotted wildcard rule reaches a nested key on the SQL and Elasticsearch read
 * path — `docs/specs/2026-09-01-nested-glob-rules-on-the-sql-read-path.md`.
 *
 * Literal dotted rules descended into a nested record while wildcard ones were
 * only ever compared against the row's top-level key names, so a PostgreSQL
 * `jsonb` column returned in full under `profile.ss*` and was masked under
 * `profile.SS_num`. The MongoDB read mask understood both. One configuration,
 * two meanings — ADR-0019 Decision 2.
 */
import { describe, test, expect } from 'bun:test'
import { BlacklistManager } from '@/core/blacklist-manager'
import { BlacklistValidator } from '@/core/blacklist-validator'

function maskWith(rule: string, rows: Record<string, unknown>[], columns: string[]) {
  const blacklist = { enabled: true, tables: [], columns: { users: [rule] } }
  const validator = new BlacklistValidator(new BlacklistManager({ blacklist } as never))
  return validator.filterColumnsForTables(['users'], rows, columns)
}

const nestedRow = () => [{ id: 1, profile: { SS_num: '111-22', city: 'tp' } }]

describe('a dotted wildcard rule descends into a nested record', () => {
  test('it removes the matching key and leaves its siblings', () => {
    const result = maskWith('profile.ss*', nestedRow(), ['id', 'profile'])
    expect(result.filteredRows).toEqual([{ id: 1, profile: { city: 'tp' } }])
    // The rule, not the keys it hit: a wildcard can match a different key in
    // every row, so reporting keys made this list grow with the result set —
    // and the literal form has always reported the rule as well.
    expect(result.omittedColumns).toEqual(['profile.ss*'])
  })

  test('a wildcard in the head segment works the same way', () => {
    const result = maskWith('pro*.ss*', nestedRow(), ['id', 'profile'])
    expect(result.filteredRows).toEqual([{ id: 1, profile: { city: 'tp' } }])
  })

  test('the literal form is unchanged', () => {
    const result = maskWith('profile.SS_num', nestedRow(), ['id', 'profile'])
    expect(result.filteredRows).toEqual([{ id: 1, profile: { city: 'tp' } }])
    expect(result.omittedColumns).toEqual(['profile.SS_num'])
  })

  test('the tail form still covers the whole column', () => {
    const result = maskWith('profile.*', nestedRow(), ['id', 'profile'])
    expect(result.filteredRows).toEqual([{ id: 1 }])
  })

  test('a rule matching nothing leaves the row alone', () => {
    const result = maskWith('profile.zz*', nestedRow(), ['id', 'profile'])
    expect(result.filteredRows).toEqual(nestedRow())
    expect(result.omittedColumns).toEqual([])
  })

  test('it reaches deeper than one level, and through an array', () => {
    const rows = (): Record<string, unknown>[] => [
      { id: 1, a: { b: { secret_x: 1, keep: 2 } }, list: [{ token_a: 'x', ok: 1 }] },
    ]
    const deep = maskWith('a.b.sec*', rows(), ['id', 'a', 'list'])
    expect(deep.filteredRows).toEqual([
      { id: 1, a: { b: { keep: 2 } }, list: [{ token_a: 'x', ok: 1 }] },
    ])
    const inArray = maskWith('list.tok*', rows(), ['id', 'a', 'list'])
    expect(inArray.filteredRows).toEqual([
      { id: 1, a: { b: { secret_x: 1, keep: 2 } }, list: [{ ok: 1 }] },
    ])
  })

  // The shapes that made this walk expensive, and one that made it lie.
  test('a Buffer column is not walked as a record', () => {
    const rows = [{ id: 1, profile: { ssn: 'x' }, blob: Buffer.alloc(4096) }] as never
    const started = performance.now()
    const result = maskWith('profile.ss*', rows, ['id', 'profile', 'blob'])
    expect(performance.now() - started).toBeLessThan(50)
    expect(result.omittedColumns).toEqual(['profile.ss*'])
  })

  test('a rule matching a different key in every row reports the rule once', () => {
    const rows = Array.from({ length: 200 }, (_, r) => ({ id: r, profile: { [`u${r}_ssn`]: 'x' } }))
    const started = performance.now()
    const result = maskWith('profile.u*', rows, ['id', 'profile'])
    expect(performance.now() - started).toBeLessThan(200)
    expect(result.omittedColumns).toEqual(['profile.u*'])
    expect(result.filteredRows[0]).toEqual({ id: 0, profile: {} })
  })

  // Enumeration and removal have to agree on what a record is, or a path is
  // named in "columns omitted" while its value comes back in full.
  test('a non-plain nested object is not reported as omitted', () => {
    class Profile {
      constructor(
        public ssn = '111-22',
        public city = 'tp'
      ) {}
    }
    const result = maskWith('profile.ss*', [{ id: 1, profile: new Profile() }], ['id', 'profile'])
    expect(result.omittedColumns).toEqual([])
  })

  // A record's key may itself contain a dot — `flattenSource` produces exactly
  // that, and `readPath` and `omitPath` each carry a branch for it. A key
  // consumes the segments it spells, not one, or a branch is judged unreachable
  // and copied whole while the rule is still reported as omitted.
  test.each([
    ['a.b.c.d*', { id: 1, a: { 'b.c': { d1: 'SECRET', keep: 1 } } }],
    ['a.b.c.ss*', { id: 1, a: { b: { 'c.ssn': 'SECRET', keep: 1 } } }],
    ['a.b.*', { id: 1, a: { 'b.c': { ssn: 'SECRET' } } }],
    ['profile.a.ss*', { id: 1, profile: { 'a.ssn': 'SECRET' } }],
  ])('rule %p removes the value behind a key that carries a dot', (rule, row) => {
    const result = maskWith(rule as string, [row as Record<string, unknown>], Object.keys(row))
    expect(JSON.stringify(result.filteredRows)).not.toContain('SECRET')
    expect(result.omittedColumns).toEqual([rule as string])
  })

  test('a dotted key that no rule reaches is left alone', () => {
    const result = maskWith('a.b.c.zz*', [{ id: 1, a: { 'b.c': { d1: 'keep' } } }], ['id', 'a'])
    expect(result.filteredRows).toEqual([{ id: 1, a: { 'b.c': { d1: 'keep' } } }])
    expect(result.omittedColumns).toEqual([])
  })

  test('an Elasticsearch flattened key is still matched as a top-level name', () => {
    const rows = [{ id: 1, 'profile.SS_num': '111-22', 'profile.city': 'tp' }]
    const result = maskWith('profile.ss*', rows, ['id', 'profile.SS_num', 'profile.city'])
    expect(result.filteredRows).toEqual([{ id: 1, 'profile.city': 'tp' }])
  })
})
