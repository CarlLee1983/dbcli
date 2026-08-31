/**
 * Glob matching shared by the guards that have to reason about wildcard
 * targets: Redis key patterns and Elasticsearch index expressions.
 */

/** Convert a glob (`*`, `?`, `[abc]`, `[a-z]`) to a RegExp anchored on the whole string. */
export function globToRegex(glob: string): RegExp {
  let out = '^'
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!
    if (c === '\\' && i + 1 < glob.length) {
      // An escaped metacharacter is a literal: `sec\*` protects the key `sec*`.
      // Emitting the backslash itself made the pattern match `sec\x` and miss
      // the key it exists to protect.
      out += (glob[++i] as string).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      continue
    }
    if (c === '*') out += '.*'
    else if (c === '?') out += '.'
    else if (c === '[') {
      const end = findClassEnd(glob, i)
      // A class the glob does not close, or one whose contents do not form a
      // valid class (`[\]`), is treated as a literal `[` rather than emitted
      // into the pattern — an unparseable RegExp here would throw out of a
      // security check instead of answering it.
      const body = end === -1 ? '' : glob.slice(i, end + 1)
      if (body !== '' && isValidCharacterClass(body)) {
        out += body
        i = end
      } else {
        out += '\\['
      }
    } else if ('.^$+(){}|\\'.includes(c)) {
      out += '\\' + c
    } else {
      out += c
    }
  }
  out += '$'
  // `s` (dotAll): Redis's `stringmatchlen` compares byte by byte, so its `*`
  // and `?` eat a newline like any other byte. Without the flag JavaScript's
  // `.` stops at `\n`, and `secrets:*` left `secrets:\nx` unprotected while
  // `parseRedisCommand` happily carried that key through a quoted argument.
  // `$` needs no companion change: JavaScript anchors it at end of input,
  // unlike Perl, so a literal pattern still refuses a key with a trailing
  // newline — which is also what Redis answers.
  return new RegExp(out, 's')
}

/** Index of the `]` closing the class opened at `open`, honouring backslash escapes. */
function findClassEnd(glob: string, open: number): number {
  for (let i = open + 1; i < glob.length; i++) {
    if (glob[i] === '\\') {
      i++
      continue
    }
    if (glob[i] === ']') return i
  }
  return -1
}

function isValidCharacterClass(body: string): boolean {
  try {
    new RegExp(body)
    return true
  } catch {
    return false
  }
}

/**
 * One glob token, consuming exactly one character of the input.
 *
 * Fixed width is the whole point: it makes every `*`-free run a constant-length
 * window, which is what lets `globMatches` scan instead of backtrack.
 */
type GlobToken =
  | { kind: 'literal'; char: string }
  | { kind: 'any' }
  | { kind: 'class'; test: RegExp }

/** A `*`-free run of tokens. `globMatches` slides these along the input. */
type GlobRun = ReadonlyArray<GlobToken>

interface ParsedGlob {
  /** Runs between the wildcards, in order. */
  runs: GlobRun[]
  /** Whether a `*` precedes the first run, and follows the last. */
  leadingStar: boolean
  trailingStar: boolean
  /** No wildcard anywhere: the input has to equal the single run exactly. */
  anchored: boolean
}

/**
 * Split a glob into `*`-separated runs, honouring the same escapes and
 * character classes `globToRegex` accepts.
 */
/**
 * Parsed globs, keyed by the pattern text.
 *
 * The callers that hoisted `globToRegex` out of their loops — a `SCAN` reply
 * filtered against the key rules, a table name against every entry — lost that
 * hoist when they moved to `globMatches`, which re-parsed per comparison
 * (measured 6x on 10,000 keys x 5 rules). Memoising here restores it for every
 * caller instead of asking each to hold a compiled form. The keys are blacklist
 * entries, so the map is bounded by the config file.
 */
const parsedGlobs = new Map<string, ParsedGlob>()

function parseGlob(glob: string): ParsedGlob {
  const memo = parsedGlobs.get(glob)
  if (memo !== undefined) return memo
  const parsed = parseGlobUncached(glob)
  parsedGlobs.set(glob, parsed)
  return parsed
}

