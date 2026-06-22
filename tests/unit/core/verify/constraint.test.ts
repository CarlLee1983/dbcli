import { describe, test, expect } from 'bun:test'
import {
  normalizeConstraintCheck,
  normalizeConstraintInput,
  buildConstraintSubject,
  buildConstraintAfterWriteCommand,
  runConstraintPreflight,
  runConstraintAfterWrite,
  type ConstraintRunners,
  type ViolationCountOutcome,
} from '@/core/verify/constraint'
import { VerifyInputError } from '@/core/verify/scenario'
import type { GuardOutcome } from '@/core/verify'

describe('normalizeConstraintCheck', () => {
  test('accepts the four supported checks', () => {
    expect(normalizeConstraintCheck('fk')).toBe('fk')
    expect(normalizeConstraintCheck('not-null')).toBe('not-null')
    expect(normalizeConstraintCheck('unique')).toBe('unique')
    expect(normalizeConstraintCheck('custom')).toBe('custom')
  })
  test('rejects missing or unsupported checks', () => {
    expect(() => normalizeConstraintCheck(undefined)).toThrow(VerifyInputError)
    expect(() => normalizeConstraintCheck('FK')).toThrow(VerifyInputError)
    expect(() => normalizeConstraintCheck('check')).toThrow(VerifyInputError)
  })
})

describe('normalizeConstraintInput', () => {
  test('fk requires exactly one column and a parseable --references', () => {
    const input = normalizeConstraintInput({
      check: 'fk',
      table: 'orders',
      column: ['user_id'],
      references: 'users.id',
    })
    expect(input.columns).toEqual(['user_id'])
    expect(input.references).toEqual({ table: 'users', column: 'id' })
    expect(() =>
      normalizeConstraintInput({
        check: 'fk',
        table: 'orders',
        column: ['a', 'b'],
        references: 'users.id',
      })
    ).toThrow(VerifyInputError)
    expect(() =>
      normalizeConstraintInput({ check: 'fk', table: 'orders', column: ['user_id'] })
    ).toThrow(VerifyInputError)
    expect(() =>
      normalizeConstraintInput({
        check: 'fk',
        table: 'orders',
        column: ['user_id'],
        references: 'usersid',
      })
    ).toThrow(VerifyInputError)
  })
  test('not-null / unique require at least one column and forbid references/violation-query', () => {
    expect(
      normalizeConstraintInput({ check: 'not-null', table: 'users', column: ['email'] }).columns
    ).toEqual(['email'])
    expect(
      normalizeConstraintInput({ check: 'unique', table: 'm', column: ['a', 'b'] }).columns
    ).toEqual(['a', 'b'])
    expect(() => normalizeConstraintInput({ check: 'not-null', table: 'users' })).toThrow(
      VerifyInputError
    )
    expect(() =>
      normalizeConstraintInput({
        check: 'unique',
        table: 'm',
        column: ['a'],
        violationQuery: 'SELECT 1',
      })
    ).toThrow(VerifyInputError)
  })
  test('custom requires --violation-query and forbids columns/references', () => {
    const input = normalizeConstraintInput({
      check: 'custom',
      table: 'users',
      violationQuery: 'SELECT COUNT(*) AS violation_count FROM users WHERE x',
    })
    expect(input.violationQuery).toContain('violation_count')
    expect(input.columns).toEqual([])
    expect(() => normalizeConstraintInput({ check: 'custom', table: 'users' })).toThrow(
      VerifyInputError
    )
    expect(() =>
      normalizeConstraintInput({
        check: 'custom',
        table: 'users',
        violationQuery: 'SELECT 1',
        column: ['x'],
      })
    ).toThrow(VerifyInputError)
  })
  test('baseline parses a non-negative integer (default 0); allowPreexisting defaults false', () => {
    const a = normalizeConstraintInput({ check: 'not-null', table: 'users', column: ['email'] })
    expect(a.baseline).toBe(0)
    expect(a.allowPreexisting).toBe(false)
    const b = normalizeConstraintInput({
      check: 'not-null',
      table: 'users',
      column: ['email'],
      allowPreexisting: true,
      baseline: '5',
    })
    expect(b.baseline).toBe(5)
    expect(b.allowPreexisting).toBe(true)
    expect(() =>
      normalizeConstraintInput({
        check: 'not-null',
        table: 'users',
        column: ['email'],
        baseline: '-1',
      })
    ).toThrow(VerifyInputError)
    expect(() =>
      normalizeConstraintInput({
        check: 'not-null',
        table: 'users',
        column: ['email'],
        baseline: 'x',
      })
    ).toThrow(VerifyInputError)
  })
  test('defaults format=table and afterWrite=false', () => {
    const input = normalizeConstraintInput({ check: 'not-null', table: 'users', column: ['email'] })
    expect(input.format).toBe('table')
    expect(input.afterWrite).toBe(false)
  })
})

