/**
 * BlacklistManager unit tests
 */

import { describe, it, expect } from 'bun:test'
import { BlacklistManager } from '@/core/blacklist-manager'
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

describe('BlacklistManager', () => {
  describe('loadBlacklist()', () => {
    it('returns empty state when no blacklist config', () => {
      const manager = new BlacklistManager(baseConfig)
      const state = manager.getState()
      expect(state.tables.size).toBe(0)
      expect(state.columns.size).toBe(0)
    })

    it('loads populated table blacklist correctly', () => {
      const config = makeConfig({ tables: ['users', 'audit_logs'], columns: {} })
      const manager = new BlacklistManager(config)
      expect(manager.isTableBlacklisted('users')).toBe(true)
      expect(manager.isTableBlacklisted('audit_logs')).toBe(true)
    })

    it('loads populated column blacklist correctly', () => {
      const config = makeConfig({
        tables: [],
        columns: { users: ['password', 'api_key'] },
      })
      const manager = new BlacklistManager(config)
      expect(manager.isColumnBlacklisted('users', 'password')).toBe(true)
      expect(manager.isColumnBlacklisted('users', 'api_key')).toBe(true)
    })
  })

  describe('isTableBlacklisted()', () => {
    it('returns true for exact match', () => {
      const config = makeConfig({ tables: ['secrets'], columns: {} })
      const manager = new BlacklistManager(config)
      expect(manager.isTableBlacklisted('secrets')).toBe(true)
    })

    it('returns false for non-blacklisted table', () => {
      const config = makeConfig({ tables: ['secrets'], columns: {} })
      const manager = new BlacklistManager(config)
      expect(manager.isTableBlacklisted('users')).toBe(false)
    })

    // ADR-0019 Decision 4: the same array is a glob for every engine.
    it('matches a glob entry against a concrete name', () => {
      const config = makeConfig({ tables: ['secrets*'], columns: {} })
      const manager = new BlacklistManager(config)
      expect(manager.isTableBlacklisted('secrets_2026')).toBe(true)
      expect(manager.isTableBlacklisted('secrets')).toBe(true)
      expect(manager.isTableBlacklisted('public_orders')).toBe(false)
    })

    it('folds case on both sides of a glob entry', () => {
      const config = makeConfig({ tables: ['Sec*'], columns: {} })
      const manager = new BlacklistManager(config)
      expect(manager.isTableBlacklisted('SECRETS')).toBe(true)
    })

    it('treats an escaped star as a literal name', () => {
      const config = makeConfig({ tables: ['report\\*'], columns: {} })
      const manager = new BlacklistManager(config)
      expect(manager.isTableBlacklisted('report*')).toBe(true)
      expect(manager.isTableBlacklisted('reports')).toBe(false)
    })

    it('is case-insensitive for table names', () => {
      const config = makeConfig({ tables: ['Users'], columns: {} })
      const manager = new BlacklistManager(config)
      expect(manager.isTableBlacklisted('users')).toBe(true)
      expect(manager.isTableBlacklisted('USERS')).toBe(true)
      expect(manager.isTableBlacklisted('Users')).toBe(true)
    })
  })

  describe('isColumnBlacklisted()', () => {
    it('returns true for exact column match', () => {
      const config = makeConfig({
        tables: [],
        columns: { users: ['password'] },
      })
      const manager = new BlacklistManager(config)
      expect(manager.isColumnBlacklisted('users', 'password')).toBe(true)
    })

    it('returns false for non-blacklisted column', () => {
      const config = makeConfig({
        tables: [],
        columns: { users: ['password'] },
      })
      const manager = new BlacklistManager(config)
      expect(manager.isColumnBlacklisted('users', 'email')).toBe(false)
    })

    it('returns false for missing table in columns config', () => {
      const config = makeConfig({ tables: [], columns: {} })
      const manager = new BlacklistManager(config)
      expect(manager.isColumnBlacklisted('users', 'password')).toBe(false)
    })

    it('is case-insensitive for column names', () => {
      const config = makeConfig({
        tables: [],
        columns: { users: ['password'] },
      })
      const manager = new BlacklistManager(config)
      // Reversed by ADR-0018 Decision 1. Case sensitivity was documented as
      // deliberate, but it made `SELECT password AS "PASSWORD"` a bypass any
      // query-only connection could use, and made a rule spelled in the other
      // case protect nothing without saying so.
      expect(manager.isColumnBlacklisted('users', 'PASSWORD')).toBe(true)
      expect(manager.isColumnBlacklisted('users', 'Password')).toBe(true)
    })
  })

  describe('getBlacklistedColumns()', () => {
    it('returns correct list of blacklisted columns', () => {
      const config = makeConfig({
        tables: [],
        columns: { users: ['password', 'api_key', 'ssn'] },
      })
      const manager = new BlacklistManager(config)
      const cols = manager.getBlacklistedColumns('users')
      expect(cols).toContain('password')
      expect(cols).toContain('api_key')
      expect(cols).toContain('ssn')
      expect(cols.length).toBe(3)
    })

    it('returns empty array for table with no blacklisted columns', () => {
      const config = makeConfig({ tables: [], columns: {} })
      const manager = new BlacklistManager(config)
      expect(manager.getBlacklistedColumns('users')).toEqual([])
    })
  })

  describe('canOverrideBlacklist()', () => {
    it('returns true when DBCLI_OVERRIDE_BLACKLIST=true is passed', () => {
      const manager = new BlacklistManager(baseConfig, 'true')
      expect(manager.canOverrideBlacklist()).toBe(true)
    })

    it('returns false when override is not set', () => {
      const _manager = new BlacklistManager(baseConfig, undefined)
      // Can't rely on env in tests; pass explicit false
      const manager2 = new BlacklistManager(baseConfig, 'false')
      expect(manager2.canOverrideBlacklist()).toBe(false)
    })

    it('returns false when override is "false"', () => {
      const manager = new BlacklistManager(baseConfig, 'false')
      expect(manager.canOverrideBlacklist()).toBe(false)
    })
  })

  describe('performance', () => {
    it('completes 1000 table lookups in < 10ms', () => {
      const tables = Array.from({ length: 100 }, (_, i) => `table_${i}`)
      const config = makeConfig({ tables, columns: {} })
      const manager = new BlacklistManager(config)

      const start = performance.now()
      for (let i = 0; i < 1000; i++) {
        manager.isTableBlacklisted(`table_${i % 100}`)
      }
      const elapsed = performance.now() - start
      expect(elapsed).toBeLessThan(10)
    })

    it('handles malformed config gracefully (no crash)', () => {
      const config = makeConfig({ tables: 'not-an-array', columns: null })
      // Should not throw
      expect(() => new BlacklistManager(config)).not.toThrow()
    })
  })
})

