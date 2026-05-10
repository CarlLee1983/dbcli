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
