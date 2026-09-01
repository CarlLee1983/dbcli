/**
 * Glob matching shared by the guards that have to reason about wildcard
 * targets: Redis key patterns and Elasticsearch index expressions.
 */

/**
 * Convert a glob (`*`, `?`, `[abc]`, `[a-z]`) to a RegExp anchored on the whole string.
 *
 * @deprecated For a boolean answer use `globMatches`, which decides the same
 * question in linear time. Several `*` in one pattern compile to several `.*`,
 * and against a non-matching string that backtracks catastrophically — this is
 * only for a caller that genuinely needs a `RegExp` object, and never with a
 * pattern or subject of untrusted length. ADR-0019 Decision 5.
 */
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

/**
 * How `globMatches` compares. `caseInsensitive` folds both sides at comparison
 * — the blacklist's rule for column and field names, where the request chooses
 * the case of the name the mask sees. ADR-0020.
 */
export interface GlobMatchOptions {
  readonly caseInsensitive?: boolean
}

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

/**
 * The two modes parse to different tokens — a folded literal, a class compiled
 * with `i` — so they cannot share a memo entry. `\u0000` cannot appear in a
 * glob that reached here as a config entry, and even if it did the prefix keeps
 * the two namespaces apart.
 */
function parseGlob(glob: string, caseInsensitive: boolean): ParsedGlob {
  const key = caseInsensitive ? `i\u0000${glob}` : glob
  const memo = parsedGlobs.get(key)
  if (memo !== undefined) return memo
  const parsed = parseGlobUncached(glob, caseInsensitive)
  parsedGlobs.set(key, parsed)
  return parsed
}

function parseGlobUncached(glob: string, caseInsensitive: boolean): ParsedGlob {
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
      current.push(literalToken(glob[++i] as string, caseInsensitive))
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
        current.push({
          kind: 'class',
          test: new RegExp(`^${body}$`, caseInsensitive ? 'si' : 's'),
        })
        i = end
        continue
      }
      current.push(literalToken('[', caseInsensitive))
      continue
    }
    current.push(literalToken(c, caseInsensitive))
  }
  endRun()

  return { runs, leadingStar, trailingStar, anchored: !sawStar }
}

/**
 * A literal token, folded now rather than at every comparison.
 *
 * The fold lives in the token, not in the pattern text: rewriting the text
 * would also rewrite a character class, and `[A-z]` lower-cased stands for a
 * smaller set than it did. ADR-0020.
 */
function literalToken(char: string, caseInsensitive: boolean): GlobToken {
  return { kind: 'literal', char: caseInsensitive ? char.toLowerCase() : char }
}

/** Whether `run` matches `text` starting at `at`. */
function runMatchesAt(run: GlobRun, text: string, at: number, caseInsensitive: boolean): boolean {
  if (at + run.length > text.length) return false
  for (let i = 0; i < run.length; i++) {
    const token = run[i]!
    const ch = text[at + i]!
    if (token.kind === 'literal') {
      if (token.char !== (caseInsensitive ? ch.toLowerCase() : ch)) return false
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
export function globMatches(glob: string, text: string, options?: GlobMatchOptions): boolean {
  const caseInsensitive = options?.caseInsensitive === true
  const { runs, leadingStar, trailingStar, anchored } = parseGlob(glob, caseInsensitive)

  if (anchored) {
    const run = runs[0] ?? []
    return text.length === run.length && runMatchesAt(run, text, 0, caseInsensitive)
  }
  if (runs.length === 0) return true // the glob is nothing but wildcards

  let cursor = 0
  let first = 0
  let last = runs.length

  if (!leadingStar) {
    const head = runs[0]!
    if (!runMatchesAt(head, text, 0, caseInsensitive)) return false
    cursor = head.length
    first = 1
  }
  if (!trailingStar) {
    const tail = runs[last - 1]!
    const at = text.length - tail.length
    if (at < cursor || !runMatchesAt(tail, text, at, caseInsensitive)) return false
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
      if (runMatchesAt(run, text, at, caseInsensitive)) {
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

/**
 * Why this glob can never match anything, or `null` if it can.
 *
 * `globMatches` accepts these shapes and answers `false` forever, which is the
 * right answer for a Redis key pattern typed at a prompt and the wrong one for
 * a blacklist rule: the entry loads, `blacklist list` reports it, and it guards
 * nothing. Callers that hold rules rather than one-off patterns should refuse
 * on a non-null result.
 */
export function globNeverMatches(glob: string): string | null {
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!
    if (c === '\\') {
      i++
      continue
    }
    if (c !== '[') continue
    const end = findClassEnd(glob, i)
    if (end === -1) {
      // Degrades to a literal `[`, so the rule protects a field whose name
      // contains the bracket rather than the one that was meant.
      return 'unclosed character class'
    }
    const body = glob.slice(i, end + 1)
    if (body === '[]' || body === '[^]') return 'empty character class matches nothing'
    if (!isValidCharacterClass(body)) return 'invalid character class'
    i = end
  }
  return null
}
