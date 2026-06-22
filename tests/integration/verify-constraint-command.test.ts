import { describe, test, expect } from 'bun:test'
import {
  normalizeConstraintInput,
  runConstraintAfterWrite,
  type ConstraintRunners,
  type GuardOutcome,
  type ViolationCountOutcome,
} from '@/core/verify'
import { VERIFICATION_ARTIFACT_SCHEMA_VERSION } from '@/core/verification'

const FIXED = { now: () => new Date('2026-06-22T00:00:00.000Z'), idFactory: () => 'ver_ct_ctr1' }

function runners(over: Partial<ConstraintRunners> = {}): ConstraintRunners {
  const ok = async (): Promise<GuardOutcome> => ({ ok: true })
  return {
    violationSql: 'SELECT COUNT(*) AS violation_count FROM "orders" AS c LEFT JOIN "users" AS p ON c."user_id" = p."id" WHERE c."user_id" IS NOT NULL AND p."id" IS NULL',
    blacklistGuard: ok,
    schemaGuard: ok,
    violationReadonlyGuard: ok,
    runViolationCount: async (): Promise<ViolationCountOutcome> => ({ ran: true, count: 0, auditRef: null }),
    ...over,
  }
}

describe('verify constraint artifact contract', () => {
  test('reuses the table subject and does not bump the artifact version', async () => {
    const input = normalizeConstraintInput({
      check: 'fk',
      table: 'orders',
      column: ['user_id'],
      references: 'users.id',
    })
    const r = await runConstraintAfterWrite(input, runners(), FIXED)
    expect(r.artifact.subject).toEqual({ kind: 'table', name: 'orders', command: 'verify constraint' })
    expect(r.artifact.schemaVersion).toBe(VERIFICATION_ARTIFACT_SCHEMA_VERSION)
    expect(r.status).toBe('verified')
  })

  test('evidence redacts the violation SQL and records the threshold', async () => {
    const input = normalizeConstraintInput({ check: 'not-null', table: 'users', column: ['email'] })
    const r = await runConstraintAfterWrite(
      input,
      runners({
        violationSql: "SELECT COUNT(*) AS violation_count FROM users WHERE email = 'secret@x.io'",
        runViolationCount: async () => ({ ran: true, count: 1, auditRef: null }),
      }),
      FIXED
    )
    expect(r.status).toBe('not_verified')
    const assertEvidence = r.artifact.evidence.find((e) => e.kind === 'assert')
    expect(assertEvidence?.command).toContain('constraint:not-null')
    expect(assertEvidence?.command).not.toContain('secret@x.io')
  })
})
