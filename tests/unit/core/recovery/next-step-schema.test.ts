import { describe, test, expect } from 'bun:test'
import { parseStepResultSummary } from '@/core/recovery/next-step-schema'

describe('parseStepResultSummary', () => {
  test('parses a minimal ok result', () => {
    const r = parseStepResultSummary({ status: 'ok' })
    expect(r.ok).toBe(true)
    expect(r.value!.status).toBe('ok')
  })

  test('parses full result with summaries', () => {
    const r = parseStepResultSummary({
      status: 'ok',
      exitCode: 0,
      stdoutSummary: 'hello',
      stderrSummary: '',
    })
    expect(r.ok).toBe(true)
    expect(r.value!.exitCode).toBe(0)
  })

  test('rejects unknown status', () => {
    const r = parseStepResultSummary({ status: 'maybe' })
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('status')
  })

  test('rejects unknown extra field (strict)', () => {
    const r = parseStepResultSummary({ status: 'ok', extra: 1 })
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('extra')
  })

  test('rejects stdoutSummary over 4096 chars', () => {
    const r = parseStepResultSummary({
      status: 'ok',
      stdoutSummary: 'x'.repeat(4097),
    })
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('stdoutSummary')
  })

  test('accepts stdoutSummary at exactly 4096 chars', () => {
    const r = parseStepResultSummary({
      status: 'ok',
      stdoutSummary: 'x'.repeat(4096),
    })
    expect(r.ok).toBe(true)
  })

  test('rejects stderrSummary over 4096 chars', () => {
    const r = parseStepResultSummary({
      status: 'ok',
      stderrSummary: 'y'.repeat(4097),
    })
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('stderrSummary')
  })
})
