// tests/core/repl/repl-engine-redis.test.ts
import { afterEach, beforeEach, test, expect } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ReplEngine } from '../../../src/core/repl/repl-engine'
import type { ReplContext } from '../../../src/core/repl/types'
import type { DatabaseAdapter } from '../../../src/adapters/types'

function stubAdapter(rows: Record<string, unknown>[]): DatabaseAdapter {
  return {
    connect: async () => {},
    disconnect: async () => {},
    listTables: async () => [],
    getTableSchema: async (n: string) => ({ name: n, columns: [] }),
    execute: async () => ({
      rows,
      affectedRows: rows.length,
      rowCount: rows.length,
      columnNames: Object.keys(rows[0] ?? {}),
    }),
    testConnection: async () => true,
    getServerVersion: async () => '7.4.0',
  } as unknown as DatabaseAdapter
}

let tempDirectory: string
let historyPath: string
let redisContext: ReplContext

beforeEach(async () => {
  tempDirectory = await mkdtemp(join(tmpdir(), 'dbcli-repl-redis-test-'))
  historyPath = join(tempDirectory, 'history')
  redisContext = {
    configPath: join(tempDirectory, '.dbcli'),
    permission: 'query-only',
    system: 'redis',
    tableNames: [],
    columnsByTable: {},
    commandNames: [],
  }
})

afterEach(async () => {
  await rm(tempDirectory, { recursive: true, force: true })
})

test('Redis: bare single-line GET executes (no semicolon)', async () => {
  const engine = new ReplEngine(stubAdapter([{ value: 'OK' }]), redisContext, historyPath, null)
  const result = await engine.processInput('GET mykey')
  expect(result.action).toBe('continue')
  expect(result.output).toContain('OK')
})

test('Redis: SCAN 0 executes (no semicolon)', async () => {
  const engine = new ReplEngine(
    stubAdapter([{ index: 0, value: 'k1' }]),
    redisContext,
    historyPath,
    null
  )
  const result = await engine.processInput('SCAN 0')
  expect(result.action).toBe('continue')
  expect(result.output).toContain('k1')
})

test('SQL: a non-keyword line without ; does NOT execute (regression guard)', async () => {
  const sqlContext: ReplContext = { ...redisContext, system: 'postgresql' }
  const engine = new ReplEngine(
    stubAdapter([{ value: 'should-not-run' }]),
    sqlContext,
    historyPath,
    null
  )
  // "foo bar" is not a SQL keyword and has no ; → must be treated as unknown command, not executed.
  const result = await engine.processInput('foo bar')
  expect(result.output ?? '').not.toContain('should-not-run')
})

test('SQL: incomplete statement without ; stays in multiline mode', async () => {
  const sqlContext: ReplContext = { ...redisContext, system: 'postgresql' }
  const engine = new ReplEngine(stubAdapter([]), sqlContext, historyPath, null)
  const result = await engine.processInput('SELECT * FROM users')
  expect(result.action).toBe('multiline')
})
