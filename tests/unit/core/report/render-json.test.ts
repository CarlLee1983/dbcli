import { describe, test, expect } from 'bun:test'
import { renderJson } from '@/core/report/render-json'
import type { ReportSnapshot } from '@/core/report/types'
import type { InspectSnapshot } from '@/core/inspect/types'

const CONTEXT: InspectSnapshot = {
  schemaVersion: 1,
  system: 'postgresql',
  connection: { name: 'default', database: 'app', version: '16.4' },
  permission: { level: 'query-only', canWrite: false, canDestruct: false },
  blacklist: { tables: 0, columnRules: 0 },
  objects: { kind: 'tables', count: 1, sample: ['users'] },
  schemaCache: { available: true, stale: false },
  snippets: { count: 5, engines: ['postgres'], intents: [] },
  suggestedCommands: ['dbcli list --format json'],
  warnings: [],
}

const SNAP: ReportSnapshot = {
  schemaVersion: 1,
  generatedAt: '2026-05-09T10:00:00.000Z',
  context: CONTEXT,
  sections: [
    {
      id: 'capacity',
      evidence: [
        {
          snippet: '@diag/db-size',
          intent: 'capacity.size',
          description: 'Database size',
          rowCount: 2,
          rows: [
            { database: 'app', size: '100 MB' },
            { database: 'log', size: '20 MB' },
          ],
          status: 'ok',
          durationMs: 12,
        },
      ],
    },
  ],
  warnings: [],
  suggestedCommands: ['dbcli inspect --format json'],
}

describe('renderJson (report)', () => {
  test('full mode emits stable shape with rows', () => {
    const j = JSON.parse(renderJson(SNAP, { brief: false }))
    expect(j.schemaVersion).toBe(1)
    expect(j.generatedAt).toBe('2026-05-09T10:00:00.000Z')
    expect(j.context.system).toBe('postgresql')
    expect(j.sections[0].evidence[0].rows.length).toBe(2)
  })

  test('brief drops evidence rows but keeps metadata', () => {
    const j = JSON.parse(renderJson(SNAP, { brief: true }))
    expect(j.sections[0].evidence[0].rows).toEqual([])
    expect(j.sections[0].evidence[0].rowCount).toBe(2)
    expect(j.sections[0].evidence[0].status).toBe('ok')
  })

  test('never contains host/password fields from context', () => {
    const out = renderJson(SNAP, { brief: false })
    expect(out).not.toContain('"host"')
    expect(out).not.toContain('"password"')
    expect(out).not.toContain('"port"')
  })
})
