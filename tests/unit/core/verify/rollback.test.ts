import { describe, test, expect } from 'bun:test'
import {
  normalizeRollbackKind,
  normalizeRollbackInput,
  statementGuardName,
  buildRollbackSubject,
  buildRollbackAfterWriteCommand,
  runRollbackPreflight,
  runRollbackAfterWrite,
  type RollbackRunners,
} from '@/core/verify/rollback'
import { VerifyInputError, type GuardOutcome, type AssertionOutcome } from '@/core/verify/scenario'

const DDL_RAW = {
  kind: 'ddl',
  table: 'users',
  statement: 'ALTER TABLE users DROP COLUMN status',
  verifyQuery: 'SELECT count(*)::int AS n FROM information_schema.columns WHERE column_name = $1',
  expect: 'value == 0',
}

const DML_RAW = {
  kind: 'dml',
  table: 'users',
  statement: "UPDATE users SET status = NULL WHERE status = 9",
  verifyQuery: 'SELECT count(*)::int AS n FROM users WHERE status = 9',
  expect: 'value == 0',
}

const FIXED = {
  now: () => new Date('2026-06-22T00:00:00.000Z'),
  idFactory: () => 'ver_rb_0001',
}

function passingRunners(over: Partial<RollbackRunners> = {}): RollbackRunners {
  const ok = async (): Promise<GuardOutcome> => ({ ok: true })
  const assertOk = async (): Promise<AssertionOutcome> => ({ ran: true, pass: true })
  return {
    blacklistGuard: ok,
    schemaGuard: ok,
    statementGuard: ok,
    verifyReadonlyGuard: ok,
    runAssertion: assertOk,
    ...over,
  }
}

describe('normalizeRollbackKind', () => {
  test('accepts ddl and dml', () => {
    expect(normalizeRollbackKind('ddl')).toBe('ddl')
    expect(normalizeRollbackKind('dml')).toBe('dml')
  })

  test('rejects missing or unsupported kinds before any guard', () => {
    expect(() => normalizeRollbackKind(undefined)).toThrow(VerifyInputError)
    expect(() => normalizeRollbackKind('')).toThrow(VerifyInputError)
    expect(() => normalizeRollbackKind('schema')).toThrow(VerifyInputError)
    expect(() => normalizeRollbackKind('DDL')).toThrow(VerifyInputError)
  })
})

describe('normalizeRollbackInput', () => {
  test('requires kind, statement, verify-query and expect', () => {
    expect(() => normalizeRollbackInput({ ...DDL_RAW, kind: 'nope' })).toThrow(VerifyInputError)
    expect(() => normalizeRollbackInput({ ...DDL_RAW, statement: '   ' })).toThrow(VerifyInputError)
    expect(() => normalizeRollbackInput({ ...DDL_RAW, verifyQuery: '' })).toThrow(VerifyInputError)
    expect(() => normalizeRollbackInput({ ...DDL_RAW, expect: '' })).toThrow(VerifyInputError)
  })

  test('defaults format=table and afterWrite=false; carries kind', () => {
    const input = normalizeRollbackInput({ ...DML_RAW })
    expect(input.kind).toBe('dml')
    expect(input.format).toBe('table')
    expect(input.afterWrite).toBe(false)
    expect(input.statement).toBe(DML_RAW.statement)
  })
})

describe('statementGuardName', () => {
  test('ddl -> ddl, dml -> plan (parity with sibling scenarios)', () => {
    expect(statementGuardName('ddl')).toBe('ddl')
    expect(statementGuardName('dml')).toBe('plan')
  })
})

describe('buildRollbackSubject maps kind to an existing artifact subject kind', () => {
  test('ddl rollback -> migration subject; dml rollback -> backfill subject', () => {
    expect(buildRollbackSubject(normalizeRollbackInput({ ...DDL_RAW }))).toEqual({
      kind: 'migration',
      name: 'users',
      command: 'verify rollback',
    })
    expect(buildRollbackSubject(normalizeRollbackInput({ ...DML_RAW }))).toEqual({
      kind: 'backfill',
      name: 'users',
      command: 'verify rollback',
    })
  })

  test('subject-name overrides the default table name', () => {
    const subject = buildRollbackSubject(
      normalizeRollbackInput({ ...DDL_RAW, subjectName: 'rollback-42' })
    )
    expect(subject.name).toBe('rollback-42')
  })
})

