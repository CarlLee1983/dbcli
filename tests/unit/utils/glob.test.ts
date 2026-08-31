/**
 * `globToRegex` answers a security question: does this key match a blacklist
 * rule? Redis's own `stringmatchlen` compares byte by byte, so `*` there eats
 * any byte including a newline.
 */
import { describe, expect, test } from 'bun:test'
import { globToRegex } from '@/utils/glob'

describe('globToRegex against Redis semantics', () => {
  test('a wildcard covers a newline, as Redis does', () => {
    // Measured 2026-08-31: `.` in JavaScript does not match `\n` without the
    // dotAll flag, so `secrets:*` left `secrets:\nx` unprotected — and
    // `parseRedisCommand` keeps a newline inside quotes, so the key is
    // reachable. The same regex drives `sampleKeyNames`, so `dbcli list`
    // showed it too.
    expect(globToRegex('secrets:*').test('secrets:\nx')).toBe(true)
    expect(globToRegex('secrets:*').test('secrets:x\ny')).toBe(true)
    expect(globToRegex('*').test('a\nb')).toBe(true)
  })

  test('a single-character wildcard covers a newline', () => {
    expect(globToRegex('secrets:?').test('secrets:\n')).toBe(true)
  })

  test('a literal pattern still does not match a longer key', () => {
    // JavaScript's `$` matches only at the end of input — unlike Perl's, it
    // does not permit a trailing newline — so this is already right and the
    // dotAll flag must not change it. Redis agrees: the pattern is shorter
    // than the key.
    expect(globToRegex('secrets:x').test('secrets:x\n')).toBe(false)
  })

  test('unchanged: a wildcard does not cross what it never crossed', () => {
    expect(globToRegex('secrets:*').test('other:x')).toBe(false)
    expect(globToRegex('secrets:?').test('secrets:ab')).toBe(false)
  })
})
