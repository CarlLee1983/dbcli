import { describe, expect, test } from 'bun:test'
import { parseWhereClause } from '@/utils/where-parser'

describe('parseWhereClause', () => {
  test('parses single key=value with numeric coercion', () => {
    expect(parseWhereClause('id=1')).toEqual({ id: 1 })
  })

  test('parses AND-joined conditions case-insensitively', () => {
    expect(parseWhereClause("id=1 AND status='active'")).toEqual({
      id: 1,
      status: 'active',
    })
    expect(parseWhereClause('id=1 and name="Alice"')).toEqual({
      id: 1,
      name: 'Alice',
    })
  })

  test('strips matching single or double quotes around values', () => {
    expect(parseWhereClause("name='Alice'")).toEqual({ name: 'Alice' })
    expect(parseWhereClause('name="Bob"')).toEqual({ name: 'Bob' })
  })

  test('coerces true/false/null literals', () => {
    expect(parseWhereClause('flag=true')).toEqual({ flag: true })
    expect(parseWhereClause('flag=false')).toEqual({ flag: false })
    expect(parseWhereClause('deleted_at=null')).toEqual({ deleted_at: null })
  })

  test('throws on empty input', () => {
    expect(() => parseWhereClause('')).toThrow(/empty/i)
    expect(() => parseWhereClause('   ')).toThrow(/empty/i)
  })

  test('throws on unparseable fragments', () => {
    expect(() => parseWhereClause('id > 1')).toThrow(/Cannot parse WHERE clause/)
    expect(() => parseWhereClause('id=1 AND')).toThrow(/Cannot parse WHERE clause/)
  })
})
