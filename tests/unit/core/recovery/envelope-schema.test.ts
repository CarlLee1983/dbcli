import { describe, test, expect } from 'bun:test'
import { parseRecoveryEnvelope, parseSavedRecoveryEnvelope } from '@/core/recovery/envelope-schema'

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

describe('SavedRecoveryEnvelope id + audit_ref (Phase 25)', () => {
  const validEnvelope = {
    schemaVersion: 1 as const,
    generatedAt: '2026-05-15T10:42:18.000Z',
    ok: false as const,
    error: { code: 'BLACKLIST_TABLE', category: 'blacklist', message: 'blocked' },
    recovery: [],
  }

  test('accepts envelope with id + audit_ref (new shape)', () => {
    const payload = {
      schemaVersion: 1,
      id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
      audit_ref: '8b3c8f0c-1234-4abc-9def-0123456789ab',
      savedAt: '2026-05-15T10:42:18Z',
      command: 'dbcli query',
      cwd: '/tmp/x',
      envelope: validEnvelope,
    }
    const r = parseSavedRecoveryEnvelope(payload)
    expect(r.ok).toBe(true)
    expect(r.value?.id).toBe('f47ac10b-58cc-4372-a567-0e02b2c3d479')
    expect(r.value?.audit_ref).toBe('8b3c8f0c-1234-4abc-9def-0123456789ab')
  })

  test('accepts legacy envelope WITHOUT id and audit_ref (D-54 backward compat)', () => {
    const payload = {
      schemaVersion: 1,
      savedAt: '2026-05-15T10:42:18Z',
      command: 'dbcli query',
      cwd: '/tmp/x',
      envelope: validEnvelope,
    }
    const r = parseSavedRecoveryEnvelope(payload)
    expect(r.ok).toBe(true)
    expect(r.value?.id).toBeUndefined()
    expect(r.value?.audit_ref).toBeUndefined()
  })

  test('rejects payload with unknown extra key (.strict() preserved)', () => {
    const payload = {
      schemaVersion: 1,
      savedAt: '2026-05-15T10:42:18Z',
      command: 'dbcli query',
      cwd: '/tmp/x',
      envelope: validEnvelope,
      unknownField: 'bad',
    }
    const r = parseSavedRecoveryEnvelope(payload)
    expect(r.ok).toBe(false)
  })

  test('rejects payload where id is not a string', () => {
    const payload = {
      schemaVersion: 1,
      id: 42,
      savedAt: '2026-05-15T10:42:18Z',
      command: 'dbcli query',
      cwd: '/tmp/x',
      envelope: validEnvelope,
    }
    const r = parseSavedRecoveryEnvelope(payload)
    expect(r.ok).toBe(false)
  })
})

describe('recoveryEnvelopeSchema branches/branchFork', () => {
  const baseEnvelope = {
    schemaVersion: 1 as const,
    generatedAt: '2026-05-18T00:00:00.000Z',
    ok: false as const,
    error: { code: 'CONN_REFUSED', category: 'connection', message: 'x' },
    recovery: [
      {
        order: 1,
        command: 'dbcli doctor --format json',
        rationale: 'r',
        risk: 'readonly',
        expects: 'e',
      },
    ],
  }
  const validBranches = {
    'doctor-clean': {
      description: 'd',
      steps: [
        {
          order: 1,
          command: 'dbcli inspect --for-agent',
          rationale: 'r',
          risk: 'readonly',
          expects: 'e',
          branchId: 'doctor-clean',
        },
      ],
    },
  }

  test('parses envelope without branches/branchFork (back-compat)', () => {
    const r = parseRecoveryEnvelope(baseEnvelope)
    expect(r.ok).toBe(true)
    expect(r.value!.branches).toBeUndefined()
    expect(r.value!.branchFork).toBeUndefined()
  })

  test('parses envelope with valid branches + branchFork', () => {
    const r = parseRecoveryEnvelope({
      ...baseEnvelope,
      branches: validBranches,
      branchFork: { after: 1, branchIds: ['doctor-clean'] },
    })
    expect(r.ok).toBe(true)
    expect(r.value!.branches!['doctor-clean']!.steps[0]!.branchId).toBe('doctor-clean')
  })

  test('rejects branch id with uppercase or special chars', () => {
    const r = parseRecoveryEnvelope({
      ...baseEnvelope,
      branches: { 'BadID!': validBranches['doctor-clean'] },
      branchFork: { after: 1, branchIds: ['BadID!'] },
    })
    expect(r.ok).toBe(false)
  })

  test('rejects branchIds not equal to Object.keys(branches)', () => {
    const r = parseRecoveryEnvelope({
      ...baseEnvelope,
      branches: validBranches,
      branchFork: { after: 1, branchIds: ['doctor-clean', 'doctor-auth-error'] },
    })
    expect(r.ok).toBe(false)
  })

  test('rejects branches map with > MAX_BRANCH_COUNT entries', () => {
    const big: Record<string, (typeof validBranches)['doctor-clean']> = {}
    for (let i = 0; i < 9; i++) big[`b-${i}`] = validBranches['doctor-clean']
    const r = parseRecoveryEnvelope({
      ...baseEnvelope,
      branches: big,
      branchFork: { after: 1, branchIds: Object.keys(big) },
    })
    expect(r.ok).toBe(false)
  })

  test('rejects a branch with > MAX_BRANCH_STEPS steps', () => {
    const tooLong = Array.from({ length: 7 }, (_, i) => ({
      order: i + 1,
      command: `dbcli x${i}`,
      rationale: 'r',
      risk: 'readonly',
      expects: 'e',
      branchId: 'doctor-clean',
    }))
    const r = parseRecoveryEnvelope({
      ...baseEnvelope,
      branches: { 'doctor-clean': { description: 'd', steps: tooLong } },
      branchFork: { after: 1, branchIds: ['doctor-clean'] },
    })
    expect(r.ok).toBe(false)
  })

  test('rejects empty branch.steps', () => {
    const r = parseRecoveryEnvelope({
      ...baseEnvelope,
      branches: { 'doctor-clean': { description: 'd', steps: [] } },
      branchFork: { after: 1, branchIds: ['doctor-clean'] },
    })
    expect(r.ok).toBe(false)
  })

  test('rejects step branchId mismatching enclosing key', () => {
    const r = parseRecoveryEnvelope({
      ...baseEnvelope,
      branches: {
        'doctor-clean': {
          description: 'd',
          steps: [
            {
              order: 1,
              command: 'dbcli x',
              rationale: 'r',
              risk: 'readonly',
              expects: 'e',
              branchId: 'doctor-auth-error',
            },
          ],
        },
      },
      branchFork: { after: 1, branchIds: ['doctor-clean'] },
    })
    expect(r.ok).toBe(false)
  })

  test('schemaVersion stays at 1', () => {
    const r = parseRecoveryEnvelope({
      ...baseEnvelope,
      branches: validBranches,
      branchFork: { after: 1, branchIds: ['doctor-clean'] },
    })
    expect(r.ok).toBe(true)
    expect(r.value!.schemaVersion).toBe(1)
  })
})
