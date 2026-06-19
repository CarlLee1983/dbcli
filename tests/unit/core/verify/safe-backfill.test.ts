import { describe, test, expect } from 'bun:test'
import {
  normalizeSafeBackfillInput,
  isReadOnlyOperation,
  isUpdateOperation,
  isPlainSelectVerifyQuery,
  normalizeTableName,
  extractUpdateTargetTable,
  updateTargetMatchesTable,
  redactSqlForEvidence,
  buildAfterWriteCommand,
  buildSafeBackfillSubject,
  VerifyInputError,
  runSafeBackfillPreflight,
  runSafeBackfillAfterWrite,
  type SafeBackfillRunners,
  type GuardOutcome,
  type AssertionOutcome,
} from '@/core/verify/safe-backfill'

const RAW = {
  table: 'users',
  query: 'UPDATE users SET status = 1 WHERE status IS NULL',
  verifyQuery: 'SELECT count(*)::int AS n FROM users WHERE status IS NULL',
  expect: 'value == 0',
}

describe('normalizeSafeBackfillInput', () => {
  test('accepts a complete input and defaults format=table, afterWrite=false', () => {
    const input = normalizeSafeBackfillInput({ ...RAW })
    expect(input.format).toBe('table')
    expect(input.afterWrite).toBe(false)
    expect(input.table).toBe('users')
  })

  test('honors afterWrite, format, subjectName, summary', () => {
    const input = normalizeSafeBackfillInput({
      ...RAW,
      afterWrite: true,
      format: 'json',
      subjectName: 'nightly',
      summary: 'manual note',
    })
    expect(input.afterWrite).toBe(true)
    expect(input.format).toBe('json')
    expect(input.subjectName).toBe('nightly')
    expect(input.summary).toBe('manual note')
  })

  test.each(['table', 'query', 'verifyQuery', 'expect'] as const)(
    'throws VerifyInputError when %s is empty',
    (field) => {
      expect(() => normalizeSafeBackfillInput({ ...RAW, [field]: '   ' })).toThrow(VerifyInputError)
    }
  )

  test('throws VerifyInputError on an unsupported format', () => {
    expect(() => normalizeSafeBackfillInput({ ...RAW, format: 'csv' })).toThrow(VerifyInputError)
  })
})

describe('operation classifiers', () => {
  test('isReadOnlyOperation', () => {
    expect(isReadOnlyOperation('SELECT')).toBe(true)
    expect(isReadOnlyOperation('SHOW')).toBe(true)
    expect(isReadOnlyOperation('UPDATE')).toBe(false)
    expect(isReadOnlyOperation('DELETE')).toBe(false)
  })

  test('isUpdateOperation', () => {
    expect(isUpdateOperation('UPDATE')).toBe(true)
    expect(isUpdateOperation('SELECT')).toBe(false)
  })
})

describe('operation classifiers (plain SELECT)', () => {
  test('isPlainSelectVerifyQuery accepts a plain SELECT', () => {
    expect(isPlainSelectVerifyQuery('SELECT', 'SELECT count(*) FROM users WHERE x IS NULL')).toBe(
      true
    )
  })

  test('isPlainSelectVerifyQuery rejects EXPLAIN (e.g. EXPLAIN ANALYZE UPDATE can write)', () => {
    expect(isPlainSelectVerifyQuery('EXPLAIN', 'EXPLAIN ANALYZE UPDATE users SET x = 1')).toBe(false)
  })

  test('isPlainSelectVerifyQuery rejects SHOW/DESCRIBE even though they are read-only', () => {
    expect(isPlainSelectVerifyQuery('SHOW', 'SHOW TABLES')).toBe(false)
    expect(isPlainSelectVerifyQuery('DESCRIBE', 'DESCRIBE users')).toBe(false)
  })

  test('isPlainSelectVerifyQuery rejects a data-modifying CTE that reports as SELECT', () => {
    const cte = 'WITH d AS (DELETE FROM users WHERE id = 1 RETURNING *) SELECT count(*) FROM d'
    expect(isPlainSelectVerifyQuery('SELECT', cte)).toBe(false)
  })

  test('isPlainSelectVerifyQuery ignores write-like words inside string literals', () => {
    expect(isPlainSelectVerifyQuery('SELECT', "SELECT count(*) FROM t WHERE note = 'delete me'")).toBe(
      true
    )
  })
})

