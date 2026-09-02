import { describe, test, expect } from 'bun:test'
import {
  boundedReason,
  normalizeFormat,
  redactSqlForEvidence,
  shellQuote,
  renderAfterWriteCommand,
  normalizeTableName,
  tableRefsMatch,
  runGuardSequence,
  allGuardsPassed,
  mapAssertionToStatus,
  VerifyInputError,
  requireNonEmpty,
  type GuardOutcome,
} from '@/core/verify/scenario'

describe('boundedReason', () => {
  test('passes short text through and caps long text with an ellipsis', () => {
    expect(boundedReason('short')).toBe('short')
    const long = 'x'.repeat(250)
    const out = boundedReason(long)
    expect(out.length).toBe(200)
    expect(out.endsWith('…')).toBe(true)
  })
})

describe('requireNonEmpty / normalizeFormat', () => {
  test('requireNonEmpty trims and rejects blanks', () => {
    expect(requireNonEmpty('  v ', '--x')).toBe('v')
    expect(() => requireNonEmpty('   ', '--x')).toThrow(VerifyInputError)
  })

  test('normalizeFormat defaults to table and rejects unknown', () => {
    expect(normalizeFormat(undefined)).toBe('table')
    expect(normalizeFormat('json')).toBe('json')
    expect(() => normalizeFormat('csv')).toThrow(VerifyInputError)
  })
})

describe('redactSqlForEvidence / shellQuote', () => {
  test('redacts literals and bounds length', () => {
    const red = redactSqlForEvidence("SELECT 1 FROM t WHERE id = 12345 AND e = 'a@b.com'")
    expect(red).not.toContain('12345')
    expect(red).not.toContain('a@b.com')
  })

  test('shellQuote wraps and escapes embedded quotes', () => {
    expect(shellQuote("a'b")).toBe(`'a'\\''b'`)
  })
})

describe('renderAfterWriteCommand', () => {
  test('joins scenario, flags, and a trailing --after-write', () => {
    const cmd = renderAfterWriteCommand('migration', [`--table 'users'`])
    expect(cmd).toBe(`dbcli verify migration --table 'users' --after-write`)
  })
})

describe('table-name helpers', () => {
  test('normalizeTableName strips schema, quotes, case', () => {
    expect(normalizeTableName('public."Users"')).toBe('users')
  })

  test('tableRefsMatch is schema-aware', () => {
    expect(tableRefsMatch('public.users', 'users')).toBe(true)
    expect(tableRefsMatch('public.users', 'audit.users')).toBe(false)
  })
})

describe('runGuardSequence / allGuardsPassed', () => {
  const ok = async (): Promise<GuardOutcome> => ({ ok: true })
  const bad = async (): Promise<GuardOutcome> => ({ ok: false, reason: 'nope' })

  test('runs in order and short-circuits at first failure', async () => {
    const guards = await runGuardSequence<'a' | 'b' | 'c'>([
      ['a', ok],
      ['b', bad],
      ['c', ok],
    ])
    expect(guards.map((g) => g.name)).toEqual(['a', 'b'])
    expect(guards[1]?.status).toBe('failed')
    expect(guards[1]?.reason).toBe('nope')
  })

  test('can report every guard after a failure', async () => {
    const guards = await runGuardSequence<'a' | 'b' | 'c'>(
      [
        ['a', ok],
        ['b', bad],
        ['c', ok],
      ],
      { stopOnFailure: false }
    )
    expect(guards.map((g) => g.status)).toEqual(['passed', 'failed', 'passed'])
  })

  test('allGuardsPassed requires the expected count and all passed', async () => {
    const guards = await runGuardSequence<'a' | 'b'>([
      ['a', ok],
      ['b', ok],
    ])
    expect(allGuardsPassed(guards, 2)).toBe(true)
    expect(allGuardsPassed(guards, 3)).toBe(false)
  })
})

describe('mapAssertionToStatus', () => {
  test('maps ran/pass to verified, not_verified, indeterminate', () => {
    expect(mapAssertionToStatus({ ran: true, pass: true })).toBe('verified')
    expect(mapAssertionToStatus({ ran: true, pass: false })).toBe('not_verified')
    expect(mapAssertionToStatus({ ran: false })).toBe('indeterminate')
  })
})
