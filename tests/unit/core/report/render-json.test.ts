import { describe, test, expect } from 'bun:test'
import { renderJson } from '@/core/report/render-json'
import type { ReportSnapshot } from '@/core/report/types'
import type { InspectSnapshot } from '@/core/inspect/types'
import {
  expectNoCredentialFieldNames,
  expectNoSensitiveFragments,
} from '../../../helpers/sensitive-output'

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

  test('full mode keeps required top-level and evidence keys stable', () => {
    const parsed = JSON.parse(renderJson(SNAP, { brief: false }))
    expect(Object.keys(parsed).sort()).toEqual([
      'context',
      'generatedAt',
      'schemaVersion',
      'sections',
      'suggestedCommands',
      'warnings',
    ])
    expect(Object.keys(parsed.sections[0]).sort()).toEqual(['evidence', 'id'])
    expect(Object.keys(parsed.sections[0].evidence[0]).sort()).toEqual([
      'description',
      'durationMs',
      'intent',
      'rowCount',
      'rows',
      'snippet',
      'status',
    ])
  })

  test('never contains host/password fields from context', () => {
    const out = renderJson(SNAP, { brief: false })
    expectNoCredentialFieldNames(out)
    expectNoSensitiveFragments(out)
  })
})