function parseGlobUncached(glob: string): ParsedGlob {
  const runs: GlobRun[] = []
  let current: GlobToken[] = []
  let leadingStar = false
  let trailingStar = false
  let sawStar = false

  const endRun = (): void => {
    if (current.length > 0) runs.push(current)
    current = []
  }

  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!
    if (c === '\\' && i + 1 < glob.length) {
      trailingStar = false
      current.push({ kind: 'literal', char: glob[++i] as string })
      continue
    }
    if (c === '*') {
      if (!sawStar && current.length === 0) leadingStar = true
      sawStar = true
      trailingStar = true
      endRun()
      continue
    }
    trailingStar = false
    if (c === '?') {
      current.push({ kind: 'any' })
      continue
    }
    if (c === '[') {
      const end = findClassEnd(glob, i)
      const body = end === -1 ? '' : glob.slice(i, end + 1)
      // Same fallback as `globToRegex`: a class the glob does not close, or one
      // that is not a valid class, is the literal `[`. An unparseable pattern
      // must not throw out of a security check.
      if (body !== '' && isValidCharacterClass(body)) {
        current.push({ kind: 'class', test: new RegExp(`^${body}$`, 's') })
        i = end
        continue
      }
      current.push({ kind: 'literal', char: '[' })
      continue
    }
    current.push({ kind: 'literal', char: c })
  }
  endRun()

  return { runs, leadingStar, trailingStar, anchored: !sawStar }
}

/** Whether `run` matches `text` starting at `at`. */
function runMatchesAt(run: GlobRun, text: string, at: number): boolean {
  if (at + run.length > text.length) return false
  for (let i = 0; i < run.length; i++) {
    const token = run[i]!
    const ch = text[at + i]!
    if (token.kind === 'literal') {
      if (token.char !== ch) return false
    } else if (token.kind === 'class') {
      if (!token.test.test(ch)) return false
    }
    // `any` matches whatever is there, newline included — Redis's `?` eats a
    // byte without asking what it is.
  }
  return true
}

/**
 * Whether `text` matches `glob`, with the same semantics as `globToRegex` and
 * without its backtracking.
 *
 * `globToRegex` compiles each `*` to `.*`, and several of those against a
 * non-matching input backtrack catastrophically: `'a' + '*'.repeat(50) + 'b'`
 * tested against a 300-character string had not returned after three minutes
 * (measured 2026-08-31). Every blacklist decision runs this comparison, so a
 * merely wildcard-heavy config hung the guard instead of answering it.
 *
 * Here a `*`-free run has a fixed width, so each one is found by scanning
 * forward once and never revisited — O(text x glob) at worst, with no
 * exponential case.
 *
 * Both this and `globToRegex` compare UTF-16 code units, so `?` consumes half
 * of a surrogate pair: `a?b` does not match `a{emoji}b` and `a??b` does. That is a
 * shared limitation rather than a difference between them — the two agree — but
 * a reader expecting "one `?` is one character" would be wrong about both. Prefer this to `globToRegex` wherever the answer is a
 * boolean; the compiled form is only for callers that genuinely need a RegExp.
 */
export function globMatches(glob: string, text: string): boolean {
  const { runs, leadingStar, trailingStar, anchored } = parseGlob(glob)

  if (anchored) {
    const run = runs[0] ?? []
    return text.length === run.length && runMatchesAt(run, text, 0)
  }
  if (runs.length === 0) return true // the glob is nothing but wildcards

  let cursor = 0
  let first = 0
  let last = runs.length

  if (!leadingStar) {
    const head = runs[0]!
    if (!runMatchesAt(head, text, 0)) return false
    cursor = head.length
    first = 1
  }
  if (!trailingStar) {
    const tail = runs[last - 1]!
    const at = text.length - tail.length
    if (at < cursor || !runMatchesAt(tail, text, at)) return false
    last -= 1
  }

  // Each remaining run is preceded and followed by a `*`, so the earliest
  // position it can take is the correct one: taking it later can only shorten
  // what is left for the runs after it.
  const limit = trailingStar ? text.length : text.length - runs[runs.length - 1]!.length
  for (let r = first; r < last; r++) {
    const run = runs[r]!
    let found = -1
    for (let at = cursor; at + run.length <= limit; at++) {
      if (runMatchesAt(run, text, at)) {
        found = at
        break
      }
    }
    if (found === -1) return false
    cursor = found + run.length
  }
  return true
}

/**
 * Escape a literal string so `globMatches` treats it as the name it is.
 *
 * Needed wherever a name that is *not* a pattern is spliced into one — a
 * `$lookup`'s `as`, for instance, which the request chooses. Without it `\`
 * silently disabled the rule built around it, since a backslash is the one
 * metacharacter that does not accidentally match itself.
 */
export function escapeGlob(literal: string): string {
  return literal.replace(/[*?[\]\\]/g, '\\$&')
}
