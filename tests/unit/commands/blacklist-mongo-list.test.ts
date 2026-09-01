import { describe, test, expect } from 'bun:test'
import { auditBlacklistPatterns } from '@/commands/blacklist'

describe('auditBlacklistPatterns', () => {
  test('separates accepted and warned entries', () => {
    const out = auditBlacklistPatterns({
      tables: [],
      columns: {
        // `profile..email` has an empty segment; `profile.*.email` compiles as
        // a segment glob since ADR-0019 Decision 1.
        users: [
          'password',
          'profile.email',
          'profile.tokens.*',
          'profile.*.email',
          'profile..email',
        ],
      },
    })
    expect(out.warnings).toEqual([
      {
        collection: 'users',
        raw: 'profile..email',
        reason: 'empty path segment',
      },
    ])
  })

  test('passes through collections with no issues', () => {
    const out = auditBlacklistPatterns({ tables: [], columns: { orders: ['cost'] } })
    expect(out.warnings).toEqual([])
  })
})
