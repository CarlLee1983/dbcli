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

  // Both entries below were rejected before ADR-0019 Decision 1, when a
  // wildcard was only legal as a whole final segment. Every segment is a glob
  // now, so each compiles and matches per segment.
  test('a mid-path wildcard is a segment glob, not a rejection', () => {
    const out = compilePatterns(['profile.*.email'])
    expect(out.rejected).toEqual([])
    expect(matchAny('profile.work.email', out.patterns)).toBe(true)
    expect(matchAny('profile.email', out.patterns)).toBe(false)
  })

  test('a bare * is a segment glob over the top level', () => {
    const out = compilePatterns(['*'])
    expect(out.rejected).toEqual([])
    expect(matchAny('anything', out.patterns)).toBe(true)
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

// ADR-0019 Decision 1: a rule segment is a glob, and a final `*` keeps its
// tail meaning.
describe('segment globs', () => {
  test('accepts a wildcard inside a segment', () => {
    const out = compilePatterns(['pass*'])
    expect(out.rejected).toEqual([])
    expect(out.patterns.length).toBe(1)
  })

  test('a segment glob matches the field it names', () => {
    const { patterns } = compilePatterns(['pass*'])
    expect(matchAny('password', patterns)).toBe(true)
    expect(matchAny('pass', patterns)).toBe(true)
  })

  test('a segment glob does not cross a dot', () => {
    const { patterns } = compilePatterns(['pass*'])
    expect(matchAny('user.password', patterns)).toBe(false)
    expect(matchAny('password.hash', patterns)).toBe(false)
  })

  test('a segment glob applies at any depth of the rule', () => {
    const { patterns } = compilePatterns(['user.*_token', 'sec?et'])
    expect(matchAny('user.access_token', patterns)).toBe(true)
    expect(matchAny('user.name', patterns)).toBe(false)
    expect(matchAny('secret', patterns)).toBe(true)
    expect(matchAny('secrets', patterns)).toBe(false)
  })

  test('a lone * protects every field at that level', () => {
    const out = compilePatterns(['*'])
    const { patterns } = out
    expect(out.rejected).toEqual([])
    expect(matchAny('anything', patterns)).toBe(true)
    expect(matchAny('nested.field', patterns)).toBe(false)
  })

  test('a final * still covers the parent path and its descendants', () => {
    const { patterns } = compilePatterns(['user.*'])
    expect(matchAny('user', patterns)).toBe(true)
    expect(matchAny('user.password', patterns)).toBe(true)
    expect(matchAny('user.a.b', patterns)).toBe(true)
  })

  test('an escaped star is a literal star', () => {
    const { patterns } = compilePatterns(['pass\\*'])
    expect(matchAny('pass*', patterns)).toBe(true)
    expect(matchAny('password', patterns)).toBe(false)
  })

  test('still rejects a malformed path', () => {
    expect(compilePatterns(['a..b']).rejected.length).toBe(1)
    expect(compilePatterns(['']).rejected.length).toBe(1)
  })
})
