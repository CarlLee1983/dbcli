// tests/core/repl/completer.test.ts
import { describe, test, expect } from 'bun:test'
import { createCompleter } from '../../../src/core/repl/completer'
import type { ReplContext } from '../../../src/core/repl/types'
import { buildProgram } from '../../../src/program'
import {
  buildCompletionTree,
  listTopLevelCommandNames,
} from '../../../src/core/completion/command-tree'
import { deriveReplCommandNames } from '../../../src/core/repl/command-registry'

const commandNames = deriveReplCommandNames(
  listTopLevelCommandNames(buildCompletionTree(buildProgram()))
)

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
  commandNames,
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

  describe('redis completion', () => {
    const redisCtx: ReplContext = {
      ...ctx,
      system: 'redis',
      tableNames: ['user:1', 'user:2'],
      columnsByTable: {},
    }
    const completeRedis = createCompleter(redisCtx)

    test('suggests GET when partial input is "GE"', () => {
      const [hits] = completeRedis('GE')
      expect(hits).toContain('GET')
    })

    test('suggests key prefixes for the second token', () => {
      const [hits] = completeRedis('GET user:')
      expect(hits).toContain('user:1')
      expect(hits).toContain('user:2')
    })

    test('still completes meta commands in redis mode', () => {
      const [hits] = completeRedis('.no')
      expect(hits).toContain('.no-limit ')
    })
  })
})
