// tests/unit/core/guide/missing-index/parse-sql.test.ts
import { test, expect } from 'bun:test'
import { parseSelect, ParseFailure } from '@/core/guide/missing-index/parse-sql'

test('parses a single SELECT into an AST object', () => {
  const ast = parseSelect('SELECT a FROM t WHERE a = 1', 'mysql') as { type: string }
  expect(ast.type).toBe('select')
})

test('maps mariadb and postgresql dialects', () => {
  expect((parseSelect('SELECT 1', 'mariadb') as { type: string }).type).toBe('select')
  expect((parseSelect('SELECT 1', 'postgresql') as { type: string }).type).toBe('select')
})

test('throws ParseFailure on garbage SQL', () => {
  expect(() => parseSelect('NOT SQL AT ALL ;;;', 'mysql')).toThrow(ParseFailure)
})

test('throws ParseFailure on non-SELECT (UPDATE)', () => {
  expect(() => parseSelect('UPDATE t SET a = 1', 'mysql')).toThrow(ParseFailure)
})

test('throws ParseFailure when astify returns multiple statements', () => {
  expect(() => parseSelect('SELECT 1; SELECT 2', 'mysql')).toThrow(ParseFailure)
})
