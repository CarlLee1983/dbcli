import { describe, test, expect } from 'bun:test'
import { renderMarkdown, renderGoalList } from '@/core/guide/render-markdown'
import type { GuideSnapshot } from '@/core/guide/types'
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

const SNAP: GuideSnapshot = {
  schemaVersion: 1,
  generatedAt: '2026-05-09T10:00:00.000Z',
  goal: 'slow-query',
  context: CONTEXT,
  steps: [
    {
      order: 1,
      command: 'dbcli inspect --for-agent',
      rationale: 'Anchor the agent in the current context.',
      risk: 'readonly',
      expects: 'JSON snapshot.',
    },
    {
      order: 2,
      command: 'dbcli q @diag/long-running --format json',
      rationale: 'List queries running longer than threshold.',
      risk: 'readonly',
      expects: 'Rows with pid, duration, query.',
      snippet: '@diag/long-running',
      intent: 'perf.slow-query',
    },
  ],
  warnings: [{ severity: 'info', message: 'cache-first mode (no probe)' }],
}

describe('renderMarkdown (guide)', () => {
  test('contains all required sections', () => {
    const md = renderMarkdown(SNAP)
    expect(md).toContain('# dbcli guide: slow-query')
    expect(md).toContain('## Context')
    expect(md).toContain('## Plan')
    expect(md).toContain('1. `dbcli inspect --for-agent`')
    expect(md).toContain('2. `dbcli q @diag/long-running --format json`')
    expect(md).toContain('## Warnings')
  })

  test('brief omits rationale and expects', () => {
    const md = renderMarkdown(SNAP, { brief: true })
    expect(md).not.toContain('Anchor the agent')
    expect(md).not.toContain('Rows with pid')
    expect(md).toContain('1. `dbcli inspect --for-agent`')
  })

  test('renders snippet/intent metadata when present', () => {
    const md = renderMarkdown(SNAP, { brief: false })
    expect(md).toContain('snippet: `@diag/long-running`')
    expect(md).toContain('intent: `perf.slow-query`')
  })
})

describe('renderGoalList', () => {
  test('renders all six goals with descriptions', () => {
    const md = renderGoalList()
    expect(md).toContain('# dbcli guide goals')
    expect(md).toContain('- `slow-query`')
    expect(md).toContain('- `capacity`')
    expect(md).toContain('- `health`')
    expect(md).toContain('- `index-usage`')
    expect(md).toContain('- `permissions`')
    expect(md).toContain('- `schema-overview`')
  })
})
