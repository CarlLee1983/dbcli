import { describe, test, expect } from 'bun:test'
import { evaluateVerify } from '@/core/recovery/verify-heuristic'
import type { ExecOutcome } from '@/core/recovery/apply-exec'

function outcome(p: Partial<ExecOutcome>): ExecOutcome {
  return {
    exitCode: 0,
    stdout: '',
    stderr: '',
    durationMs: 1,
    truncated: false,
    timedOut: false,
    ...p,
  }
}

describe('evaluateVerify — exit-code-only codes', () => {
  test.each([
    'CONN_REFUSED',
    'CONN_TIMEOUT',
    'CONN_UNKNOWN',
    'CONN_AUTH_FAILED',
    'CONN_HOST_NOT_FOUND',
    'PERMISSION_DENIED',
    'BLACKLIST_TABLE',
    'BLACKLIST_COLUMN_WRITE',
    'SNIPPET_NOT_FOUND',
    'SNIPPET_AMBIGUOUS',
    'SNIPPET_PARAM_MISSING',
    'UNKNOWN',
  ] as const)('%s: exit 0 → passed', (code) => {
    expect(evaluateVerify(code, outcome({ exitCode: 0 }))).toBe('passed')
  })

  test.each([
    'CONN_REFUSED',
    'PERMISSION_DENIED',
    'BLACKLIST_TABLE',
    'SNIPPET_NOT_FOUND',
    'UNKNOWN',
  ] as const)('%s: exit ≠ 0 → failed', (code) => {
    expect(evaluateVerify(code, outcome({ exitCode: 1 }))).toBe('failed')
  })

  test('timed-out outcome is failed', () => {
    expect(evaluateVerify('CONN_REFUSED', outcome({ exitCode: 0, timedOut: true }))).toBe('failed')
  })
})

describe('evaluateVerify — CONFIG_MISSING (JSON content)', () => {
  test('exit 0 + connection.name truthy → passed', () => {
    const stdout = JSON.stringify({ connection: { name: 'default' } })
    expect(evaluateVerify('CONFIG_MISSING', outcome({ stdout }))).toBe('passed')
  })

  test('exit 0 + connection.name null → indeterminate', () => {
    const stdout = JSON.stringify({ connection: { name: null } })
    expect(evaluateVerify('CONFIG_MISSING', outcome({ stdout }))).toBe('indeterminate')
  })

  test('exit 0 + JSON parse failure → indeterminate', () => {
    expect(evaluateVerify('CONFIG_MISSING', outcome({ stdout: 'not json' }))).toBe('indeterminate')
  })

  test('exit 0 + missing connection field → indeterminate', () => {
    expect(evaluateVerify('CONFIG_MISSING', outcome({ stdout: '{}' }))).toBe('indeterminate')
  })

  test('exit ≠ 0 → failed (regardless of stdout)', () => {
    expect(evaluateVerify('CONFIG_MISSING', outcome({ exitCode: 2, stdout: '{}' }))).toBe('failed')
  })
})

describe('evaluateVerify — SCHEMA_CACHE_MISSING (JSON content)', () => {
  test('exit 0 + schemaCache.available === true → passed', () => {
    const stdout = JSON.stringify({ schemaCache: { available: true } })
    expect(evaluateVerify('SCHEMA_CACHE_MISSING', outcome({ stdout }))).toBe('passed')
  })

  test('exit 0 + schemaCache.available === false → indeterminate', () => {
    const stdout = JSON.stringify({ schemaCache: { available: false } })
    expect(evaluateVerify('SCHEMA_CACHE_MISSING', outcome({ stdout }))).toBe('indeterminate')
  })

  test('exit 0 + JSON parse failure → indeterminate', () => {
    expect(evaluateVerify('SCHEMA_CACHE_MISSING', outcome({ stdout: '<not json>' }))).toBe(
      'indeterminate'
    )
  })

  test('exit ≠ 0 → failed', () => {
    expect(evaluateVerify('SCHEMA_CACHE_MISSING', outcome({ exitCode: 1 }))).toBe('failed')
  })
})
