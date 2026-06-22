import { describe, test, expect } from 'bun:test'
import {
  isSingleStatement,
  isAlterTableDdl,
  extractAlterTableTarget,
  ddlTargetMatchesTable,
  classifyMigrationDdl,
  classifyMigrationTarget,
} from '@/core/verify/migration'
import {
  normalizeMigrationInput,
  runMigrationPreflight,
  runMigrationAfterWrite,
  buildMigrationSubject,
  buildMigrationAfterWriteCommand,
  type MigrationRunners,
} from '@/core/verify/migration'
import { VerifyInputError, type GuardOutcome, type AssertionOutcome } from '@/core/verify/scenario'

describe('migration DDL classification', () => {
  test('isSingleStatement ignores a trailing semicolon and literals', () => {
    expect(isSingleStatement('ALTER TABLE users ADD COLUMN a int')).toBe(true)
    expect(isSingleStatement('ALTER TABLE users ADD COLUMN a int;')).toBe(true)
    expect(isSingleStatement("ALTER TABLE users ADD COLUMN a text DEFAULT 'a;b'")).toBe(true)
    expect(isSingleStatement('ALTER TABLE users ADD a int; DROP TABLE users')).toBe(false)
  })

  test('isAlterTableDdl accepts ALTER TABLE forms only', () => {
    expect(isAlterTableDdl('ALTER TABLE users ADD COLUMN a int')).toBe(true)
    expect(isAlterTableDdl('alter   table public.users add column a int')).toBe(true)
    expect(isAlterTableDdl('CREATE TABLE users (id int)')).toBe(false)
    expect(isAlterTableDdl('CREATE INDEX idx ON users (id)')).toBe(false)
    expect(isAlterTableDdl('DROP TABLE users')).toBe(false)
    expect(isAlterTableDdl('ALTER INDEX idx RENAME TO idx2')).toBe(false)
  })

  test('extractAlterTableTarget returns the qualified target', () => {
    expect(extractAlterTableTarget('ALTER TABLE users ADD a int')).toBe('users')
    expect(extractAlterTableTarget('ALTER TABLE public.users ADD a int')).toBe('public.users')
    expect(extractAlterTableTarget('ALTER TABLE IF EXISTS audit.users ADD a int')).toBe(
      'audit.users'
    )
    expect(extractAlterTableTarget('ALTER TABLE ONLY "Users" ADD a int')).toBe('"Users"')
    expect(extractAlterTableTarget('CREATE TABLE users (id int)')).toBeNull()
  })

  test('ddlTargetMatchesTable is schema-aware', () => {
    expect(ddlTargetMatchesTable('ALTER TABLE public.users ADD a int', 'public.users')).toBe(true)
    expect(ddlTargetMatchesTable('ALTER TABLE public.users ADD a int', 'audit.users')).toBe(false)
    expect(ddlTargetMatchesTable('ALTER TABLE users ADD a int', 'public.users')).toBe(true)
  })

  test('extractAlterTableTarget fully extracts common quoted identifier forms', () => {
    // double-quoted with spaces (previously truncated by the simple regex)
    expect(extractAlterTableTarget('ALTER TABLE "user accounts" ADD a int')).toBe('"user accounts"')
    // schema with a hyphen inside a double-quoted segment
    expect(extractAlterTableTarget('ALTER TABLE "tenant-1"."orders" ADD a int')).toBe(
      '"tenant-1"."orders"'
    )
    // mixed unquoted schema + quoted mixed-case table
    expect(extractAlterTableTarget('ALTER TABLE public."Users" ADD a int')).toBe('public."Users"')
    // backtick-quoted qualified target
    expect(extractAlterTableTarget('ALTER TABLE `tenant-data`.`orders` ADD a int')).toBe(
      '`tenant-data`.`orders`'
    )
    // bracket-quoted qualified target
    expect(extractAlterTableTarget('ALTER TABLE [tenant-data].[orders] ADD a int')).toBe(
      '[tenant-data].[orders]'
    )
    // whitespace around the dot is tolerated and normalized away
    expect(extractAlterTableTarget('ALTER TABLE public . users ADD a int')).toBe('public.users')
  })

  test('extractAlterTableTarget fails closed on unsupported identifier forms', () => {
    // more than three qualified parts
    expect(extractAlterTableTarget('ALTER TABLE a.b.c.d ADD x int')).toBeNull()
    // unterminated quoted identifier
    expect(extractAlterTableTarget('ALTER TABLE "orders ADD x int')).toBeNull()
    // unsupported escape: a backslash does not escape a double quote
    expect(extractAlterTableTarget('ALTER TABLE "a\\"b" ADD x int')).toBeNull()
    // unquoted identifier may not start with a digit
    expect(extractAlterTableTarget('ALTER TABLE 1table ADD x int')).toBeNull()
    // non-ALTER DDL never yields a target
    expect(extractAlterTableTarget('DROP TABLE users')).toBeNull()
  })

  test('ddlTargetMatchesTable handles quoted and schema-qualified mismatch', () => {
    expect(
      ddlTargetMatchesTable('ALTER TABLE "tenant-1"."orders" ADD a int', '"tenant-1"."orders"')
    ).toBe(true)
    expect(
      ddlTargetMatchesTable('ALTER TABLE "tenant-1"."orders" ADD a int', '"tenant-2"."orders"')
    ).toBe(false)
    expect(ddlTargetMatchesTable('ALTER TABLE "user accounts" ADD a int', 'user accounts')).toBe(
      true
    )
  })

  test('classifyMigrationTarget distinguishes unparsable targets from mismatches', () => {
    // matching target passes
    expect(classifyMigrationTarget('ALTER TABLE public.users ADD a int', 'public.users')).toEqual({
      ok: true,
    })
    // unparsable target -> contract reason, never a mismatch reason
    const unparsable = classifyMigrationTarget('ALTER TABLE "orders ADD a int', 'orders')
    expect(unparsable.ok).toBe(false)
    expect((unparsable as { reason: string }).reason).toContain('could not be parsed')
    expect((unparsable as { reason: string }).reason).not.toContain('must match')
    // extracted but different -> mismatch reason names both bounded identifiers
    const mismatch = classifyMigrationTarget('ALTER TABLE audit.users ADD a int', 'public.users')
    expect(mismatch.ok).toBe(false)
    expect((mismatch as { reason: string }).reason).toContain('must match --table')
    expect((mismatch as { reason: string }).reason).toContain('audit.users')
    // bounded reasons
    expect((unparsable as { reason: string }).reason.length).toBeLessThanOrEqual(200)
    expect((mismatch as { reason: string }).reason.length).toBeLessThanOrEqual(200)
  })

  test('classifyMigrationDdl blocks non-ALTER and multi-statement with bounded reasons', () => {
    expect(classifyMigrationDdl('ALTER TABLE users ADD a int')).toEqual({ ok: true })
    expect(classifyMigrationDdl('CREATE TABLE users (id int)').ok).toBe(false)
    expect(classifyMigrationDdl('DROP TABLE users').ok).toBe(false)
    expect(classifyMigrationDdl('CREATE INDEX idx ON users (id)').ok).toBe(false)
    expect(classifyMigrationDdl('ALTER TABLE users ADD a int; DROP TABLE users').ok).toBe(false)
    const reason = classifyMigrationDdl('CREATE TABLE users (id int)').reason ?? ''
    expect(reason.length).toBeGreaterThan(0)
    expect(reason.length).toBeLessThanOrEqual(200)
  })
})

