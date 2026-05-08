import { describe, test, expect } from 'bun:test'
import { collectBlacklist } from '@/core/inspect/collect-blacklist'

describe('collectBlacklist', () => {
  test('absent → zeros', () => {
    expect(collectBlacklist(undefined)).toEqual({ tables: 0, columnRules: 0 })
    expect(collectBlacklist({})).toEqual({ tables: 0, columnRules: 0 })
  })

  test('counts tables and per-column rules without leaking names', () => {
    const out = collectBlacklist({
      tables: ['secret_audit', 'pii_users'],
      columns: { users: ['email', 'phone'], orders: ['credit_card'] },
    })
    expect(out).toEqual({ tables: 2, columnRules: 3 })
  })

  test('non-array tables config degrades to 0 silently', () => {
    expect(collectBlacklist({ tables: 'oops' as unknown as string[] })).toEqual({
      tables: 0,
      columnRules: 0,
    })
  })
})
