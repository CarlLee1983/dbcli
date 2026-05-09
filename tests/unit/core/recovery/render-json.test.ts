import { describe, test, expect } from 'bun:test'
import { renderJson } from '@/core/recovery/render-json'
import type { RecoveryEnvelope } from '@/core/recovery/types'

const ENV: RecoveryEnvelope = {
  schemaVersion: 1,
  generatedAt: '2026-05-09T10:00:00.000Z',
  ok: false,
  error: {
    code: 'CONN_REFUSED',
    category: 'connection',
    message: 'Database refused the connection (server down or wrong host/port).',
    details: { connectionCode: 'ECONNREFUSED' },
  },
  recovery: [
    {
      order: 1,
      command: 'dbcli doctor --format json',
      rationale: 'Run the doctor health check to identify config / network / driver issues.',
      risk: 'readonly',
      expects: 'JSON report listing config validation, env presence, connection reachability.',
    },
    {
      order: 2,
      command: 'dbcli inspect --no-connect --format json',
      rationale: 'Re-read the cached connection summary without a live probe.',
      risk: 'readonly',
      expects: 'JSON snapshot with connection.name and connection.database (no creds).',
    },
  ],
}

describe('renderJson (recovery)', () => {
  test('full mode emits stable shape with rationale and expects', () => {
    const j = JSON.parse(renderJson(ENV, { brief: false }))
    expect(j.schemaVersion).toBe(1)
    expect(j.ok).toBe(false)
    expect(j.error.code).toBe('CONN_REFUSED')
    expect(j.error.category).toBe('connection')
    expect(j.error.details.connectionCode).toBe('ECONNREFUSED')
    expect(j.recovery[0].rationale).toContain('doctor')
    expect(j.recovery[0].risk).toBe('readonly')
    expect(j.generatedAt).toBe('2026-05-09T10:00:00.000Z')
  })

  test('brief drops rationale and expects but keeps command/risk/order', () => {
    const j = JSON.parse(renderJson(ENV, { brief: true }))
    for (const step of j.recovery as Array<Record<string, unknown>>) {
      expect(step.rationale).toBeUndefined()
      expect(step.expects).toBeUndefined()
      expect(typeof step.command).toBe('string')
      expect(typeof step.risk).toBe('string')
      expect(typeof step.order).toBe('number')
    }
  })

  test('never contains host / port / password literals from a synthetic envelope', () => {
    const out = renderJson(ENV, { brief: false })
    expect(out).not.toContain('"host"')
    expect(out).not.toContain('"port"')
    expect(out).not.toContain('"password"')
    expect(out).not.toContain('localhost')
    expect(out).not.toContain('5432')
  })
})
