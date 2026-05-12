import { describe, test, expect } from 'bun:test'
import { parseRecoveryEnvelope } from '@/core/recovery/envelope-schema'

describe('recoveryEnvelopeSchema verify field', () => {
  const baseEnvelope = {
    schemaVersion: 1 as const,
    generatedAt: '2026-05-10T11:30:00.000Z',
    ok: false as const,
    error: { code: 'BLACKLIST_TABLE', category: 'blacklist', message: 'x' },
    recovery: [],
  }

  test('parses without verify (back-compat with v1.16 envelopes)', () => {
    const r = parseRecoveryEnvelope(baseEnvelope)
    expect(r.ok).toBe(true)
    expect(r.value!.verify).toBeUndefined()
  })

  test('parses with a valid verify step', () => {
    const r = parseRecoveryEnvelope({
      ...baseEnvelope,
      verify: {
        order: 0,
        command: 'dbcli inspect --for-agent',
        rationale: 'Confirm permission/blacklist context after recovery.',
        risk: 'readonly',
        expects: 'JSON snapshot.',
      },
    })
    expect(r.ok).toBe(true)
    expect(r.value!.verify?.command).toBe('dbcli inspect --for-agent')
  })

  test('rejects malformed verify (extra unknown field)', () => {
    const r = parseRecoveryEnvelope({
      ...baseEnvelope,
      verify: {
        order: 0,
        command: 'dbcli inspect --for-agent',
        rationale: '',
        risk: 'readonly',
        expects: '',
        notARealField: true,
      },
    })
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('verify')
  })

  test('parses full strict envelope with stable top-level keys', () => {
    const r = parseRecoveryEnvelope({
      ...baseEnvelope,
      error: {
        code: 'CONFIG_MISSING',
        category: 'config',
        message: 'No config file found.',
        details: { table: 'users' },
      },
      recovery: [
        {
          order: 1,
          command: 'dbcli init',
          rationale: 'Create a local configuration file.',
          risk: 'unknown',
          expects: 'Interactive setup completes.',
          interactive: true,
        },
      ],
    })
    expect(r.ok).toBe(true)
    expect(Object.keys(r.value!).sort()).toEqual([
      'error',
      'generatedAt',
      'ok',
      'recovery',
      'schemaVersion',
    ])
  })

  test('rejects unsupported secret-like detail fields', () => {
    const r = parseRecoveryEnvelope({
      ...baseEnvelope,
      error: {
        code: 'CONFIG_MISSING',
        category: 'config',
        message: 'x',
        details: { password: 'secret' },
      },
    })
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('password')
  })
})