describe('updateTargetMatchesTable', () => {
  test('normalizeTableName strips schema, quotes, and case', () => {
    expect(normalizeTableName('public."Users"')).toBe('users')
    expect(normalizeTableName('`users`')).toBe('users')
    expect(normalizeTableName('users')).toBe('users')
  })

  test('extractUpdateTargetTable returns the (qualified) UPDATE target', () => {
    expect(extractUpdateTargetTable('UPDATE users SET x = 1 WHERE id = 2')).toBe('users')
    expect(extractUpdateTargetTable('UPDATE public.users SET x = 1 WHERE id = 2')).toBe(
      'public.users'
    )
    expect(extractUpdateTargetTable('UPDATE ONLY audit.users SET x = 1 WHERE id = 2')).toBe(
      'audit.users'
    )
    expect(extractUpdateTargetTable('SELECT 1')).toBeNull()
  })

  test('matches when the UPDATE target equals --table', () => {
    expect(updateTargetMatchesTable('UPDATE users SET x=1 WHERE id=2', 'users')).toBe(true)
    expect(updateTargetMatchesTable('UPDATE public.users SET x=1 WHERE id=2', 'public.users')).toBe(
      true
    )
  })

  test('falls back to the bare name only when one side omits the schema', () => {
    expect(updateTargetMatchesTable('UPDATE users SET x=1 WHERE id=2', 'public.users')).toBe(true)
    expect(updateTargetMatchesTable('UPDATE public.users SET x=1 WHERE id=2', 'users')).toBe(true)
  })

  test('rejects the same table name in a different schema', () => {
    expect(updateTargetMatchesTable('UPDATE public.users SET x=1 WHERE id=2', 'audit.users')).toBe(
      false
    )
  })

  test('rejects a different table and a query with no UPDATE target', () => {
    expect(updateTargetMatchesTable('UPDATE accounts SET x=1 WHERE id=2', 'users')).toBe(false)
    expect(updateTargetMatchesTable('SELECT 1', 'users')).toBe(false)
  })
})

describe('redactSqlForEvidence', () => {
  test('strips single-quoted string literals and numeric literals', () => {
    const red = redactSqlForEvidence("SELECT 1 FROM t WHERE email = 'secret@example.com'")
    expect(red).not.toContain('secret@example.com')
    expect(red).toContain('SELECT')
    expect(red).toContain('FROM t WHERE email =')
  })

  test('strips numeric literals and dollar-quoted strings', () => {
    const red = redactSqlForEvidence('SELECT * FROM t WHERE id = 12345 AND token = $$secret$$')
    expect(red).not.toContain('12345')
    expect(red).not.toContain('secret')
  })

  test('collapses whitespace and bounds length', () => {
    const long = `SELECT ${'a'.repeat(200)} FROM t`
    const red = redactSqlForEvidence(long, 40)
    expect(red.length).toBeLessThanOrEqual(40)
    expect(red.endsWith('…')).toBe(true)
  })
})

describe('buildAfterWriteCommand', () => {
  test('renders a runnable --after-write command with shell-quoted sql', () => {
    const cmd = buildAfterWriteCommand(normalizeSafeBackfillInput({ ...RAW }))
    expect(cmd).toContain('dbcli verify safe-backfill')
    expect(cmd).toContain(`--table 'users'`)
    expect(cmd).toContain(`--query '${RAW.query}'`)
    expect(cmd).toContain(`--verify-query '${RAW.verifyQuery}'`)
    expect(cmd).toContain(`--expect '${RAW.expect}'`)
    expect(cmd).toContain('--after-write')
  })

  test('escapes embedded single quotes safely', () => {
    const query = `UPDATE t SET note = 'x' WHERE id = 1`
    const cmd = buildAfterWriteCommand(normalizeSafeBackfillInput({ ...RAW, query }))
    expect(cmd).toContain(`--query 'UPDATE t SET note = '\\''x'\\'' WHERE id = 1'`)
  })

  test('includes --subject-name when set', () => {
    const cmd = buildAfterWriteCommand(
      normalizeSafeBackfillInput({ ...RAW, subjectName: 'nightly' })
    )
    expect(cmd).toContain(`--subject-name 'nightly'`)
  })

  test('includes --summary and non-default --format', () => {
    const cmd = buildAfterWriteCommand(
      normalizeSafeBackfillInput({ ...RAW, summary: 'manual note', format: 'json' })
    )
    expect(cmd).toContain(`--summary 'manual note'`)
    expect(cmd).toContain('--format json')
  })

  test('omits --format when it is the default (table)', () => {
    const cmd = buildAfterWriteCommand(normalizeSafeBackfillInput({ ...RAW }))
    expect(cmd).not.toContain('--format')
  })
})

