// tests/core/repl/completer.test.ts
import { describe, test, expect } from 'bun:test'
import { createCompleter } from '../../../src/core/repl/completer'
import type { ReplContext } from '../../../src/core/repl/types'

const ctx: ReplContext = {
  configPath: '.dbcli',
  permission: 'admin',
  system: 'postgresql',
  tableNames: ['users', 'orders', 'products'],
  columnsByTable: {
    users: ['id', 'name', 'email', 'created_at'],
    orders: ['id', 'user_id', 'total', 'status'],
    products: ['id', 'title', 'price'],
  },
}

describe('createCompleter', () => {
  const complete = createCompleter(ctx)

  describe('SQL keyword completion', () => {
    test('completes SEL to SELECT', () => {
      const [hits] = complete('SEL')
      expect(hits).toContain('SELECT ')
    })

    test('completes sel (lowercase) to SELECT', () => {
      const [hits] = complete('sel')
      expect(hits).toContain('SELECT ')
    })

    test('completes FR to FROM', () => {
      const [hits] = complete('SELECT * FR')
      expect(hits).toContain('FROM ')
    })

    test('completes WH to WHERE', () => {
      const [hits] = complete('SELECT * FROM users WH')
      expect(hits).toContain('WHERE ')
    })
  })

  describe('table name completion after FROM', () => {
    test('completes table after FROM', () => {
      const [hits] = complete('SELECT * FROM u')
      expect(hits).toContain('users ')
    })

    test('completes table after JOIN', () => {
      const [hits] = complete('SELECT * FROM users JOIN o')
      expect(hits).toContain('orders ')
    })

    test('lists all tables for empty prefix after FROM', () => {
      const [hits] = complete('SELECT * FROM ')
      expect(hits).toContain('users ')
      expect(hits).toContain('orders ')
      expect(hits).toContain('products ')
    })
  })

  describe('column name completion', () => {
    test('completes column after SELECT with known FROM', () => {
      const [hits] = complete('SELECT n')
      // Without FROM context, should still try to match across all tables
      expect(hits).toContain('name ')
    })

    test('completes column in WHERE clause', () => {
      const [hits] = complete('SELECT * FROM users WHERE em')
      expect(hits).toContain('email ')
    })
  })

  describe('dbcli command completion', () => {
    test('completes sch to schema at line start', () => {
      const [hits] = complete('sch')
      expect(hits).toContain('schema ')
    })

    test('completes li to list at line start', () => {
      const [hits] = complete('li')
      expect(hits).toContain('list ')
    })

    test('completes table name after schema command', () => {
      const [hits] = complete('schema u')
      expect(hits).toContain('users ')
    })

    test('completes table name after blacklist column add', () => {
      const [hits] = complete('blacklist column add u')
      expect(hits).toContain('users ')
    })
  })

  describe('meta command completion', () => {
    test('completes . to meta commands', () => {
      const [hits] = complete('.')
      expect(hits).toContain('.help ')
      expect(hits).toContain('.quit ')
      expect(hits).toContain('.format ')
    })

    test('completes .f to .format', () => {
      const [hits] = complete('.f')
      expect(hits).toContain('.format ')
    })
  })

  describe('edge cases', () => {
    test('returns candidates for empty input', () => {
      const [hits] = complete('')
      expect(hits.length).toBeGreaterThan(0)
    })

    test('returns empty when no match', () => {
      const [hits] = complete('zzzzz')
      expect(hits).toEqual([])
    })
  })
})
