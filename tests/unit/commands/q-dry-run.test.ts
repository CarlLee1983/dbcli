import { describe, test, expect } from 'bun:test'
import { formatDryRun } from '@/commands/q'

describe('formatDryRun', () => {
  test('sql: prints SQL and bind values', () => {
    const out = formatDryRun({
      family: 'sql',
      driverSql: 'SELECT * FROM t',
      values: [42],
      execHints: undefined,
    })
    expect(out).toContain('SELECT * FROM t')
    expect(out).toContain('Bind values:')
    expect(out).toContain('[42]')
  })

  test('es: prints pretty JSON and index', () => {
    const out = formatDryRun({
      family: 'es',
      driverSql: '{"query":{"match_all":{}},"size":10}',
      values: [],
      execHints: { index: 'events-*' },
    })
    expect(out).toContain('Index: events-*')
    expect(out).toMatch(/\{\n\s+"query"/)
  })

  test('redis: prints command string', () => {
    const out = formatDryRun({
      family: 'redis',
      driverSql: 'HGETALL user:42',
      values: [],
      execHints: undefined,
    })
    expect(out).toContain('HGETALL user:42')
  })
})
