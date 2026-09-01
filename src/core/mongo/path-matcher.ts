/**
 * Mongo blacklist path matcher.
 *
 * A rule is a dot-separated path whose segments are globs (`*`, `?`, `[abc]`,
 * `\*` for a literal star), matched by the same `globMatches` that Redis
 * key patterns and Elasticsearch index expressions use — one array in one
 * config file gets one answer. ADR-0019 Decision 1.
 *
 * Patterns:
 *   password       — the field `password`
 *   pass*          — any field at that level starting `pass`; never crosses a dot
 *   profile.email  — that exact path
 *   profile.*      — `profile` itself OR any path beneath it
 *
 * The final-`*` form keeps its tail meaning rather than reading as a plain
 * segment glob: read literally it would match `profile.<one segment>` and stop
 * protecting `profile` itself, silently narrowing rules already deployed.
 */

import { globMatches, globNeverMatches } from '@/utils/glob'

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
    if (segments.some((s) => s.length === 0)) {
      rejected.push({ raw: entry, reason: 'empty path segment' })
      continue
    }
    // `**` reads as a globstar to anyone arriving from gitignore or bash, and
    // it is not one: it falls through to an ordinary segment glob and covers a
    // single segment, exactly as `*` does. Refused rather than silently
    // narrowed — ADR-0019 Decision 3.
    const globstar = segments.find((seg) => seg.includes('**'))
    if (globstar !== undefined) {
      rejected.push({
        raw: entry,
        reason: '`**` matches one segment, not a subtree; write `*` or a longer path',
      })
      continue
    }
    // A class that can never match makes the whole rule dead on arrival.
    const dead = segments.map((seg) => globNeverMatches(seg)).find((r) => r !== null)
    if (dead !== undefined && dead !== null) {
      rejected.push({ raw: entry, reason: dead })
      continue
    }
    // A trailing bare `*` under a parent is the tail form; a lone `*` is an
    // ordinary segment glob covering every field at the top level.
    const wildcardTail = segments.length > 1 && segments[segments.length - 1] === '*'
    const literal = wildcardTail ? segments.slice(0, -1) : segments
    patterns.push({
      raw: entry,
      segments: literal,
      wildcardTail,
    })
  }

  return { patterns, rejected }
}

/**
 * Every segment is compared case-insensitively, rules and names alike.
 *
 * A field name is chosen by the request — `$project: {PASSWORD: "$password"}`,
 * `SELECT password AS "PASSWORD"` — so a mask that compares case-sensitively is
 * defeated by a rule that was written correctly. Folding covers the whole path
 * rather than the first segment alone, so one rule cannot mean one thing to a
 * write and another to a read; the cost is that a document holding both
 * `profile.SSN` and `profile.ssn` has both redacted by a rule naming either.
 * ADR-0020, which supersedes ADR-0018 Decision 1 on this point.
 */
const FOLD_CASE = { caseInsensitive: true } as const

/**
 * Whether one pattern segment matches one path segment, folded.
 *
 * Exported so a caller walking a record level by level asks the same question
 * `matchAny` asks, rather than restating the fold or the glob semantics.
 */
export function matchSegment(pattern: string, segment: string): boolean {
  return globMatches(pattern, segment, FOLD_CASE)
}

export function matchAny(path: string, patterns: ReadonlyArray<MongoPathPattern>): boolean {
  if (patterns.length === 0) return false
  const pathSegments = path.split('.')
  for (const pat of patterns) {
    if (pat.wildcardTail) {
      if (pathSegments.length < pat.segments.length) continue
    } else {
      if (pat.segments.length !== pathSegments.length) continue
    }
    let ok = true
    for (let i = 0; i < pat.segments.length; i++) {
      if (!globMatches(pat.segments[i]!, pathSegments[i]!, FOLD_CASE)) {
        ok = false
        break
      }
    }
    if (ok) return true
  }
  return false
}