const M_RAW = {
  table: 'users',
  ddl: 'ALTER TABLE users ADD COLUMN status int',
  verifyQuery: 'SELECT count(*)::int AS n FROM users WHERE status IS NULL',
  expect: 'value == 0',
}

const M_FIXED = {
  now: () => new Date('2026-06-20T00:00:00.000Z'),
  idFactory: () => 'ver_mig_0001',
}

function passingMigrationRunners(over: Partial<MigrationRunners> = {}): MigrationRunners {
  const ok = async (): Promise<GuardOutcome> => ({ ok: true })
  const assertOk = async (): Promise<AssertionOutcome> => ({ ran: true, pass: true })
  return {
    blacklistGuard: ok,
    schemaGuard: ok,
    ddlGuard: ok,
    verifyReadonlyGuard: ok,
    runAssertion: assertOk,
    ...over,
  }
}

describe('normalizeMigrationInput', () => {
  test('requires all four core flags', () => {
    expect(() => normalizeMigrationInput({ ...M_RAW, ddl: '   ' })).toThrow(VerifyInputError)
  })

  test('defaults format=table and afterWrite=false', () => {
    const input = normalizeMigrationInput({ ...M_RAW })
    expect(input.format).toBe('table')
    expect(input.afterWrite).toBe(false)
  })
})