describe('BlacklistManager Hardening', () => {
  it('isTableBlacklisted is case-insensitive', () => {
    const config = {
      blacklist: {
        tables: ['Users', 'SECRET_INFO'],
        columns: {},
      },
    }
    const manager = new BlacklistManager(config as any)
    expect(manager.isTableBlacklisted('users')).toBe(true)
    expect(manager.isTableBlacklisted('USERS')).toBe(true)
    expect(manager.isTableBlacklisted('secret_info')).toBe(true)
  })

  it('isColumnBlacklisted supports dotted paths', () => {
    const config = {
      blacklist: {
        tables: [],
        columns: {
          users: ['profile.email', 'metadata.internal_id'],
        },
      },
    }
    const manager = new BlacklistManager(config as any)
    expect(manager.isColumnBlacklisted('users', 'profile.email')).toBe(true)
    expect(manager.isColumnBlacklisted('users', 'name')).toBe(false)
  })
})

describe('a rule the code cannot use fails loudly (ADR-0018)', () => {
  it('folds column names, so a rule written in the other case still matches', () => {
    // Measured 2026-08-31: `probe_users (Password)` with the rule spelled
    // `password` returned `s3cret` in full. Seven of eight configurations did.
    const m = new BlacklistManager(makeConfig({ tables: [], columns: { users: ['password'] } }))
    expect(m.isColumnBlacklisted('users', 'Password')).toBe(true)
    expect(m.isColumnBlacklisted('users', 'PASSWORD')).toBe(true)
    expect(m.isColumnBlacklisted('users', 'password')).toBe(true)
  })

  it('strips surrounding whitespace and quotes from entries and keys', () => {
    const m = new BlacklistManager(
      makeConfig({ tables: [], columns: { ' users ': [' password ', '"secret"', '`token`'] } })
    )
    for (const column of ['password', 'secret', 'token']) {
      expect(m.isColumnBlacklisted('users', column)).toBe(true)
    }
  })

  it('refuses a column entry qualified with its own table, rather than accepting a dead rule', () => {
    // A dot in a column entry already means a nested path (`profile.ssn`), so
    // this cannot be rewritten silently. Comparing the first segment with the
    // key is the one test that separates the two without guessing.
    expect(
      () => new BlacklistManager(makeConfig({ tables: [], columns: { users: ['users.password'] } }))
    ).toThrow(/users\.password/)
  })

  it('keeps a nested path, which is not a qualified name', () => {
    const m = new BlacklistManager(makeConfig({ tables: [], columns: { users: ['profile.ssn'] } }))
    expect(m.getBlacklistedColumns('users')).toContain('profile.ssn')
  })

  it('finds a table rule by the qualified name and by its last segment', () => {
    const qualified = new BlacklistManager(
      makeConfig({ tables: [], columns: { 'public.users': ['password'] } })
    )
    expect(qualified.isColumnBlacklisted('users', 'password')).toBe(true)

    const bare = new BlacklistManager(makeConfig({ tables: [], columns: { users: ['password'] } }))
    expect(bare.isColumnBlacklisted('public.users', 'password')).toBe(true)
  })
})
