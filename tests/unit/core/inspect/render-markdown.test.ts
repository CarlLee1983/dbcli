import { describe, test, expect } from 'bun:test'
import { renderMarkdown } from '@/core/inspect/render-markdown'
import type { InspectSnapshot } from '@/core/inspect/types'

const SNAP: InspectSnapshot = {
  schemaVersion: 1,
  system: 'postgresql',
  connection: { name: 'default', database: 'app', version: '16.4' },
  permission: { level: 'query-only', canWrite: false, canDestruct: false },
  blacklist: { tables: 1, columnRules: 3 },
  objects: { kind: 'tables', count: 2, sample: ['users', 'orders'] },
  schemaCache: {
    available: true,
    stale: false,
    lastRefreshed: '2026-05-01T00:00:00Z',
    totalTables: 2,
  },
  snippets: {
    count: 5,
    engines: ['postgres'],
    intents: [{ intent: 'perf.slow-query', count: 2 }],
  },
  suggestedCommands: ['dbcli list --format json'],
  warnings: [],
}

describe('renderMarkdown', () => {
  test('full mode renders all sections and the suggested commands list', () => {
    const md = renderMarkdown(SNAP, { brief: false })
    expect(md).toContain('# dbcli inspect')
    expect(md).toContain('## Connection')
    expect(md).toContain('## Permission')
    expect(md).toContain('## Suggested commands')
    expect(md).toContain('dbcli list --format json')
  })

  test('brief omits sample and intent details', () => {
    const md = renderMarkdown(SNAP, { brief: true })
    expect(md).not.toContain('users, orders')
  })

  test('warnings appear after Suggested commands', () => {
    const md = renderMarkdown({ ...SNAP, warnings: ['boom'] }, { brief: false })
    const idxWarn = md.indexOf('## Warnings')
    const idxSugg = md.indexOf('## Suggested commands')
    expect(idxWarn).toBeGreaterThan(-1)
    expect(idxWarn).toBeGreaterThan(idxSugg)
  })
})
