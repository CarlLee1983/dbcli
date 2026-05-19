import { describe, test, expect } from 'bun:test'
import { nextStepFromEnvelope } from '@/core/recovery/next-step'
import type { RecoveryEnvelope } from '@/core/recovery/types'
import type { StepResultSummary } from '@/core/recovery/next-types'

const okResult: StepResultSummary = { status: 'ok', exitCode: 0 }

function envelope(stepCount: number): RecoveryEnvelope {
  return {
    schemaVersion: 1,
    generatedAt: '2026-05-10T11:30:00.000Z',
    ok: false,
    error: { code: 'BLACKLIST_TABLE', category: 'blacklist', message: 'x' },
    recovery: Array.from({ length: stepCount }, (_, i) => ({
      order: i + 1,
      command: `dbcli step-${i + 1}`,
      rationale: `r${i + 1}`,
      risk: 'readonly' as const,
      expects: `e${i + 1}`,
    })),
  }
}

describe('nextStepFromEnvelope — linear walk', () => {
  test('after step 1 of 3 → returns step 2', () => {
    const out = nextStepFromEnvelope(envelope(3), 1, okResult)
    expect(out.kind).toBe('step')
    if (out.kind === 'step') {
      expect(out.step.order).toBe(2)
      expect(out.step.command).toBe('dbcli step-2')
    }
  })

  test('after step 2 of 3 → returns step 3', () => {
    const out = nextStepFromEnvelope(envelope(3), 2, okResult)
    expect(out.kind).toBe('step')
    if (out.kind === 'step') expect(out.step.order).toBe(3)
  })

  test('after the last step → done', () => {
    const out = nextStepFromEnvelope(envelope(3), 3, okResult)
    expect(out.kind).toBe('done')
  })

  test('after the only step in a one-step plan → done', () => {
    const out = nextStepFromEnvelope(envelope(1), 1, okResult)
    expect(out.kind).toBe('done')
  })
})

describe('nextStepFromEnvelope — boundary errors', () => {
  test('afterStep < 1 throws RangeError', () => {
    expect(() => nextStepFromEnvelope(envelope(3), 0, okResult)).toThrow(RangeError)
    expect(() => nextStepFromEnvelope(envelope(3), -1, okResult)).toThrow(RangeError)
  })

  test('afterStep > recovery.length throws RangeError', () => {
    expect(() => nextStepFromEnvelope(envelope(3), 4, okResult)).toThrow(RangeError)
  })

  test('non-integer afterStep throws RangeError', () => {
    expect(() => nextStepFromEnvelope(envelope(3), 1.5, okResult)).toThrow(RangeError)
  })

  test('empty recovery plan with afterStep 1 throws RangeError', () => {
    expect(() => nextStepFromEnvelope(envelope(0), 1, okResult)).toThrow(RangeError)
  })
})

describe('nextStepFromEnvelope — determinism', () => {
  test('same input twice returns same step (no hidden state)', () => {
    const env = envelope(5)
    const a = nextStepFromEnvelope(env, 2, okResult)
    const b = nextStepFromEnvelope(env, 2, okResult)
    expect(a).toEqual(b)
  })

  test('result content does not affect linear walk', () => {
    const env = envelope(3)
    const a = nextStepFromEnvelope(env, 1, { status: 'ok' })
    const b = nextStepFromEnvelope(env, 1, {
      status: 'failed',
      stdoutSummary: 'host unreachable',
    })
    expect(a).toEqual(b)
  })
})

import { buildConnectionBranches } from '@/core/recovery/connection-branches'

function envelopeWithBranches(): RecoveryEnvelope {
  const { branches, branchFork } = buildConnectionBranches({ operation: 'query' })
  return {
    schemaVersion: 1,
    generatedAt: '2026-05-18T00:00:00.000Z',
    ok: false,
    error: { code: 'CONN_REFUSED', category: 'connection', message: 'x' },
    recovery: [
      {
        order: 1,
        command: 'dbcli doctor --format json',
        rationale: 'r',
        risk: 'readonly',
        expects: 'e',
      },
      {
        order: 2,
        command: 'dbcli inspect --no-connect --format json',
        rationale: 'r',
        risk: 'readonly',
        expects: 'e',
      },
    ],
    branches,
    branchFork,
  }
}

function doctorResult(
  hint: 'clean' | 'config-missing' | 'auth' | 'network' | 'unmatched'
): StepResultSummary {
  const msgByHint = {
    clean: {
      hasError: false,
      results: [{ group: 'g', label: 'Connection', status: 'pass', message: 'ok' }],
    },
    'config-missing': {
      hasError: true,
      results: [{ group: 'g', label: 'Config exists', status: 'error', message: 'no config' }],
    },
    auth: {
      hasError: true,
      results: [
        {
          group: 'g',
          label: 'Connection',
          status: 'error',
          message: 'password authentication failed',
        },
      ],
    },
    network: {
      hasError: true,
      results: [
        { group: 'g', label: 'Connection', status: 'error', message: 'ECONNREFUSED 127.0.0.1' },
      ],
    },
    unmatched: {
      hasError: true,
      results: [{ group: 'g', label: 'Connection', status: 'error', message: 'something else' }],
    },
  }
  return { status: 'ok', stdoutSummary: JSON.stringify(msgByHint[hint]) }
}

