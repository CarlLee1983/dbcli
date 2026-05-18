/**
 * Mongo blacklist path matcher.
 *
 * Patterns:
 *   foo            — exact match on path "foo"
 *   foo.bar        — exact match on path "foo.bar"
 *   foo.*          — matches "foo" OR any path beginning with "foo."
 *   anything with * not in the final segment — rejected
 */

export interface MongoPathPattern {
  readonly raw: string
  readonly segments: ReadonlyArray<string>
  readonly wildcardTail: boolean
}

export interface CompileResult {
  patterns: MongoPathPattern[]
  rejected: Array<{ raw: string; reason: string }>
}

export function compilePatterns(raw: ReadonlyArray<unknown>): CompileResult {
  const patterns: MongoPathPattern[] = []
  const rejected: Array<{ raw: string; reason: string }> = []

  for (const entry of raw) {
    if (typeof entry !== 'string' || entry.length === 0) {
      rejected.push({ raw: String(entry ?? ''), reason: 'must be a non-empty string' })
      continue
    }
    const segments = entry.split('.')
    if (segments.length === 0 || segments.some((s) => s.length === 0)) {
      rejected.push({ raw: entry, reason: 'empty path segment' })
      continue
    }
    const wildcardIndices = segments
      .map((s, i) => (s.includes('*') ? i : -1))
      .filter((i) => i >= 0)
    if (wildcardIndices.length === 0) {
      patterns.push({ raw: entry, segments, wildcardTail: false })
      continue
    }
    const lastIndex = segments.length - 1
    const onlyTail =
      wildcardIndices.length === 1 &&
      wildcardIndices[0] === lastIndex &&
      segments[lastIndex] === '*'
    if (!onlyTail) {
      rejected.push({ raw: entry, reason: 'wildcard must be the final segment' })
      continue
    }
    if (segments.length === 1) {
      rejected.push({ raw: entry, reason: 'wildcard must have a parent path' })
      continue
    }
    patterns.push({ raw: entry, segments: segments.slice(0, -1), wildcardTail: true })
  }

  return { patterns, rejected }
}

export function matchAny(path: string, patterns: ReadonlyArray<MongoPathPattern>): boolean {
  if (patterns.length === 0) return false
  const pathSegments = path.split('.')
  for (const pat of patterns) {
    if (pat.wildcardTail) {
      if (pathSegments.length < pat.segments.length) continue
      let ok = true
      for (let i = 0; i < pat.segments.length; i++) {
        if (pat.segments[i] !== pathSegments[i]) {
          ok = false
          break
        }
      }
      if (ok) return true
    } else {
      if (pat.segments.length !== pathSegments.length) continue
      let ok = true
      for (let i = 0; i < pat.segments.length; i++) {
        if (pat.segments[i] !== pathSegments[i]) {
          ok = false
          break
        }
      }
      if (ok) return true
    }
  }
  return false
}
