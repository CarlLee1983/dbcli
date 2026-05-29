// tests/unit/core/guide/missing-index/sql-extractor.test.ts
import { test, expect } from 'bun:test'
import { parseSelect } from '@/core/guide/missing-index/parse-sql'
import { extract } from '@/core/guide/missing-index/sql-extractor'
import type { TableColumnUsage } from '@/core/guide/missing-index/types'

function usageFor(sql: string, table: string): TableColumnUsage {
  const ast = parseSelect(sql, 'mysql')
  const analysis = extract(ast)
  const u = analysis.tables.find((t) => t.table === table)
  if (!u) throw new Error(`no usage for ${table} in ${JSON.stringify(analysis.tables.map((x) => x.table))}`)
  return u
}

test('extracts equality and range WHERE columns with alias resolution', () => {
  const sql =
    'SELECT b.id FROM betting_logs b WHERE b.user_id = 5 AND b.settled_at >= "2024-01-01"'
  const u = usageFor(sql, 'betting_logs')
  expect(u.alias).toBe('b')
  expect(u.equalityColumns).toContain('user_id')
  expect(u.rangeColumns).toContain('settled_at')
})

test('extracts IN as equality', () => {
  const u = usageFor('SELECT id FROM betting_logs b WHERE b.status IN (1,2,3)', 'betting_logs')
  expect(u.equalityColumns).toContain('status')
})

test('extracts JOIN ON columns onto both tables', () => {
  const sql =
    'SELECT 1 FROM betting_logs b JOIN hoster_machines hm ON b.user_id = hm.user_id WHERE hm.hoster_space_id = 1'
  const b = usageFor(sql, 'betting_logs')
  const hm = usageFor(sql, 'hoster_machines')
  expect(b.joinColumns).toContain('user_id')
  expect(hm.joinColumns).toContain('user_id')
  expect(hm.equalityColumns).toContain('hoster_space_id')
})

test('extracts GROUP BY / ORDER BY columns', () => {
  const u = usageFor(
    'SELECT user_id FROM betting_logs b GROUP BY b.user_id ORDER BY b.created_at',
    'betting_logs'
  )
  expect(u.orderColumns).toEqual(expect.arrayContaining(['user_id', 'created_at']))
})

test('records functional columns separately (DATE(x))', () => {
  const u = usageFor(
    'SELECT 1 FROM betting_logs b GROUP BY DATE(b.settled_at)',
    'betting_logs'
  )
  expect(u.functionalColumns.map((f) => f.column)).toContain('settled_at')
  expect(u.functionalColumns[0].expr.toUpperCase()).toContain('DATE')
  // functional column must NOT also be counted as a plain order column
  expect(u.orderColumns).not.toContain('settled_at')
})

test('single-table query with no alias resolves bare column refs', () => {
  const u = usageFor('SELECT id FROM users WHERE email = "x"', 'users')
  expect(u.equalityColumns).toContain('email')
})