describe('buildSafeBackfillSubject', () => {
  test('defaults subject name to the table', () => {
    const s = buildSafeBackfillSubject(normalizeSafeBackfillInput({ ...RAW }))
    expect(s).toEqual({ kind: 'backfill', name: 'users', command: 'verify safe-backfill' })
  })

  test('--subject-name overrides the subject name', () => {
    const s = buildSafeBackfillSubject(
      normalizeSafeBackfillInput({ ...RAW, subjectName: 'nightly' })
    )
    expect(s.name).toBe('nightly')
  })
})

const PRE_RAW = {
  table: 'users',
  query: 'UPDATE users SET status = 1 WHERE status IS NULL',
  verifyQuery: 'SELECT count(*)::int AS n FROM users WHERE status IS NULL',
  expect: 'value == 0',
}

function passingRunners(over: Partial<SafeBackfillRunners> = {}): SafeBackfillRunners {
  const ok = async (): Promise<GuardOutcome> => ({ ok: true })
  const assertOk = async (): Promise<AssertionOutcome> => ({ ran: true, pass: true })
  return {
    blacklistGuard: ok,
    schemaGuard: ok,
    planGuard: ok,
    verifyReadonlyGuard: ok,
    runAssertion: assertOk,
    ...over,
  }
}

describe('runSafeBackfillPreflight', () => {
  test('all guards pass -> ready, four guard results, after-write command present', async () => {
    const input = normalizeSafeBackfillInput({ ...PRE_RAW })
    const result = await runSafeBackfillPreflight(input, passingRunners())
    expect(result.status).toBe('ready')
    expect(result.mode).toBe('preflight')
    expect(result.guards.map((g) => g.name)).toEqual([
      'blacklist',
      'schema',
      'plan',
      'verify-query-readonly',
    ])
    expect(result.guards.every((g) => g.status === 'passed')).toBe(true)
    expect(result.afterWriteCommand).toContain('--after-write')
  })

  test('a failing guard short-circuits, returns blocked with a bounded reason', async () => {
    const input = normalizeSafeBackfillInput({ ...PRE_RAW })
    const result = await runSafeBackfillPreflight(
      input,
      passingRunners({
        schemaGuard: async () => ({ ok: false, reason: "Table 'users' does not exist" }),
      })
    )
    expect(result.status).toBe('blocked')
    // blacklist passed, schema failed, plan + readonly never ran (short-circuit).
    expect(result.guards.map((g) => g.name)).toEqual(['blacklist', 'schema'])
    const schema = result.guards.find((g) => g.name === 'schema')
    expect(schema?.status).toBe('failed')
    expect(schema?.reason).toContain('does not exist')
  })

  test('preflight never invokes the assertion runner', async () => {
    const input = normalizeSafeBackfillInput({ ...PRE_RAW })
    let called = false
    await runSafeBackfillPreflight(
      input,
      passingRunners({
        runAssertion: async () => {
          called = true
          return { ran: true, pass: true }
        },
      })
    )
    expect(called).toBe(false)
  })
})

const FIXED = {
  now: () => new Date('2026-06-19T00:00:00.000Z'),
  idFactory: () => 'ver_fixed_0001',
}

