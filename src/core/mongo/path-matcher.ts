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

import { globMatches } from '@/utils/glob'

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
      if (!globMatches(pat.segments[i]!, pathSegments[i]!)) {
        ok = false
        break
      }
    }
    if (ok) return true
  }
  return false
}
