import { test, expect, describe } from 'bun:test'
import { parseColumnSpec } from 'src/adapters/ddl/column-parser'

describe('parseColumnSpec', () => {
  test('basic name:type', () => {
    const col = parseColumnSpec('name:varchar(50)')
    expect(col.name).toBe('name')
    expect(col.type).toBe('varchar(50)')
    expect(col.nullable).toBe(true)
  })

  test('primary key modifier', () => {
    const col = parseColumnSpec('id:integer:pk')
    expect(col.name).toBe('id')
    expect(col.primaryKey).toBe(true)
    expect(col.nullable).toBe(false)
  })

  test('not-null modifier', () => {
    const col = parseColumnSpec('email:varchar(100):not-null')
    expect(col.nullable).toBe(false)
  })

  test('unique modifier', () => {
    const col = parseColumnSpec('email:varchar(100):unique')
    expect(col.unique).toBe(true)
  })

  test('default value', () => {
    const col = parseColumnSpec('status:varchar(20):default=active')
    expect(col.default).toBe('active')
  })

  test('default with parentheses', () => {
    const col = parseColumnSpec('created_at:timestamp:default=now()')
    expect(col.default).toBe('now()')
  })

  test('references modifier', () => {
    const col = parseColumnSpec('user_id:integer:not-null:references=users.id')
    expect(col.references).toEqual({ table: 'users', column: 'id' })
    expect(col.nullable).toBe(false)
  })

  test('multiple modifiers', () => {
    const col = parseColumnSpec('email:varchar(100):not-null:unique')
    expect(col.nullable).toBe(false)
    expect(col.unique).toBe(true)
  })

  test('serial type implies auto-increment and not-null', () => {
    const col = parseColumnSpec('id:serial')
    expect(col.type).toBe('serial')
    expect(col.autoIncrement).toBe(true)
    expect(col.nullable).toBe(false)
  })

  test('bigserial type implies auto-increment', () => {
    const col = parseColumnSpec('id:bigserial:pk')
    expect(col.autoIncrement).toBe(true)
    expect(col.primaryKey).toBe(true)
  })

  test('serial with pk modifier', () => {
    const col = parseColumnSpec('id:serial:pk')
    expect(col.primaryKey).toBe(true)
    expect(col.autoIncrement).toBe(true)
    expect(col.nullable).toBe(false)
  })

  test('auto-increment modifier', () => {
    const col = parseColumnSpec('id:integer:auto-increment:pk')
    expect(col.autoIncrement).toBe(true)
    expect(col.primaryKey).toBe(true)
  })

  test('type with parentheses preserved', () => {
    const col = parseColumnSpec('price:decimal(10,2):not-null')
    expect(col.type).toBe('decimal(10,2)')
    expect(col.nullable).toBe(false)
  })

  test('throws on missing type', () => {
    expect(() => parseColumnSpec('name')).toThrow('Invalid column spec')
  })

  test('throws on empty string', () => {
    expect(() => parseColumnSpec('')).toThrow('Invalid column spec')
  })

  test('throws on unknown modifier', () => {
    expect(() => parseColumnSpec('id:integer:foobar')).toThrow('Unknown column modifier')
  })

  test('throws on invalid references format', () => {
    expect(() => parseColumnSpec('id:integer:references=users')).toThrow('expected "table.column"')
  })
})
