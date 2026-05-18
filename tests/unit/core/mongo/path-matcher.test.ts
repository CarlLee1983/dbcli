import { describe, test, expect } from 'bun:test'
import { compilePatterns, matchAny } from '@/core/mongo/path-matcher'

describe('compilePatterns', () => {
  test('accepts exact path', () => {
    const out = compilePatterns(['password'])
    expect(out.patterns.length).toBe(1)
    expect(out.rejected).toEqual([])
  })

  test('accepts dotted path', () => {
    const out = compilePatterns(['profile.email'])
    expect(out.patterns.length).toBe(1)
  })

  test('accepts suffix wildcard', () => {
    const out = compilePatterns(['profile.tokens.*'])
    expect(out.patterns.length).toBe(1)
  })

  test('rejects middle wildcard', () => {
    const out = compilePatterns(['profile.*.email'])
    expect(out.patterns.length).toBe(0)
    expect(out.rejected).toEqual([
      { raw: 'profile.*.email', reason: 'wildcard must be the final segment' },
    ])
  })

  test('rejects bare *', () => {
    const out = compilePatterns(['*'])
    expect(out.patterns.length).toBe(0)
    expect(out.rejected[0]?.reason).toMatch(/wildcard/)
  })

  test('skips empty / non-string entries with a reason', () => {
    const out = compilePatterns(['', 'ok'])
    expect(out.patterns.length).toBe(1)
    expect(out.rejected[0]?.raw).toBe('')
  })
})

describe('matchAny', () => {
  const { patterns } = compilePatterns(['password', 'profile.email', 'profile.tokens.*'])

  test('exact path hits', () => {
    expect(matchAny('password', patterns)).toBe(true)
    expect(matchAny('profile.email', patterns)).toBe(true)
  })

  test('exact path miss', () => {
    expect(matchAny('email', patterns)).toBe(false)
    expect(matchAny('profile', patterns)).toBe(false)
  })

  test('suffix wildcard covers root', () => {
    expect(matchAny('profile.tokens', patterns)).toBe(true)
  })

  test('suffix wildcard covers descendants', () => {
    expect(matchAny('profile.tokens.access', patterns)).toBe(true)
    expect(matchAny('profile.tokens.refresh.expires_at', patterns)).toBe(true)
  })

  test('suffix wildcard does not match unrelated prefix', () => {
    expect(matchAny('profile.tokensx', patterns)).toBe(false)
  })

  test('empty pattern list never matches', () => {
    expect(matchAny('anything', [])).toBe(false)
  })
})