describe('buildMigrationSubject / buildMigrationAfterWriteCommand', () => {
  test('subject kind is migration, name defaults to table', () => {
    expect(buildMigrationSubject(normalizeMigrationInput({ ...M_RAW }))).toEqual({
      kind: 'migration',
      name: 'users',
      command: 'verify migration',
    })
  })

  test('after-write command names the migration scenario and uses --ddl', () => {
    const cmd = buildMigrationAfterWriteCommand(normalizeMigrationInput({ ...M_RAW }))
    expect(cmd).toContain('dbcli verify migration')
    expect(cmd).toContain(`--ddl '${M_RAW.ddl}'`)
    expect(cmd).toContain('--after-write')
  })
})

describe('runMigrationPreflight', () => {
  test('all guards pass -> ready with four guards in order', async () => {
    const result = await runMigrationPreflight(
      normalizeMigrationInput({ ...M_RAW }),
      passingMigrationRunners()
    )
    expect(result.status).toBe('ready')
    expect(result.plannedDdl).toBe(M_RAW.ddl)
    expect(result.guards.map((g) => g.name)).toEqual([
      'blacklist',
      'schema',
      'ddl',
      'verify-query-readonly',
    ])
  })

  test('a failing ddl guard short-circuits the readonly guard', async () => {
    const result = await runMigrationPreflight(
      normalizeMigrationInput({ ...M_RAW }),
      passingMigrationRunners({
        ddlGuard: async () => ({ ok: false, reason: 'must be an ALTER TABLE statement' }),
      })
    )
    expect(result.status).toBe('blocked')
    expect(result.guards.map((g) => g.name)).toEqual(['blacklist', 'schema', 'ddl'])
  })
})

describe('runMigrationAfterWrite', () => {
  test('guards pass + assertion pass -> verified, migration subject, task-pack-plan evidence', async () => {
    const result = await runMigrationAfterWrite(
      normalizeMigrationInput({ ...M_RAW, afterWrite: true }),
      passingMigrationRunners(),
      M_FIXED
    )
    expect(result.status).toBe('verified')
    expect(result.artifact.subject.kind).toBe('migration')
    const tpp = result.artifact.evidence.find((e) => e.kind === 'task-pack-plan')
    expect(tpp?.taskName).toBe('migration-review')
    expect(result.artifact.evidence.some((e) => e.kind === 'assert')).toBe(true)
  })

  test('assertion fail -> not_verified', async () => {
    const result = await runMigrationAfterWrite(
      normalizeMigrationInput({ ...M_RAW, afterWrite: true }),
      passingMigrationRunners({ runAssertion: async () => ({ ran: true, pass: false }) }),
      M_FIXED
    )
    expect(result.status).toBe('not_verified')
  })

  test('failing guard -> blocked with blockedReason and no assert evidence', async () => {
    const result = await runMigrationAfterWrite(
      normalizeMigrationInput({ ...M_RAW, afterWrite: true }),
      passingMigrationRunners({
        ddlGuard: async () => ({ ok: false, reason: 'CREATE blocked in MVP' }),
      }),
      M_FIXED
    )
    expect(result.status).toBe('blocked')
    expect(result.artifact.blockedReason).toContain('CREATE blocked')
    expect(result.artifact.evidence.some((e) => e.kind === 'assert')).toBe(false)
  })

  test('evidence never persists raw ddl/verify-query/expect literals', async () => {
    const result = await runMigrationAfterWrite(
      normalizeMigrationInput({
        ...M_RAW,
        afterWrite: true,
        ddl: "ALTER TABLE users ADD COLUMN token text DEFAULT 'topsecret'",
        verifyQuery: 'SELECT count(*)::int AS n FROM users WHERE id = 12345',
        expect: "value == 'sensitive-literal'",
      }),
      passingMigrationRunners(),
      M_FIXED
    )
    const blob = JSON.stringify(result.artifact.evidence)
    expect(blob).not.toContain('topsecret')
    expect(blob).not.toContain('12345')
    expect(blob).not.toContain('sensitive-literal')
  })
})