describe('buildRollbackAfterWriteCommand', () => {
  test('names the rollback scenario and includes --kind and --statement', () => {
    const cmd = buildRollbackAfterWriteCommand(normalizeRollbackInput({ ...DML_RAW }))
    expect(cmd).toContain('dbcli verify rollback')
    expect(cmd).toContain('--kind dml')
    expect(cmd).toContain(`--statement '${DML_RAW.statement}'`)
    expect(cmd).toContain('--after-write')
  })
})

describe('runRollbackPreflight', () => {
  test('ddl kind: all guards pass -> ready, statement guard is named "ddl"', async () => {
    const result = await runRollbackPreflight(normalizeRollbackInput({ ...DDL_RAW }), passingRunners())
    expect(result.status).toBe('ready')
    expect(result.kind).toBe('ddl')
    expect(result.plannedStatement).toBe(DDL_RAW.statement)
    expect(result.guards.map((g) => g.name)).toEqual([
      'blacklist',
      'schema',
      'ddl',
      'verify-query-readonly',
    ])
  })

  test('dml kind: statement guard is named "plan"', async () => {
    const result = await runRollbackPreflight(normalizeRollbackInput({ ...DML_RAW }), passingRunners())
    expect(result.kind).toBe('dml')
    expect(result.guards.map((g) => g.name)).toEqual([
      'blacklist',
      'schema',
      'plan',
      'verify-query-readonly',
    ])
  })

  test('a failing statement guard short-circuits the readonly guard', async () => {
    const result = await runRollbackPreflight(
      normalizeRollbackInput({ ...DDL_RAW }),
      passingRunners({
        statementGuard: async () => ({ ok: false, reason: 'must be an ALTER TABLE statement' }),
      })
    )
    expect(result.status).toBe('blocked')
    expect(result.guards.map((g) => g.name)).toEqual(['blacklist', 'schema', 'ddl'])
  })
})

describe('runRollbackAfterWrite', () => {
  test('verified outcome emits a migration-subject artifact for ddl rollback', async () => {
    const result = await runRollbackAfterWrite(
      normalizeRollbackInput({ ...DDL_RAW }),
      passingRunners(),
      FIXED
    )
    expect(result.status).toBe('verified')
    expect(result.artifact.subject.kind).toBe('migration')
    expect(result.artifact.subject.command).toBe('verify rollback')
    expect(result.assertion).toEqual({ expect: DDL_RAW.expect, passed: true })
  })

  test('verified outcome emits a backfill-subject artifact for dml rollback', async () => {
    const result = await runRollbackAfterWrite(
      normalizeRollbackInput({ ...DML_RAW }),
      passingRunners(),
      FIXED
    )
    expect(result.status).toBe('verified')
    expect(result.artifact.subject.kind).toBe('backfill')
  })

  test('a blocked guard yields status=blocked with a bounded reason and an artifact', async () => {
    const result = await runRollbackAfterWrite(
      normalizeRollbackInput({ ...DML_RAW }),
      passingRunners({
        statementGuard: async () => ({ ok: false, reason: 'must be an UPDATE statement' }),
      }),
      FIXED
    )
    expect(result.status).toBe('blocked')
    expect(result.blockedReason).toContain('UPDATE')
    expect(result.artifact.status).toBe('blocked')
  })

  test('a failing assertion maps to not_verified', async () => {
    const result = await runRollbackAfterWrite(
      normalizeRollbackInput({ ...DML_RAW }),
      passingRunners({ runAssertion: async () => ({ ran: true, pass: false }) }),
      FIXED
    )
    expect(result.status).toBe('not_verified')
    expect(result.assertion).toEqual({ expect: DML_RAW.expect, passed: false })
  })

  test('an indeterminate assertion maps to indeterminate (no trustworthy verdict)', async () => {
    const result = await runRollbackAfterWrite(
      normalizeRollbackInput({ ...DML_RAW }),
      passingRunners({ runAssertion: async () => ({ ran: false, reason: 'bad expect shape' }) }),
      FIXED
    )
    expect(result.status).toBe('indeterminate')
    expect(result.assertion).toBeUndefined()
  })
})
