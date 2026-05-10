import { describe, test, expect } from 'bun:test'
import { verifyForCode } from '@/core/recovery/verify-steps'
import { RECOVERY_CODES } from '@/core/recovery/types'
import { classifyArgvForCode } from '@/core/recovery/apply-allowlist'
import { parseArgv } from '@/core/recovery/apply-shell'

describe('verifyForCode', () => {
  test('every recovery code returns a non-null verify step', () => {
    for (const code of RECOVERY_CODES) {
      const step = verifyForCode(code, { operation: 'query' })
      expect(step).not.toBeNull()
    }
  })

  test('every verify step is risk: readonly', () => {
    for (const code of RECOVERY_CODES) {
      const step = verifyForCode(code, { operation: 'query' })!
      expect(step.risk).toBe('readonly')
    }
  })

  test('verify steps never carry placeholders', () => {
    for (const code of RECOVERY_CODES) {
      const step = verifyForCode(code, { operation: 'query' })!
      expect(step.placeholders).toBeUndefined()
      expect(step.command).not.toMatch(/<[a-zA-Z][a-zA-Z0-9_-]*>/)
    }
  })

  test('verify steps are never interactive', () => {
    for (const code of RECOVERY_CODES) {
      const step = verifyForCode(code, { operation: 'query' })!
      expect(step.interactive).toBeFalsy()
    }
  })

  test('every verify step parses to argv and is allowlisted for its code', () => {
    for (const code of RECOVERY_CODES) {
      const step = verifyForCode(code, { operation: 'query' })!
      const argv = parseArgv(step.command)
      const cls = classifyArgvForCode(argv, code)
      expect(cls.kind).toBe('allowed')
      if (cls.kind === 'allowed') {
        expect(cls.tier).toBe('readonly')
      }
    }
  })

  test('CONFIG_MISSING uses inspect --no-connect --format json', () => {
    const step = verifyForCode('CONFIG_MISSING', { operation: 'query' })!
    expect(step.command).toBe('dbcli inspect --no-connect --format json')
  })

  test('CONN_* family uses doctor --format json', () => {
    for (const code of [
      'CONN_REFUSED',
      'CONN_TIMEOUT',
      'CONN_UNKNOWN',
      'CONN_AUTH_FAILED',
      'CONN_HOST_NOT_FOUND',
    ] as const) {
      const step = verifyForCode(code, { operation: 'query' })!
      expect(step.command).toBe('dbcli doctor --format json')
    }
  })

  test('blacklist + permission codes use inspect --for-agent', () => {
    for (const code of ['BLACKLIST_TABLE', 'BLACKLIST_COLUMN_WRITE', 'PERMISSION_DENIED'] as const) {
      const step = verifyForCode(code, { operation: 'query' })!
      expect(step.command).toBe('dbcli inspect --for-agent')
    }
  })

  test('snippet codes use queries list --format json', () => {
    for (const code of ['SNIPPET_NOT_FOUND', 'SNIPPET_AMBIGUOUS', 'SNIPPET_PARAM_MISSING'] as const) {
      const step = verifyForCode(code, { operation: 'q' })!
      expect(step.command).toBe('dbcli queries list --format json')
    }
  })

  test('SCHEMA_CACHE_MISSING uses inspect --format json', () => {
    const step = verifyForCode('SCHEMA_CACHE_MISSING', { operation: 'schema' })!
    expect(step.command).toBe('dbcli inspect --format json')
  })

  test('UNKNOWN uses doctor --format json', () => {
    const step = verifyForCode('UNKNOWN', { operation: 'query' })!
    expect(step.command).toBe('dbcli doctor --format json')
  })

  test('verify step has order: 0 (sentinel — not part of main plan)', () => {
    for (const code of RECOVERY_CODES) {
      const step = verifyForCode(code, { operation: 'query' })!
      expect(step.order).toBe(0)
    }
  })
})
