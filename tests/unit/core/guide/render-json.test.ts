import { describe, test, expect } from 'bun:test'
import { renderJson } from '@/core/guide/render-json'
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
      rationale: 'Capture the current connection context.',
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
  warnings: [],
}

describe('renderJson (guide)', () => {
  test('full mode emits stable shape with rationale and expects', () => {
    const j = JSON.parse(renderJson(SNAP, { brief: false }))
    expect(j.schemaVersion).toBe(1)
    expect(j.goal).toBe('slow-query')
    expect(j.generatedAt).toBe('2026-05-09T10:00:00.000Z')
    expect(j.context.system).toBe('postgresql')
    expect(j.steps[1].rationale).toContain('threshold')
    expect(j.steps[1].snippet).toBe('@diag/long-running')
  })

  test('brief drops rationale and expects but keeps command/risk/order/snippet', () => {
    const j = JSON.parse(renderJson(SNAP, { brief: true }))
    expect(j.steps[0].rationale).toBeUndefined()
    expect(j.steps[0].expects).toBeUndefined()
    expect(j.steps[0].command).toBe('dbcli inspect --for-agent')
    expect(j.steps[0].risk).toBe('readonly')
    expect(j.steps[0].order).toBe(1)
    expect(j.steps[1].snippet).toBe('@diag/long-running')
    expect(j.steps[1].intent).toBe('perf.slow-query')
  })

  test('never contains host/password fields from context', () => {
    const out = renderJson(SNAP, { brief: false })
    expect(out).not.toContain('"host"')
    expect(out).not.toContain('"password"')
    expect(out).not.toContain('"port"')
  })
})
