import { describe, test, expect } from 'bun:test'
import { renderJson } from '@/core/inspect/render-json'
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

describe('renderJson', () => {
  test('full mode emits stable shape', () => {
    const parsed = JSON.parse(renderJson(SNAP, { brief: false }))
    expect(parsed.schemaVersion).toBe(1)
    expect(parsed.connection.database).toBe('app')
    expect(parsed.objects.sample).toEqual(['users', 'orders'])
    expect(parsed.snippets.intents).toHaveLength(1)
  })

  test('brief drops sample + intents and trims commands', () => {
    const parsed = JSON.parse(
      renderJson({ ...SNAP, suggestedCommands: ['a', 'b', 'c', 'd', 'e', 'f'] }, { brief: true })
    )
    expect(parsed.objects.sample).toBeUndefined()
    expect(parsed.snippets.intents).toEqual([])
    expect(parsed.suggestedCommands.length).toBeLessThanOrEqual(3)
  })

  test('redacts: never contains host/password fields', () => {
    const json = renderJson(SNAP, { brief: false })
    expect(json).not.toContain('"host"')
    expect(json).not.toContain('"password"')
    expect(json).not.toContain('"user"')
  })
})
