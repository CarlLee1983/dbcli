import { describe, test, expect } from 'bun:test'
import { renderApplyJson } from '@/core/recovery/apply-render-json'
import type { ApplyResult } from '@/core/recovery'

const RESULT: ApplyResult = {
  schemaVersion: 1,
  startedAt: '2026-05-10T11:30:00.000Z',
  finishedAt: '2026-05-10T11:30:04.213Z',
  source: { kind: 'auto', path: '.dbcli/last-recovery.json' },
  envelope: {
    schemaVersion: 1,
    generatedAt: '2026-05-10T11:29:58.000Z',
    ok: false,
    error: { code: 'BLACKLIST_TABLE', category: 'blacklist', message: 'x' },
    recovery: [],
  },
  results: [
    {
      order: 1,
      command: 'dbcli inspect --for-agent',
      status: 'ok',
      exitCode: 0,
      durationMs: 312,
      stdout: '...',
      stderr: '',
      truncated: false,
    },
    {
      order: 2,
      command: 'dbcli init --force',
      status: 'skipped:interactive',
      reason: 'Step requires interactive TTY; rerun manually.',
    },
  ],
  finalStatus: 'ok',
  stoppedAt: null,
}

describe('renderApplyJson', () => {
  test('emits stable shape', () => {
    const out = renderApplyJson(RESULT)
    const parsed = JSON.parse(out)
    expect(parsed.schemaVersion).toBe(1)
    expect(parsed.finalStatus).toBe('ok')
    expect(parsed.source).toEqual({ kind: 'auto', path: '.dbcli/last-recovery.json' })
    expect(parsed.results).toHaveLength(2)
    expect(parsed.results[0].status).toBe('ok')
    expect(parsed.results[1].reason).toContain('interactive TTY')
  })

  test('drops undefined optional fields (no `"reason": null`)', () => {
    const out = renderApplyJson(RESULT)
    expect(out).not.toContain('"reason": null')
    expect(out).not.toContain('"exitCode": null')
  })

  test('keeps stoppedAt: null on success (explicit signal)', () => {
    const out = renderApplyJson(RESULT)
    expect(out).toContain('"stoppedAt": null')
  })
})
