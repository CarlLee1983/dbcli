import { test, expect } from 'bun:test'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { resolveBulkInputs } from '@/core/explain/bulk-runner'

let tmp: string

function setup() {
  tmp = mkdtempSync(path.join(tmpdir(), 'explain-bulk-'))
}

function cleanup() {
  rmSync(tmp, { recursive: true, force: true })
}

test('resolveBulkInputs: raw SQL strings pass through with no label', async () => {
  const inputs = await resolveBulkInputs(['SELECT 1', 'SELECT * FROM users'], {
    loadFromSavedQueries: async () => null,
  })
  expect(inputs).toHaveLength(2)
  expect(inputs[0]?.sql).toBe('SELECT 1')
  expect(inputs[0]?.label).toBeUndefined()
})

test('resolveBulkInputs: @file path is read and split on statement semicolons', async () => {
  setup()
  const sqlFile = path.join(tmp, 'queries.sql')
  writeFileSync(
    sqlFile,
    `
-- analytics queries
SELECT * FROM orders WHERE id = 1;
-- next one
SELECT count(*) FROM users;
`
  )
  const inputs = await resolveBulkInputs([`@${sqlFile}`], {
    loadFromSavedQueries: async () => null,
  })
  expect(inputs).toHaveLength(2)
  expect(inputs[0]?.sql).toBe(
    '-- analytics queries\nSELECT * FROM orders WHERE id = 1'
  )
  expect(inputs[1]?.sql).toBe('-- next one\nSELECT count(*) FROM users')
  expect(inputs[0]?.label).toBe(`${path.basename(sqlFile)}#1`)
  cleanup()
})

test('resolveBulkInputs: scanner preserves quoted and commented semicolons', async () => {
  setup()
  const sqlFile = path.join(tmp, 'complex.sql')
  writeFileSync(
    sqlFile,
    [
      "SELECT 'single;quote''still', \"double;identifier\", `backtick;identifier` FROM users;",
      "SELECT 'backslash\\\\\\';still' FROM users /* block;comment */;",
      'SELECT $$dollar;body$$, $tag$tagged;body$tag$ FROM users;',
      '-- line;comment',
      'SELECT 4;',
      '/* trailing;comment only */',
    ].join('\n')
  )

  const inputs = await resolveBulkInputs([`@${sqlFile}`], {
    loadFromSavedQueries: async () => null,
  })

  expect(inputs).toHaveLength(4)
  expect(inputs[0]?.sql).toContain("'single;quote''still'")
  expect(inputs[0]?.sql).toContain('`backtick;identifier`')
  expect(inputs[1]?.sql).toContain('/* block;comment */')
  expect(inputs[2]?.sql).toContain('$$dollar;body$$')
  expect(inputs[2]?.sql).toContain('$tag$tagged;body$tag$')
  expect(inputs[3]?.sql).toBe('-- line;comment\nSELECT 4')
  cleanup()
})

test('resolveBulkInputs: @saved-query name expands to single entry', async () => {
  const inputs = await resolveBulkInputs(['@analytics/live-summary'], {
    loadFromSavedQueries: async (name) => {
      if (name === 'analytics/live-summary') {
        return [{ name: 'analytics/live-summary', sql: 'SELECT count(*) FROM live_sessions' }]
      }
      return null
    },
  })
  expect(inputs).toHaveLength(1)
  expect(inputs[0]?.sql).toBe('SELECT count(*) FROM live_sessions')
  expect(inputs[0]?.label).toBe('analytics/live-summary')
})

test('resolveBulkInputs: @glob expands to multiple saved queries', async () => {
  const inputs = await resolveBulkInputs(['@analytics/*'], {
    loadFromSavedQueries: async (pattern) => {
      if (pattern === 'analytics/*') {
        return [
          { name: 'analytics/a', sql: 'SELECT 1' },
          { name: 'analytics/b', sql: 'SELECT 2' },
        ]
      }
      return null
    },
  })
  expect(inputs).toHaveLength(2)
  expect(inputs.map((i) => i.label)).toEqual(['analytics/a', 'analytics/b'])
})

test('resolveBulkInputs: @name that is neither saved query nor file → throws', async () => {
  await expect(
    resolveBulkInputs(['@no-such-thing'], { loadFromSavedQueries: async () => null })
  ).rejects.toThrow(/no such .* saved query/i)
})
