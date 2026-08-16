import { describe, test, expect } from 'bun:test'
import { renderMarkdown } from '@/core/report/render-markdown'
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
  hints: [],
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
          rowCount: 1,
          rows: [{ database: 'app', size: '100 MB' }],
          status: 'ok',
          durationMs: 12,
        },
      ],
    },
  ],
  warnings: [{ severity: 'info', message: 'mongodb has no built-in snippets' }],
  suggestedCommands: ['dbcli inspect --format json'],
}

describe('renderMarkdown (report)', () => {
  test('contains all required sections', () => {
    const md = renderMarkdown(SNAP)
    expect(md).toContain('# dbcli report')
    expect(md).toContain('## Context')
    expect(md).toContain('## capacity')
    expect(md).toContain('### `@diag/db-size`')
    expect(md).toContain('## Warnings')
    expect(md).toContain('## Suggested commands')
  })

  test('brief omits row tables', () => {
    const md = renderMarkdown(SNAP, { brief: true })
    expect(md).not.toContain('| database |')
    expect(md).toContain('rowCount: 1')
  })

  test('renders evidence row table when not brief', () => {
    const md = renderMarkdown(SNAP, { brief: false })
    expect(md).toMatch(/\| database \| size \|/)
    expect(md).toContain('| app | 100 MB |')
  })
})
