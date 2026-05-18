import { describe, test, expect } from 'bun:test'
import { auditBlacklistPatterns } from '@/commands/blacklist'

describe('auditBlacklistPatterns', () => {
  test('separates accepted and warned entries', () => {
    const out = auditBlacklistPatterns({
      tables: [],
      columns: {
        users: ['password', 'profile.email', 'profile.tokens.*', 'profile.*.email'],
      },
    })
    expect(out.warnings).toEqual([
      {
        collection: 'users',
        raw: 'profile.*.email',
        reason: 'wildcard must be the final segment',
      },
    ])
  })

  test('passes through collections with no issues', () => {
    const out = auditBlacklistPatterns({ tables: [], columns: { orders: ['cost'] } })
    expect(out.warnings).toEqual([])
  })
})