const FIXED = { now: () => new Date('2026-06-22T00:00:00.000Z'), idFactory: () => 'ver_ct_0001' }
const NN_RAW = { check: 'not-null', table: 'users', column: ['email'] }

function runners(over: Partial<ConstraintRunners> = {}): ConstraintRunners {
  const ok = async (): Promise<GuardOutcome> => ({ ok: true })
  return {
    violationSql: 'SELECT COUNT(*) AS violation_count FROM "users" WHERE "email" IS NULL',
    blacklistGuard: ok,
    schemaGuard: ok,
    violationReadonlyGuard: ok,
    runViolationCount: async (): Promise<ViolationCountOutcome> => ({ ran: true, count: 0 }),
    ...over,
  }
}

describe('buildConstraintSubject reuses the table artifact subject', () => {
  test('kind table, command verify constraint', () => {
    expect(buildConstraintSubject(normalizeConstraintInput({ ...NN_RAW }))).toEqual({
      kind: 'table',
      name: 'users',
      command: 'verify constraint',
    })
  })
})

describe('buildConstraintAfterWriteCommand', () => {
  test('appends --allow-preexisting --baseline only when baseline > 0', () => {
    const input = normalizeConstraintInput({ ...NN_RAW })
    expect(buildConstraintAfterWriteCommand(input, 0)).not.toContain('--allow-preexisting')
    const tolerant = buildConstraintAfterWriteCommand(input, 3)
    expect(tolerant).toContain('--allow-preexisting')
    expect(tolerant).toContain('--baseline 3')
    expect(tolerant).toContain('--after-write')
  })
})

describe('runConstraintPreflight', () => {
  test('ready when all guards pass; captures baseline from the count', async () => {
    const r = await runConstraintPreflight(
      normalizeConstraintInput({ ...NN_RAW }),
      runners({
        runViolationCount: async () => ({ ran: true, count: 2 }),
      })
    )
    expect(r.status).toBe('ready')
    expect(r.baseline).toBe(2)
    expect(r.guards).toHaveLength(3)
  })
  test('blocked when a guard fails; no baseline', async () => {
    const r = await runConstraintPreflight(
      normalizeConstraintInput({ ...NN_RAW }),
      runners({
        blacklistGuard: async () => ({ ok: false, reason: 'blacklisted' }),
      })
    )
    expect(r.status).toBe('blocked')
    expect(r.baseline).toBeUndefined()
  })
})

describe('runConstraintAfterWrite verdict mapping', () => {
  test('verified when violations == 0 (strict default)', async () => {
    const r = await runConstraintAfterWrite(
      normalizeConstraintInput({ ...NN_RAW }),
      runners(),
      FIXED
    )
    expect(r.status).toBe('verified')
    expect(r.assertion).toEqual({ violations: 0, threshold: 0, passed: true })
    expect(r.artifact.subject).toEqual({
      kind: 'table',
      name: 'users',
      command: 'verify constraint',
    })
  })
  test('not_verified when violations > 0 (strict default)', async () => {
    const r = await runConstraintAfterWrite(
      normalizeConstraintInput({ ...NN_RAW }),
      runners({ runViolationCount: async () => ({ ran: true, count: 4 }) }),
      FIXED
    )
    expect(r.status).toBe('not_verified')
    expect(r.assertion).toEqual({ violations: 4, threshold: 0, passed: false })
  })
  test('verified under --allow-preexisting when violations <= baseline', async () => {
    const input = normalizeConstraintInput({ ...NN_RAW, allowPreexisting: true, baseline: '5' })
    const r = await runConstraintAfterWrite(
      input,
      runners({ runViolationCount: async () => ({ ran: true, count: 5 }) }),
      FIXED
    )
    expect(r.status).toBe('verified')
    expect(r.assertion).toEqual({ violations: 5, threshold: 5, passed: true })
  })
  test('indeterminate when the count cannot be read', async () => {
    const r = await runConstraintAfterWrite(
      normalizeConstraintInput({ ...NN_RAW }),
      runners({ runViolationCount: async () => ({ ran: false, reason: 'syntax error' }) }),
      FIXED
    )
    expect(r.status).toBe('indeterminate')
    expect(r.assertion).toBeUndefined()
  })
  test('blocked when a guard fails; artifact carries no assertion evidence', async () => {
    const r = await runConstraintAfterWrite(
      normalizeConstraintInput({ ...NN_RAW }),
      runners({ schemaGuard: async () => ({ ok: false, reason: 'no such column' }) }),
      FIXED
    )
    expect(r.status).toBe('blocked')
    expect(r.blockedReason).toBe('no such column')
    expect(r.artifact.evidence).toHaveLength(1)
  })
})
