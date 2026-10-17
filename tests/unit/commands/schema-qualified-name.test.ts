import { expect, test } from 'bun:test'
import { parseSchemaObjectName } from '@/commands/schema-object-name'

test('qualified schema names respect native quotes and preserve the old exact-name path', () => {
  expect(parseSchemaObjectName('Audit.Orders', 'postgresql')).toEqual({
    name: 'orders',
    namespace: 'audit',
  })
  expect(parseSchemaObjectName('"Audit"."Order.Items"', 'postgresql')).toEqual({
    name: 'Order.Items',
    namespace: 'Audit',
  })
  expect(parseSchemaObjectName('"a""b"."x"', 'postgresql')).toEqual({ name: 'x', namespace: 'a"b' })
  expect(parseSchemaObjectName('`a``b`.`Order.Items`', 'mysql')).toEqual({
    name: 'Order.Items',
    namespace: 'a`b',
  })
  expect(parseSchemaObjectName('Audit.Orders', 'mariadb')).toEqual({
    name: 'Orders',
    namespace: 'Audit',
  })
  expect(parseSchemaObjectName('Users', 'postgresql')).toEqual({ name: 'Users' })
  expect(parseSchemaObjectName('we`ird', 'mysql')).toEqual({ name: 'we`ird' })
})

test('malformed qualified names never fall back to another object', () => {
  for (const input of [
    'a.',
    '.b',
    'a..b',
    'a.b.c',
    '"a.b',
    'a."b',
    'a.b"',
    'a. b c',
    '"".b',
    'a.`b`',
  ]) {
    expect(() => parseSchemaObjectName(input, 'postgresql')).toThrow()
  }
})

test('MySQL qualified unquoted identifiers keep native digit and dollar prefixes', () => {
  expect(parseSchemaObjectName('audit.123abc', 'mysql')).toEqual({
    namespace: 'audit',
    name: '123abc',
  })
  expect(parseSchemaObjectName('audit.$events', 'mariadb')).toEqual({
    namespace: 'audit',
    name: '$events',
  })
  expect(() => parseSchemaObjectName('audit.123', 'mysql')).toThrow()
})
