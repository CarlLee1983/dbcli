import { describe, test, expect } from 'bun:test'
import { shellQuote } from '@/core/recovery/shell-quote'

describe('shellQuote', () => {
  test('empty string yields two single quotes', () => {
    expect(shellQuote('')).toBe("''")
  })

  test('safe identifiers pass through untouched', () => {
    expect(shellQuote('staging')).toBe('staging')
    expect(shellQuote('orders_v2')).toBe('orders_v2')
    expect(shellQuote('a-b.c+1')).toBe('a-b.c+1')
  })

  test('strings with spaces are wrapped in single quotes', () => {
    expect(shellQuote('my prod db')).toBe("'my prod db'")
  })

  test('strings with embedded single quotes are escaped', () => {
    expect(shellQuote("o'reilly")).toBe(`'o'\\''reilly'`)
  })

  test('shell metacharacters cannot escape the quotes', () => {
    expect(shellQuote('$(rm -rf /)')).toBe(`'$(rm -rf /)'`)
    expect(shellQuote('foo;bar')).toBe(`'foo;bar'`)
  })
})
