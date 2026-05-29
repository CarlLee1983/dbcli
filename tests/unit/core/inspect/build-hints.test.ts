import { describe, test, expect } from 'bun:test'
import { buildHints } from '@/core/inspect/build-hints'
import type { SnapshotForSuggest } from '@/core/inspect/suggest-commands'

const base: SnapshotForSuggest = {
  schemaVersion: 1,
  system: 'postgresql',
  connection: { name: 'default', database: 'app', version: '16.4' },
  permission: { level: 'query-only', canWrite: false, canDestruct: false },
  blacklist: { tables: 0, columnRules: 0 },
  objects: { kind: 'tables', count: 0, sample: [] },
  schemaCache: { available: true, stale: false, lastRefreshed: '2026-05-01T00:00:00Z', totalTables: 115 },
  snippets: { count: 0, engines: [], intents: [] },
}

describe('buildHints', () => {
  test('top-table hint', () => {
    const h = buildHints(base, { topTable: 'betting_logs' })
    expect(h.some((s) => s.includes('betting_logs'))).toBe(true)
  })

  test('task-pack hint pluralizes and references tasks list', () => {
    expect(buildHints(base, { taskPackCount: 21 }).some((s) => s.includes('21 task packs'))).toBe(true)
    expect(buildHints(base, { taskPackCount: 1 }).some((s) => s.includes('1 task pack '))).toBe(true)
  })

  test('schema cache hint when available with totalTables', () => {
    const h = buildHints(base, {})
    expect(h.some((s) => s.includes('115 tables') && s.includes('2026-05-01T00:00:00Z'))).toBe(true)
  })

  test('no schema cache hint when unavailable', () => {
    const h = buildHints({ ...base, schemaCache: { available: false } }, {})
    expect(h.some((s) => s.startsWith('Schema cache:'))).toBe(false)
  })

  test('empty signals → empty hints', () => {
    const h = buildHints({ ...base, schemaCache: { available: false } }, {})
    expect(h).toEqual([])
  })
})
