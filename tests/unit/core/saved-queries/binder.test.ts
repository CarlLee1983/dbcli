import { describe, test, expect } from 'bun:test'
import { coerceParams, rewriteToBind, mergeParamSources } from '@/core/saved-queries/binder'
import { SavedQueryError, type ParamSpec } from '@/core/saved-queries/types'

const days: ParamSpec = { name: 'days', type: 'int', required: false, default: 7 }
const orgId: ParamSpec = { name: 'org_id', type: 'string', required: true }

describe('coerceParams', () => {
  test('applies defaults', () => {
    const out = coerceParams([days, orgId], { org_id: 'acme' })
    expect(out).toEqual({ days: 7, org_id: 'acme' })
  })

  test('coerces int / float / bool', () => {
    const specs: ParamSpec[] = [
      { name: 'a', type: 'int', required: true },
      { name: 'b', type: 'float', required: true },
      { name: 'c', type: 'bool', required: true },
    ]
    expect(coerceParams(specs, { a: '7', b: '1.5', c: 'YES' })).toEqual({ a: 7, b: 1.5, c: true })
  })

  test('rejects NaN int', () => {
    expect(() =>
      coerceParams([{ name: 'n', type: 'int', required: true }], { n: 'abc' })
    ).toThrow(SavedQueryError)
  })

  test('rejects missing required', () => {
    const err = (() => {
      try {
        coerceParams([orgId], {})
        return null
      } catch (e) {
        return e as Error
      }
    })()
    expect(err).toBeTruthy()
    expect(err!.message).toMatch(/org_id/)
  })

  test('rejects values outside enum', () => {
    const spec: ParamSpec = { name: 'env', type: 'string', required: true, enum: ['dev', 'prod'] }
    expect(() => coerceParams([spec], { env: 'staging' })).toThrow(SavedQueryError)
  })
})

describe('rewriteToBind', () => {
  test('postgres: :name → $1, $2', () => {
    const sql = 'SELECT * FROM events WHERE org_id = :org_id AND created_at > :since'
    const out = rewriteToBind(sql, { org_id: 'acme', since: '2026-01-01' }, 'postgres')
    expect(out.sql).toBe('SELECT * FROM events WHERE org_id = $1 AND created_at > $2')
    expect(out.values).toEqual(['acme', '2026-01-01'])
  })

  test('mysql: :name → ?', () => {
    const out = rewriteToBind('SELECT :a, :b', { a: 1, b: 2 }, 'mysql')
    expect(out.sql).toBe('SELECT ?, ?')
    expect(out.values).toEqual([1, 2])
  })

  test('reuses placeholder index when same :name appears twice', () => {
    const sql = 'SELECT * FROM t WHERE a = :x OR b = :x'
    const out = rewriteToBind(sql, { x: 1 }, 'postgres')
    expect(out.sql).toBe('SELECT * FROM t WHERE a = $1 OR b = $1')
    expect(out.values).toEqual([1])
  })

  test('does not touch ::cast or :name inside string literal', () => {
    const sql = "SELECT created_at::date, ':not_a_param' FROM t WHERE id = :id"
    const out = rewriteToBind(sql, { id: 9 }, 'postgres')
    expect(out.sql).toBe("SELECT created_at::date, ':not_a_param' FROM t WHERE id = $1")
    expect(out.values).toEqual([9])
  })

  test('reports undeclared :name (caller decides what to do)', () => {
    const out = rewriteToBind('SELECT :extra', {}, 'postgres')
    expect(out.undeclared).toEqual(['extra'])
  })
})

describe('mergeParamSources', () => {
  test('--param overrides --param-file', () => {
    const merged = mergeParamSources({ days: 30 }, { days: 7, org_id: 'acme' })
    expect(merged).toEqual({ days: 30, org_id: 'acme' })
  })
})
