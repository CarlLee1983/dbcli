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
    // 希臘文尾字 sigma：`foldFieldPath` 折整串，`Σ` 在非字母前變 `ς`；
    // `globMatches` 逐字折，同一個 `Σ` 變 `σ`。一份設定兩種折疊，而分歧
    // 落在 fail-open 的那一邊——規則指名的欄位原文回傳。
    ['ΑΣ*', 'ΑΣ_num'],
    ['*ΑΣ', 'user_ΑΣ'],
    // U+0130 小寫成兩個碼元（`i` + U+0307）。整串折得到兩個碼元，逐字折的
    // token 卻仍佔一格，於是固定寬度的比對永遠對不齊。
    ['İ*', 'İd'],
  ]

  test.each(cases)('rule %p protects %p on all four matchers', (rule, field) => {
    expect({
      sqlRead: sqlReadMasks(rule, field),
      mongoRead: mongoReadMasks(rule, field),
      request: requestRefuses(rule, field),
      write: writeRefuses(rule, field),
    }).toEqual({ sqlRead: true, mongoRead: true, request: true, write: true })
  })

  // A pattern's *text* must never be lower-cased: `[A-z]` folded to `[a-z]`
  // loses the six ASCII characters between `Z` and `a`, so the rule quietly
  // protects less than it says. ADR-0020 Decision 2. This branch broke it on
  // the SQL read and write sides before the rule was folded inside the matcher
  // instead — `profile._sn` came back in full with an empty `omittedColumns`.
  test('a character class in a rule is not narrowed by folding', () => {
    const result = validatorFor('profile.[A-z]sn').filterColumnsForTables(
      ['users'],
      [{ id: 1, 'profile._sn': 'plain' }],
      ['id', 'profile._sn']
    )
    expect(result.omittedColumns).toEqual(['profile._sn'])
    expect(JSON.stringify(result.filteredRows)).not.toContain('plain')
  })

  test('a character class rule refuses the same write it masks', () => {
    expect(writeRefuses('[A-z]assword', '_assword')).toBe(true)
    expect(mongoReadMasks('[A-z]assword', '_assword')).toBe(true)
    expect(requestRefuses('[A-z]assword', '_assword')).toBe(true)
    expect(sqlReadMasks('[A-z]assword', '_assword')).toBe(true)
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

  // Same defect on the table side: entries are stored lower-cased for the exact
  // lookup, and the glob scan used to read them from there.
  // Both columns are masked either way; the notification is the operator's only
  // evidence the blacklist worked, and the caller filters its header row by
  // exact name, so a name left out of it comes back as an empty column.
  test('every column a rule folds onto is reported, not just one', () => {
    const result = validatorFor('password').filterColumnsForTables(
      ['users'],
      [{ id: 1, Password: 'a', password: 'b' }],
      ['id', 'Password', 'password']
    )
    expect(result.omittedColumns.sort()).toEqual(['Password', 'password'])
    expect(JSON.stringify(result.filteredRows)).toBe('[{"id":1}]')
  })

  test('a table rule with a character class is not narrowed by folding', () => {
    const manager = new BlacklistManager({
      blacklist: { enabled: true, tables: ['[A-z]og-secrets*'], columns: {} },
    } as never)
    expect(manager.isTableBlacklisted('_og-secrets-1')).toBe(true)
    expect(manager.isTableBlacklisted('LOG-SECRETS-1')).toBe(true)
    expect(manager.isTableBlacklisted('orders')).toBe(false)
  })

  test('isColumnBlacklisted folds the rule as well as the name', () => {
    const blacklist = { enabled: true, tables: [], columns: { users: ['Password'] } }
    const manager = new BlacklistManager({ blacklist } as never)
    expect(manager.isColumnBlacklisted('users', 'password')).toBe(true)
    expect(manager.isColumnBlacklisted('users', 'PASSWORD')).toBe(true)
    expect(manager.isColumnBlacklisted('users', 'note')).toBe(false)
  })

  // This answers the schema summary an agent reads. Consulting only the literal
  // rules listed a column the read mask redacts — one rule, two answers.
  test('isColumnBlacklisted answers wildcard rules too', () => {
    const blacklist = { enabled: true, tables: [], columns: { users: ['PASS*'] } }
    const manager = new BlacklistManager({ blacklist } as never)
    expect(manager.isColumnBlacklisted('users', 'password')).toBe(true)
    expect(manager.isColumnBlacklisted('users', 'Password_hash')).toBe(true)
    expect(manager.isColumnBlacklisted('users', 'note')).toBe(false)
  })
})
