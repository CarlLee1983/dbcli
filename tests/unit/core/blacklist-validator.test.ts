/**
 * BlacklistValidator unit tests
 */

import { describe, it, expect, spyOn } from 'bun:test'
import { BlacklistManager } from '@/core/blacklist-manager'
import { BlacklistValidator } from '@/core/blacklist-validator'
import { BlacklistError } from '@/types/blacklist'
import type { DbcliConfig } from '@/types'

const baseConfig: DbcliConfig = {
  connection: {
    system: 'postgresql',
    host: 'localhost',
    port: 5432,
    user: 'user',
    password: 'pass',
    database: 'testdb',
  },
  permission: 'query-only',
}

function makeConfig(blacklist?: any): any {
  return { ...baseConfig, blacklist }
}

function makeValidator(blacklist?: any, overrideEnv?: string): BlacklistValidator {
  const manager = new BlacklistManager(makeConfig(blacklist), overrideEnv)
  return new BlacklistValidator(manager)
}

describe('BlacklistValidator', () => {
  describe('checkTableBlacklist()', () => {
    it('allows non-blacklisted table without throwing', () => {
      const validator = makeValidator({ tables: ['secrets'], columns: {} })
      expect(() => validator.checkTableBlacklist('SELECT', 'users', [])).not.toThrow()
    })

    it('throws BlacklistError for SELECT on blacklisted table', () => {
      const validator = makeValidator({ tables: ['audit_logs'], columns: {} })
      expect(() => validator.checkTableBlacklist('SELECT', 'audit_logs', [])).toThrow(
        BlacklistError
      )
    })

    it('throws BlacklistError for INSERT on blacklisted table', () => {
      const validator = makeValidator({ tables: ['audit_logs'], columns: {} })
      expect(() => validator.checkTableBlacklist('INSERT', 'audit_logs', [])).toThrow(
        BlacklistError
      )
    })

    it('throws BlacklistError for UPDATE on blacklisted table', () => {
      const validator = makeValidator({ tables: ['audit_logs'], columns: {} })
      expect(() => validator.checkTableBlacklist('UPDATE', 'audit_logs', [])).toThrow(
        BlacklistError
      )
    })

    it('throws BlacklistError for DELETE on blacklisted table', () => {
      const validator = makeValidator({ tables: ['audit_logs'], columns: {} })
      expect(() => validator.checkTableBlacklist('DELETE', 'audit_logs', [])).toThrow(
        BlacklistError
      )
    })

    it('error message includes table name and operation', () => {
      const validator = makeValidator({ tables: ['audit_logs'], columns: {} })
      try {
        validator.checkTableBlacklist('SELECT', 'audit_logs', [])
        expect(true).toBe(false) // should not reach
      } catch (e) {
        expect(e).toBeInstanceOf(BlacklistError)
        const err = e as BlacklistError
        expect(err.message).toContain('audit_logs')
        expect(err.message).toContain('SELECT')
        expect(err.tableName).toBe('audit_logs')
        expect(err.operation).toBe('SELECT')
      }
    })

    it('allows operation on blacklisted table when override is enabled', () => {
      const validator = makeValidator({ tables: ['audit_logs'], columns: {} }, 'true')
      // Should not throw
      expect(() => validator.checkTableBlacklist('SELECT', 'audit_logs', [])).not.toThrow()
    })
  })

  describe('checkColumnBlacklistOnWrite()', () => {
    it('does not throw when no fields intersect blacklist', () => {
      const validator = makeValidator({ tables: [], columns: { users: ['password'] } })
      expect(() =>
        validator.checkColumnBlacklistOnWrite('users', ['name', 'email'], 'INSERT')
      ).not.toThrow()
    })

    it('throws BlacklistError when fields intersect blacklist', () => {
      const validator = makeValidator({ tables: [], columns: { users: ['password', 'api_key'] } })
      try {
        validator.checkColumnBlacklistOnWrite('users', ['name', 'password'], 'INSERT')
        expect(true).toBe(false)
      } catch (e) {
        expect(e).toBeInstanceOf(BlacklistError)
        const err = e as BlacklistError
        expect(err.message).toContain('users')
        expect(err.message).toContain('INSERT')
        expect(err.message).toContain('password')
        expect(err.tableName).toBe('users')
        expect(err.operation).toBe('INSERT')
      }
    })

    it('lists all conflicting columns in the error message', () => {
      const validator = makeValidator({ tables: [], columns: { users: ['password', 'api_key'] } })
      try {
        validator.checkColumnBlacklistOnWrite('users', ['name', 'password', 'api_key'], 'UPDATE')
        expect(true).toBe(false)
      } catch (e) {
        const err = e as BlacklistError
        expect(err.message).toContain('password')
        expect(err.message).toContain('api_key')
      }
    })

    it('does not throw when override is enabled (warning path)', () => {
      const validator = makeValidator({ tables: [], columns: { users: ['password'] } }, 'true')
      const errSpy = spyOn(console, 'error').mockImplementation(() => {})
      try {
        expect(() =>
          validator.checkColumnBlacklistOnWrite('users', ['password'], 'INSERT')
        ).not.toThrow()
        expect(errSpy).toHaveBeenCalled()
      } finally {
        errSpy.mockRestore()
      }
    })

    it('returns silently when table has no column blacklist', () => {
      const validator = makeValidator({ tables: [], columns: {} })
      expect(() =>
        validator.checkColumnBlacklistOnWrite('users', ['password'], 'INSERT')
      ).not.toThrow()
    })

    it('returns silently when fields list is empty', () => {
      const validator = makeValidator({ tables: [], columns: { users: ['password'] } })
      expect(() => validator.checkColumnBlacklistOnWrite('users', [], 'INSERT')).not.toThrow()
    })
  })

  describe('filterColumns()', () => {
    it('returns all columns for non-blacklisted table', () => {
      const validator = makeValidator({ tables: [], columns: {} })
      const rows = [{ id: 1, name: 'Alice', email: 'alice@example.com' }]
      const { filteredRows, omittedColumns } = validator.filterColumns('users', rows, [
        'id',
        'name',
        'email',
      ])
      expect(filteredRows).toEqual(rows)
      expect(omittedColumns).toEqual([])
    })

    it('removes one blacklisted column correctly', () => {
      const validator = makeValidator({ tables: [], columns: { users: ['password'] } })
      const rows = [{ id: 1, name: 'Alice', password: 'secret' }]
      const { filteredRows, omittedColumns } = validator.filterColumns('users', rows, [
        'id',
        'name',
        'password',
      ])
      expect(omittedColumns).toEqual(['password'])
      expect(filteredRows[0]).not.toHaveProperty('password')
      expect(filteredRows[0]).toHaveProperty('id', 1)
      expect(filteredRows[0]).toHaveProperty('name', 'Alice')
    })

    it('removes multiple blacklisted columns', () => {
      const validator = makeValidator({ tables: [], columns: { users: ['password', 'api_key'] } })
      const rows = [{ id: 1, name: 'Alice', password: 'secret', api_key: 'key123' }]
      const { filteredRows, omittedColumns } = validator.filterColumns('users', rows, [
        'id',
        'name',
        'password',
        'api_key',
      ])
      expect(omittedColumns).toContain('password')
      expect(omittedColumns).toContain('api_key')
      expect(omittedColumns.length).toBe(2)
      expect(filteredRows[0]).not.toHaveProperty('password')
      expect(filteredRows[0]).not.toHaveProperty('api_key')
    })

    it('handles empty rows array', () => {
      const validator = makeValidator({ tables: [], columns: { users: ['password'] } })
      const { filteredRows, omittedColumns } = validator.filterColumns(
        'users',
        [],
        ['id', 'password']
      )
      expect(filteredRows).toEqual([])
      expect(omittedColumns).toEqual(['password'])
    })

    it('preserves row data integrity (immutable - does not mutate original)', () => {
      const validator = makeValidator({ tables: [], columns: { users: ['password'] } })
      const originalRows = [{ id: 1, name: 'Alice', password: 'secret' }]
      const rowsCopy = JSON.parse(JSON.stringify(originalRows))
      validator.filterColumns('users', originalRows, ['id', 'name', 'password'])
      // Original rows should not be mutated
      expect(originalRows).toEqual(rowsCopy)
    })
  })

  describe('buildSecurityNotification()', () => {
    it('returns empty string when no columns omitted', () => {
      const validator = makeValidator({ tables: [], columns: {} })
      const notification = validator.buildSecurityNotification('users', [])
      expect(notification).toBe('')
    })

    it('returns notification with count=1', () => {
      const validator = makeValidator({ tables: [], columns: {} })
      const notification = validator.buildSecurityNotification('users', ['password'])
      expect(notification).toContain('1')
      expect(notification.length).toBeGreaterThan(0)
    })

    it('returns notification with count=2+', () => {
      const validator = makeValidator({ tables: [], columns: {} })
      const notification = validator.buildSecurityNotification('users', ['password', 'api_key'])
      expect(notification).toContain('2')
    })

    it('uses i18n t_vars() (returns non-empty string for omitted columns)', () => {
      const validator = makeValidator({ tables: [], columns: {} })
      const notification = validator.buildSecurityNotification('users', ['password'])
      // Should be a proper i18n message, not just the key
      expect(notification).not.toBe('security.columns_omitted')
    })
  })
  describe('filterColumns() against a flattened result set', () => {
    // The Elasticsearch adapter flattens `_source` recursively
    // (`elasticsearch-adapter.ts:72`), so a document `{ profile: { email, ssn } }`
    // reaches the validator as the keys `profile.email` and `profile.ssn` — there is
    // no `profile` key at all. Blacklisting the parent has to still protect them.
    const flattenedRows = [
      { id: 1, 'profile.email': 'a@example.com', 'profile.ssn': '123', keep: 'ok' },
    ]
    const flattenedColumns = ['id', 'profile.email', 'profile.ssn', 'keep']

    it('omits flattened children when the parent column is blacklisted', () => {
      const validator = makeValidator({ tables: [], columns: { logs: ['profile'] } })

      const result = validator.filterColumns('logs', flattenedRows, flattenedColumns)

      expect(result.omittedColumns.sort()).toEqual(['profile.email', 'profile.ssn'])
      expect(result.filteredRows[0]).toEqual({ id: 1, keep: 'ok' })
    })

    it('reports the omission so the security notification is not silent', () => {
      const validator = makeValidator({ tables: [], columns: { logs: ['profile'] } })

      const result = validator.filterColumns('logs', flattenedRows, flattenedColumns)

      // An empty list means no notification is emitted — the data would leave
      // without the caller ever being told something was supposed to be hidden.
      expect(result.omittedColumns.length).toBeGreaterThan(0)
      expect(validator.buildSecurityNotification('logs', result.omittedColumns)).not.toBe('')
    })

    it('does not treat a merely prefixed column name as a child', () => {
      const validator = makeValidator({ tables: [], columns: { logs: ['profile'] } })
      const rows = [{ profileId: 7, profile_name: 'x', profiles: 'y' }]

      const result = validator.filterColumns('logs', rows, [
        'profileId',
        'profile_name',
        'profiles',
      ])

      expect(result.omittedColumns).toEqual([])
      expect(result.filteredRows[0]).toEqual({ profileId: 7, profile_name: 'x', profiles: 'y' })
    })

    it('finds a protected field that appears only in a later row', () => {
      // Elasticsearch documents are sparse and `columnList` is usually taken from
      // the first row, so a field that shows up further down must still be caught.
      const validator = makeValidator({ tables: [], columns: { logs: ['profile'] } })
      const rows = [{ id: 1 }, { id: 2 }, { id: 3, 'profile.ssn': '123' }]

      const result = validator.filterColumns('logs', rows, ['id'])

      expect(result.omittedColumns).toEqual(['profile.ssn'])
      expect(result.filteredRows[2]).toEqual({ id: 3 })
    })

    it('works with an empty column list', () => {
      const validator = makeValidator({ tables: [], columns: { logs: ['profile'] } })

      const result = validator.filterColumns('logs', [{ 'profile.ssn': '123' }], [])

      expect(result.omittedColumns).toEqual(['profile.ssn'])
      expect(result.filteredRows[0]).toEqual({})
    })

    it('matches at every ancestor depth', () => {
      const rows = [{ 'a.b.c': 'secret', 'a.x': 'also secret', keep: 1 }]
      const columns = ['a.b.c', 'a.x', 'keep']

      const byRoot = makeValidator({ tables: [], columns: { logs: ['a'] } })
      expect(byRoot.filterColumns('logs', rows, columns).filteredRows[0]).toEqual({ keep: 1 })

      const byMiddle = makeValidator({ tables: [], columns: { logs: ['a.b'] } })
      expect(byMiddle.filterColumns('logs', rows, columns).filteredRows[0]).toEqual({
        'a.x': 'also secret',
        keep: 1,
      })
    })

    it('normalises a null row instead of throwing or passing null downstream', () => {
      // Passing the row through only moved the throw: callers index into every row.
      const validator = makeValidator({ tables: [], columns: { logs: ['profile'] } })
      const rows = [null as any, { 'profile.ssn': '1', keep: 2 }]

      const result = validator.filterColumns('logs', rows, [])

      expect(result.filteredRows).toEqual([{}, { keep: 2 }])
      expect(result.filteredRows[0]).not.toBeNull()
    })

    it('an empty blacklist entry does not swallow dot-prefixed columns', () => {
      const validator = makeValidator({ tables: [], columns: { logs: ['', 'a'] } })

      const result = validator.filterColumns('logs', [{ '.x': 1, 'a.b': 2, keep: 3 }], [])

      expect(result.omittedColumns).toEqual(['a.b'])
      expect(result.filteredRows[0]).toEqual({ '.x': 1, keep: 3 })
    })

    it('matches ancestors of a column name that starts with a dot', () => {
      // Elasticsearch permits a leading dot in a field name and `flattenSource`
      // concatenates it verbatim, so `.profile.ssn` is a reachable column name.
      const validator = makeValidator({ tables: [], columns: { logs: ['.profile'] } })

      const result = validator.filterColumns('logs', [{ '.profile.ssn': 'S', keep: 1 }], [])

      expect(result.omittedColumns).toEqual(['.profile.ssn'])
      expect(result.filteredRows[0]).toEqual({ keep: 1 })
    })

    it('KNOWN CEILING: a rule naming a leaf does not match it inside a flattened path', () => {
      // Blacklisting `ssn` does NOT protect a flattened `profile.ssn`. Matching any
      // segment would close it, but it would also mean a rule for `id` hides
      // `user.id`, `order.id`, and every other qualified column — over-blocking wide
      // enough to make the feature unusable. `dbcli schema` reports Elasticsearch
      // fields with their dotted names, so the documented workflow yields the path
      // that does work. Pinned so the trade-off is a decision, not a surprise.
      const validator = makeValidator({ tables: [], columns: { logs: ['ssn'] } })

      const result = validator.filterColumns(
        'logs',
        [{ id: 1, 'profile.ssn': 'S' }],
        ['id', 'profile.ssn']
      )

      expect(result.omittedColumns).toEqual([])
    })

    it('KNOWN CEILING: a rule matches ancestors only from the start of the path', () => {
      // `profile` does not reach `data.profile.ssn` — same trade-off as above.
      const validator = makeValidator({ tables: [], columns: { logs: ['profile'] } })

      const result = validator.filterColumns('logs', [{ 'data.profile.ssn': 'S' }], [])

      expect(result.omittedColumns).toEqual([])
    })

    it('still omits the nested representation when both forms are present', () => {
      const validator = makeValidator({ tables: [], columns: { logs: ['profile'] } })
      const rows = [{ id: 1, 'profile.email': 'flat', profile: { email: 'nested' } }]

      const result = validator.filterColumns('logs', rows, ['id', 'profile.email', 'profile'])

      expect(result.filteredRows[0]).toEqual({ id: 1 })
    })
  })

  describe('checkTablesBlacklist / filterColumnsForTables (issue #23)', () => {
    it('blocks when any table in the list is blacklisted', () => {
      const validator = makeValidator({ tables: ['users'], columns: {} })
      expect(() => validator.checkTablesBlacklist('SELECT', ['orders', 'users'])).toThrow(
        BlacklistError
      )
    })

    it('names every blocked table in the message', () => {
      const validator = makeValidator({ tables: ['users', 'secrets'], columns: {} })
      try {
        validator.checkTablesBlacklist('SELECT', ['orders', 'users', 'secrets'])
        throw new Error('expected a BlacklistError')
      } catch (error) {
        expect((error as BlacklistError).message).toContain('users')
        expect((error as BlacklistError).message).toContain('secrets')
      }
    })

    it('allows a list with no blacklisted table', () => {
      const validator = makeValidator({ tables: ['users'], columns: {} })
      expect(() => validator.checkTablesBlacklist('SELECT', ['orders', 'items'])).not.toThrow()
    })

    it('matches table names case-insensitively', () => {
      const validator = makeValidator({ tables: ['users'], columns: {} })
      expect(() => validator.checkTablesBlacklist('SELECT', ['ORDERS', 'Users'])).toThrow(
        BlacklistError
      )
    })

    it('does nothing for an empty list', () => {
      const validator = makeValidator({ tables: ['users'], columns: {} })
      expect(() => validator.checkTablesBlacklist('SELECT', [])).not.toThrow()
    })

    it('omits a column blacklisted on any referenced table', () => {
      const validator = makeValidator({ tables: [], columns: { users: ['password_hash'] } })
      const rows = [{ id: 1, password_hash: 'secret' }]
      const result = validator.filterColumnsForTables(['orders', 'users'], rows, [
        'id',
        'password_hash',
      ])

      expect(result.omittedColumns).toEqual(['password_hash'])
      expect(result.filteredRows[0]).not.toHaveProperty('password_hash')
      // The input is not mutated.
      expect(rows[0]).toHaveProperty('password_hash')
    })

    it('unions the rules of several referenced tables', () => {
      const validator = makeValidator({
        tables: [],
        columns: { users: ['password_hash'], orders: ['card_number'] },
      })
      const result = validator.filterColumnsForTables(
        ['orders', 'users'],
        [{ id: 1, password_hash: 'a', card_number: 'b' }],
        ['id', 'password_hash', 'card_number']
      )

      expect(result.omittedColumns.sort()).toEqual(['card_number', 'password_hash'])
    })

    it('applies every column rule when no table could be identified', () => {
      // An empty reference list means the scan could not name a table, not
      // that the statement has no rules. Returning the rows unfiltered would
      // turn any parse gap into a disclosure, so the union of every rule is
      // applied instead.
      const validator = makeValidator({ tables: [], columns: { users: ['password_hash'] } })
      const result = validator.filterColumnsForTables(
        [],
        [{ id: 1, password_hash: 'secret' }],
        ['id', 'password_hash']
      )

      expect(result.omittedColumns).toEqual(['password_hash'])
      expect(result.filteredRows[0]).not.toHaveProperty('password_hash')
    })

    it('leaves rows alone when no referenced table has column rules', () => {
      const validator = makeValidator({ tables: [], columns: { users: ['password_hash'] } })
      const result = validator.filterColumnsForTables(
        ['orders'],
        [{ id: 1, password_hash: 'secret' }],
        ['id', 'password_hash']
      )

      expect(result.omittedColumns).toEqual([])
    })
  })
  /**
   * `--index` is an Elasticsearch *expression*, not a name. Every spelling
   * below reached a blacklisted index while matching no entry by equality.
   */
  describe('checkIndexBlacklist / filterColumnsForIndexExpression', () => {
    const validator = () =>
      makeValidator({ tables: ['secrets'], columns: { users: ['password_hash'] } })

    const refused = [
      'secrets',
      'secrets,orders',
      'orders,secrets',
      '*',
      'sec*',
      '_all',
      '<secrets>',
      'cluster:secrets',
      '*:secrets',
      '%2A',
      '-secrets',
    ]

    for (const target of refused) {
      it(`refuses --index ${target}`, () => {
        expect(() => validator().checkIndexBlacklist('SELECT', target)).toThrow(BlacklistError)
      })
    }

    const alsoRefused = [
      '%252A',
      '_ALL',
      'SECRETS',
      '<<secrets>>',
      'c:d:secrets',
      ':secrets',
      'secrets:',
      ',secrets',
      'secrets,',
      '  secrets  ',
      'a,_all',
    ]

    for (const target of alsoRefused) {
      it(`refuses --index ${JSON.stringify(target)}`, () => {
        expect(() => validator().checkIndexBlacklist('SELECT', target)).toThrow(BlacklistError)
      })
    }

    it('masks for an uppercase _ALL and a double-encoded wildcard', () => {
      for (const target of ['_ALL', '%252A', 'USERS']) {
        expect(
          validator().filterColumnsForIndexExpression(
            target,
            [{ id: 1, password_hash: 'HUNTER2' }],
            ['id', 'password_hash']
          ).omittedColumns
        ).toEqual(['password_hash'])
      }
    })

    it('allows an expression that cannot resolve to a blacklisted index', () => {
      // `<secrets-{now/d}>` resolves to `secrets-<date>`, a different index.
      for (const target of ['orders', 'logs-*', 'secrets-*', 'orders,logs', '<secrets-{now/d}>']) {
        expect(() => validator().checkIndexBlacklist('SELECT', target)).not.toThrow()
      }
    })

    it('does not throw a SyntaxError out of the check on a hostile pattern', () => {
      // `[\]*` is not a valid character class; building it into a RegExp threw
      // out of the security check instead of answering it. Read literally it
      // cannot match `secrets`, so the answer is "allowed" — what matters is
      // that an answer is produced.
      expect(() => validator().checkIndexBlacklist('SELECT', '[\\]*')).not.toThrow()
      // A class that can match is still refused.
      expect(() => validator().checkIndexBlacklist('SELECT', '[a-z]*')).toThrow(BlacklistError)
    })

    it('masks for a wildcard or comma expression, not only an exact name', () => {
      // The table check passing is not enough: when only columns are
      // blacklisted, equality against the raw expression matched no rule and
      // returned every protected field.
      for (const target of ['users', 'us*', 'users,orders', '_all']) {
        const result = validator().filterColumnsForIndexExpression(
          target,
          [{ id: 1, password_hash: 'HUNTER2' }],
          ['id', 'password_hash']
        )
        expect(result.omittedColumns).toEqual(['password_hash'])
      }
    })

    it('leaves an unrelated index alone', () => {
      const result = validator().filterColumnsForIndexExpression(
        'orders',
        [{ id: 1, password_hash: 'HUNTER2' }],
        ['id', 'password_hash']
      )
      expect(result.omittedColumns).toEqual([])
    })
  })
})