describe('nextStepFromEnvelope — fork at branchFork.after', () => {
  test('after step 1 with doctor-clean JSON → step 1 of doctor-clean branch', () => {
    const env = envelopeWithBranches()
    const out = nextStepFromEnvelope(env, 1, doctorResult('clean'))
    expect(out.kind).toBe('step')
    if (out.kind === 'step') {
      expect(out.branchId).toBe('doctor-clean')
      expect(out.cursor).toBe(1)
      expect(out.totalSteps).toBe(env.branches!['doctor-clean']!.steps.length)
      expect(out.step.command).toBe('dbcli inspect --for-agent')
    }
  })

  test('after step 1 with auth JSON → doctor-auth-error step 1 (init --force)', () => {
    const out = nextStepFromEnvelope(envelopeWithBranches(), 1, doctorResult('auth'))
    if (out.kind !== 'step') throw new Error('expected step')
    expect(out.branchId).toBe('doctor-auth-error')
    expect(out.step.command).toBe('dbcli init --force')
  })

  test('after step 1 with network JSON → doctor-network-error step 1', () => {
    const out = nextStepFromEnvelope(envelopeWithBranches(), 1, doctorResult('network'))
    if (out.kind !== 'step') throw new Error('expected step')
    expect(out.branchId).toBe('doctor-network-error')
  })

  test('after step 1 with unmatched JSON → falls through to recovery step 2', () => {
    const env = envelopeWithBranches()
    const out = nextStepFromEnvelope(env, 1, doctorResult('unmatched'))
    if (out.kind !== 'step') throw new Error('expected step')
    expect(out.branchId).toBeUndefined()
    expect(out.cursor).toBe(2)
    expect(out.totalSteps).toBe(env.recovery.length)
    expect(out.step.command).toBe('dbcli inspect --no-connect --format json')
  })

  test('after step 1 with non-JSON result → falls through to recovery', () => {
    const out = nextStepFromEnvelope(envelopeWithBranches(), 1, {
      status: 'failed',
      stdoutSummary: 'not json',
    })
    if (out.kind !== 'step') throw new Error('expected step')
    expect(out.branchId).toBeUndefined()
    expect(out.cursor).toBe(2)
  })
})

describe('nextStepFromEnvelope — walking inside a branch', () => {
  test('after step 1 of doctor-config-missing → step 2 (inspect)', () => {
    const env = envelopeWithBranches()
    const out = nextStepFromEnvelope(env, 1, okResult, { branchId: 'doctor-config-missing' })
    if (out.kind !== 'step') throw new Error('expected step')
    expect(out.branchId).toBe('doctor-config-missing')
    expect(out.cursor).toBe(2)
    expect(out.totalSteps).toBe(2)
    expect(out.step.command).toBe('dbcli inspect --no-connect --format json')
  })

  test('after the last step of a branch → done', () => {
    const env = envelopeWithBranches()
    const out = nextStepFromEnvelope(env, 2, okResult, { branchId: 'doctor-config-missing' })
    expect(out.kind).toBe('done')
    if (out.kind === 'done') {
      expect(out.branchId).toBe('doctor-config-missing')
      expect(out.cursor).toBe(2)
      expect(out.totalSteps).toBe(2)
    }
  })

  test('single-step branch (doctor-clean): after step 1 → done', () => {
    const env = envelopeWithBranches()
    const out = nextStepFromEnvelope(env, 1, okResult, { branchId: 'doctor-clean' })
    expect(out.kind).toBe('done')
    if (out.kind === 'done') expect(out.branchId).toBe('doctor-clean')
  })
})

describe('nextStepFromEnvelope — branch error paths', () => {
  test('--branch on envelope with no branches throws RangeError', () => {
    const env = envelope(3) // no branches
    expect(() => nextStepFromEnvelope(env, 1, okResult, { branchId: 'doctor-clean' })).toThrow(
      RangeError
    )
  })

  test('unknown branchId throws RangeError', () => {
    const env = envelopeWithBranches()
    expect(() => nextStepFromEnvelope(env, 1, okResult, { branchId: 'doctor-mystery' })).toThrow(
      RangeError
    )
  })

  test('--after-step beyond branch length throws RangeError', () => {
    const env = envelopeWithBranches()
    expect(() => nextStepFromEnvelope(env, 2, okResult, { branchId: 'doctor-clean' })).toThrow(
      RangeError
    )
  })

  test('--after-step < 1 inside branch throws RangeError', () => {
    const env = envelopeWithBranches()
    expect(() => nextStepFromEnvelope(env, 0, okResult, { branchId: 'doctor-clean' })).toThrow(
      RangeError
    )
  })
})

describe('nextStepFromEnvelope — no-fork regression', () => {
  test('non-connection envelope (no branches) walks recovery linearly', () => {
    const env = envelope(3)
    const out = nextStepFromEnvelope(env, 1, okResult)
    if (out.kind !== 'step') throw new Error('expected step')
    expect(out.branchId).toBeUndefined()
    expect(out.cursor).toBe(2)
    expect(out.totalSteps).toBe(3)
  })

  test('envelope with branches but afterStep before fork point still walks recovery', () => {
    const base = envelopeWithBranches()
    const env: RecoveryEnvelope = { ...base, branchFork: { ...base.branchFork!, after: 2 } }
    const out = nextStepFromEnvelope(env, 1, doctorResult('auth'))
    if (out.kind !== 'step') throw new Error('expected step')
    expect(out.branchId).toBeUndefined()
    expect(out.cursor).toBe(2)
  })
})
