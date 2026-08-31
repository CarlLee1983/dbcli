/**
 * `globToRegex` answers a security question: does this key match a blacklist
 * rule? Redis's own `stringmatchlen` compares byte by byte, so `*` there eats
 * any byte including a newline.
 */
import { describe, expect, test } from 'bun:test'
import { globMatches, globToRegex } from '@/utils/glob'

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

/**
 * `globToRegex` compiles `*` to `.*`, so a rule holding several of them makes
 * the engine backtrack catastrophically on a name that does not match.
 * Measured 2026-08-31: `'a' + '*'.repeat(50) + 'b'` against `'a' + 'x'.repeat(300)`
 * had not returned after three minutes. Every blacklist comparison runs this —
 * Redis key rules, Elasticsearch index expressions, and since ADR-0019 the
 * column rules and table names of every engine — so a config that is merely
 * wildcard-heavy hangs the guard rather than answering it.
 */
describe('globMatches answers in linear time', () => {
  const within = (ms: number, run: () => boolean): boolean => {
    const t0 = performance.now()
    const out = run()
    const took = performance.now() - t0
    expect(took).toBeLessThan(ms)
    return out
  }

  test('adjacent wildcards against a long non-match', () => {
    const glob = 'a' + '*'.repeat(50) + 'b'
    expect(within(100, () => globMatches(glob, 'a' + 'x'.repeat(300)))).toBe(false)
  })

  test('separated wildcards against a long non-match', () => {
    const glob = 'a' + '*b'.repeat(30) + 'c'
    expect(within(100, () => globMatches(glob, 'ab'.repeat(300)))).toBe(false)
  })

  test('interleaved * and ? against a long non-match', () => {
    const glob = '*?'.repeat(30) + 'z'
    expect(within(100, () => globMatches(glob, 'a'.repeat(400)))).toBe(false)
  })

  test('agrees with globToRegex on ordinary patterns', () => {
    const cases: [string, string][] = [
      ['secrets:*', 'secrets:token'],
      ['secrets:*', 'secrets:\nx'],
      ['secrets:*', 'public:x'],
      ['pass*', 'password'],
      ['pass*', 'pass'],
      ['sec?et', 'secret'],
      ['sec?et', 'secrets'],
      ['[abc]at', 'bat'],
      ['[abc]at', 'dat'],
      ['report\\*', 'report*'],
      ['report\\*', 'reports'],
      ['literal', 'literal'],
      ['literal', 'literal\n'],
      ['a[', 'a['],
    ]
    for (const [glob, input] of cases) {
      expect([glob, input, globMatches(glob, input)]).toEqual([
        glob,
        input,
        globToRegex(glob).test(input),
      ])
    }
  })
})

/**
 * The linear matcher replaces the compiled one on every blacklist path, so the
 * two have to answer identically. Exhaustive over a small alphabet rather than
 * sampled: a semantic drift here is a silent hole in the guard, and the space
 * that fits in a second is worth more than a hand-picked list.
 */
test('globMatches and globToRegex agree exhaustively over a small alphabet', () => {
  const alphabet = ['a', 'b', '*', '?', '\n']
  const globs: string[] = ['']
  for (let len = 1; len <= 4; len++) {
    const prev = globs.filter((g) => g.length === len - 1)
    for (const g of prev) for (const c of alphabet) globs.push(g + c)
  }
  const inputs: string[] = ['']
  for (let len = 1; len <= 4; len++) {
    const prev = inputs.filter((s) => s.length === len - 1)
    for (const s of prev) for (const c of ['a', 'b', '\n']) inputs.push(s + c)
  }

  const disagreements: string[] = []
  for (const glob of globs) {
    const re = globToRegex(glob)
    for (const input of inputs) {
      if (globMatches(glob, input) !== re.test(input)) {
        disagreements.push(`${JSON.stringify(glob)} vs ${JSON.stringify(input)}`)
      }
    }
  }
  expect(disagreements).toEqual([])
})

test('globMatches and globToRegex agree on escapes and character classes', () => {
  const alphabet = ['a', '*', '\\', '[', ']', '-']
  const globs: string[] = ['']
  for (let len = 1; len <= 4; len++) {
    const prev = globs.filter((g) => g.length === len - 1)
    for (const g of prev) for (const c of alphabet) globs.push(g + c)
  }
  const inputs = ['', 'a', '*', '[', ']', '\\', '-', 'aa', 'a*', 'a[', '[]', 'a\\', 'ab']

  const disagreements: string[] = []
  for (const glob of globs) {
    const re = globToRegex(glob)
    for (const input of inputs) {
      if (globMatches(glob, input) !== re.test(input)) {
        disagreements.push(`${JSON.stringify(glob)} vs ${JSON.stringify(input)}`)
      }
    }
  }
  expect(disagreements).toEqual([])
})
