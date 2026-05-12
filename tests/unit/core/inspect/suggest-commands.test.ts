import { describe, test, expect } from 'bun:test'
import { suggestCommands } from '@/core/inspect/suggest-commands'
import type { InspectSnapshot } from '@/core/inspect/types'

const baseSnap: Omit<InspectSnapshot, 'suggestedCommands' | 'warnings'> = {
  schemaVersion: 1,
  system: 'postgresql',
  connection: { name: 'default', database: 'app', version: null },
  permission: { level: 'query-only', canWrite: false, canDestruct: false },
  blacklist: { tables: 0, columnRules: 0 },
  objects: { kind: 'tables', count: 0, sample: [] },
  schemaCache: { available: true, stale: false },
  snippets: { count: 0, engines: [], intents: [] },
}

describe('suggestCommands', () => {
  test('no config → just init', () => {
    const cmds = suggestCommands({ ...baseSnap, system: null })
    expect(cmds).toEqual(['dbcli init'])
  })

  test('stale schema cache → schema refresh appears before list', () => {
    const cmds = suggestCommands({
      ...baseSnap,
      schemaCache: { available: true, stale: true },
    })
    const sIdx = cmds.findIndex((c) => c.startsWith('dbcli schema'))
    const lIdx = cmds.indexOf('dbcli list --format json')
    expect(sIdx).toBeGreaterThanOrEqual(0)
    expect(sIdx).toBeLessThan(lIdx)
  })

  test('top intent surfaces queries suggest', () => {
    const cmds = suggestCommands({
      ...baseSnap,
      snippets: {
        count: 5,
        engines: ['postgres'],
        intents: [{ intent: 'perf.slow-query', count: 3 }],
      },
    })
    expect(cmds).toContain('dbcli queries suggest perf --format json')
  })

  test('brief mode returns exactly one safest next command', () => {
    const cmds = suggestCommands(
      {
        ...baseSnap,
        schemaCache: { available: false },
        snippets: {
          count: 5,
          engines: ['postgres'],
          intents: [{ intent: 'perf.slow-query', count: 3 }],
        },
      },
      { brief: true }
    )
    expect(cmds).toEqual(['dbcli schema --refresh'])
  })
})