describe('runSafeBackfillAfterWrite', () => {
  test('guards pass + assertion pass -> verified, assert evidence exitCode 0', async () => {
    const input = normalizeSafeBackfillInput({ ...PRE_RAW, afterWrite: true })
    const result = await runSafeBackfillAfterWrite(input, passingRunners(), FIXED)
    expect(result.status).toBe('verified')
    expect(result.assertion).toEqual({ expect: 'value == 0', passed: true })
    expect(result.artifact.status).toBe('verified')
    expect(result.artifact.subject).toEqual({
      kind: 'backfill',
      name: 'users',
      command: 'verify safe-backfill',
    })
    const kinds = result.artifact.evidence.map((e) => e.kind)
    expect(kinds).toContain('task-pack-plan')
    expect(kinds).toContain('assert')
    const assertEv = result.artifact.evidence.find((e) => e.kind === 'assert')
    expect(assertEv?.exitCode).toBe(0)
  })

  test('guards pass + assertion fail -> not_verified, assert evidence exitCode 1', async () => {
    const input = normalizeSafeBackfillInput({ ...PRE_RAW, afterWrite: true })
    const result = await runSafeBackfillAfterWrite(
      input,
      passingRunners({ runAssertion: async () => ({ ran: true, pass: false }) }),
      FIXED
    )
    expect(result.status).toBe('not_verified')
    expect(result.assertion).toEqual({ expect: 'value == 0', passed: false })
    expect(result.artifact.status).toBe('not_verified')
    const assertEv = result.artifact.evidence.find((e) => e.kind === 'assert')
    expect(assertEv?.exitCode).toBe(1)
  })

  test('failing guard -> blocked, artifact has blockedReason and no assert evidence', async () => {
    const input = normalizeSafeBackfillInput({ ...PRE_RAW, afterWrite: true })
    const result = await runSafeBackfillAfterWrite(
      input,
      passingRunners({
        planGuard: async () => ({ ok: false, reason: 'plan blocked the write (no WHERE)' }),
      }),
      FIXED
    )
    expect(result.status).toBe('blocked')
    expect(result.blockedReason).toContain('plan blocked the write')
    expect(result.artifact.status).toBe('blocked')
    expect(result.artifact.blockedReason).toContain('plan blocked the write')
    expect(result.artifact.evidence.some((e) => e.kind === 'assert')).toBe(false)
    expect(result.assertion).toBeUndefined()
  })

  test('assertion engine error (ran=false) -> indeterminate', async () => {
    const input = normalizeSafeBackfillInput({ ...PRE_RAW, afterWrite: true })
    const result = await runSafeBackfillAfterWrite(
      input,
      passingRunners({
        runAssertion: async () => ({ ran: false, reason: 'assert shape error: no scalar column' }),
      }),
      FIXED
    )
    expect(result.status).toBe('indeterminate')
    expect(result.artifact.status).toBe('indeterminate')
    expect(result.assertion).toBeUndefined()
  })

  test('--subject-name overrides the artifact subject name', async () => {
    const input = normalizeSafeBackfillInput({
      ...PRE_RAW,
      afterWrite: true,
      subjectName: 'nightly',
    })
    const result = await runSafeBackfillAfterWrite(input, passingRunners(), FIXED)
    expect(result.artifact.subject.name).toBe('nightly')
  })

  test('evidence carries no raw rows or connection details', async () => {
    const input = normalizeSafeBackfillInput({ ...PRE_RAW, afterWrite: true })
    const result = await runSafeBackfillAfterWrite(input, passingRunners(), FIXED)
    const blob = JSON.stringify(result.artifact.evidence)
    expect(blob).not.toContain('password')
    expect(blob).not.toContain('5432')
    // Only the assertion label is recorded, never executed result rows.
    expect(blob).not.toMatch(/"rows"\s*:/)
  })

  test('evidence never persists literal values from the verify-query or --expect', async () => {
    const input = normalizeSafeBackfillInput({
      ...PRE_RAW,
      afterWrite: true,
      verifyQuery: 'SELECT count(*)::int AS n FROM users WHERE id = 12345 AND token = $$topsecret$$',
      expect: "value == 'sensitive-literal'",
    })
    const result = await runSafeBackfillAfterWrite(input, passingRunners(), FIXED)
    const blob = JSON.stringify(result.artifact.evidence)
    expect(blob).not.toContain('12345')
    expect(blob).not.toContain('topsecret')
    expect(blob).not.toContain('sensitive-literal')
  })
})
