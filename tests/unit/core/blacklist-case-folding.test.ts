/**
 * One fold rule, every matcher — ADR-0020.
 *
 * The rows below are the table in ADR-0019's Consequences, measured again as
 * tests: before this record a rule and a field name were compared on their
 * whole path by the write side, on their first segment by the SQL and
 * Elasticsearch read side, and as written by MongoDB's read mask and request
 * check. A configuration could refuse a write and return the same field on the
 * read that followed.
 */
import { describe, test, expect } from 'bun:test'
import { BlacklistManager } from '@/core/blacklist-manager'
import { BlacklistValidator } from '@/core/blacklist-validator'
import { maskMongoRows } from '@/core/mongo/field-masker'
import { findProtectedFieldReference } from '@/core/mongo/request-fields'

const REDACTED = '[REDACTED]'

function validatorFor(rule: string): BlacklistValidator {
  const blacklist = { enabled: true, tables: [], columns: { users: [rule] } }
  return new BlacklistValidator(new BlacklistManager({ blacklist } as never))
}

function sqlReadMasks(rule: string, field: string): boolean {
  const result = validatorFor(rule).filterColumnsForTables(
    ['users'],
    [{ [field]: 'secret', id: 1 }],
    [field, 'id']
  )
  return JSON.stringify(result.filteredRows).includes(REDACTED) || result.omittedColumns.length > 0
}

function mongoReadMasks(rule: string, field: string): boolean {
  const segments = field.split('.')
  const doc: Record<string, unknown> = {}
  let cursor = doc
  segments.forEach((segment, index) => {
    if (index === segments.length - 1) cursor[segment] = 'secret'
    else cursor = cursor[segment] = {} as Record<string, unknown>
  })
  const blacklist = { enabled: true, tables: [], columns: { users: [rule] } }
  return JSON.stringify(maskMongoRows([{ _id: 1, ...doc }], 'users', blacklist)).includes(REDACTED)
}

function requestRefuses(rule: string, field: string): boolean {
  return (
    findProtectedFieldReference({ $project: { x: `$${field}` } }, new Set([rule])) !== undefined
  )
}

function writeRefuses(rule: string, field: string): boolean {
  try {
    validatorFor(rule).checkColumnBlacklistOnWrite('users', [field], 'WRITE')
    return false
  } catch {
    return true
  }
}

describe('a rule and a field name are compared case-insensitively everywhere', () => {
  const cases: Array<[string, string]> = [
    ['Password', 'password'],
    ['password', 'PASSWORD'],
    ['PASS*', 'password'],
    ['profile.ssn', 'profile.SSN'],
    ['profile.ss*', 'profile.SS_num'],
    ['PROFILE.*', 'profile.ssn'],
  ]

  test.each(cases)('rule %p protects %p on all four matchers', (rule, field) => {
    expect({
      sqlRead: sqlReadMasks(rule, field),
      mongoRead: mongoReadMasks(rule, field),
      request: requestRefuses(rule, field),
      write: writeRefuses(rule, field),
    }).toEqual({ sqlRead: true, mongoRead: true, request: true, write: true })
  })

  test('a name that is not the rule is still not protected', () => {
    expect(sqlReadMasks('password', 'passwordless')).toBe(false)
    expect(mongoReadMasks('password', 'passwordless')).toBe(false)
    expect(requestRefuses('password', 'passwordless')).toBe(false)
    expect(writeRefuses('password', 'passwordless')).toBe(false)
  })

  // A JSONB column arrives from PostgreSQL as an object, so the SQL read path
  // descends into it — the one place where a later segment is genuinely a
  // nested key rather than a SQL identifier, and the case ADR-0018 Decision 1
  // named as its reason for folding the first segment only.
  test('the nested descent on the SQL read path folds too', () => {
    const nestedMasks = (rule: string): boolean => {
      const result = validatorFor(rule).filterColumnsForTables(
        ['users'],
        [{ id: 1, profile: { SS_num: '111-22', city: 'tp' } }],
        ['id', 'profile']
      )
      return result.omittedColumns.length > 0
    }
    expect(nestedMasks('profile.SS_num')).toBe(true)
    expect(nestedMasks('profile.ss_num')).toBe(true)
    expect(nestedMasks('PROFILE.SS_num')).toBe(true)
    expect(nestedMasks('profile.city_name')).toBe(false)
  })

  test('isColumnBlacklisted folds the rule as well as the name', () => {
    const blacklist = { enabled: true, tables: [], columns: { users: ['Password'] } }
    const manager = new BlacklistManager({ blacklist } as never)
    expect(manager.isColumnBlacklisted('users', 'password')).toBe(true)
    expect(manager.isColumnBlacklisted('users', 'PASSWORD')).toBe(true)
    expect(manager.isColumnBlacklisted('users', 'note')).toBe(false)
  })
})
