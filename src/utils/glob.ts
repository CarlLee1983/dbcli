/**
 * Glob matching shared by the guards that have to reason about wildcard
 * targets: Redis key patterns and Elasticsearch index expressions.
 */

import { foldCase } from './case-fold'

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
 * caller instead of asking each to hold a compiled form. Blacklist entries are
 * bounded by the config file, but not every pattern comes from one: an
 * Elasticsearch `--index` expression and a Redis key pattern are supplied by
 * the request, so the map carries a ceiling — see `PARSED_GLOB_LIMIT`.
 */
const parsedGlobs = new Map<string, ParsedGlob>()

/**
 * A ceiling on the memo, because not every pattern comes from a config file.
 *
 * An Elasticsearch index expression is a pattern the *request* supplies, so a
 * long-lived shell session would otherwise grow this map with one entry per
 * expression an operator ever typed. Cleared wholesale rather than evicted one
 * at a time: the map exists to hoist a parse out of a loop, and a loop refills
 * what it needs on its next pass.
 */
const PARSED_GLOB_LIMIT = 4096

/**
 * 兩種模式解析出不同的 token——折過的字面、帶 `i` 編譯的字元類——所以不能共用
 * 同一筆記憶。**兩種模式都要加前綴**：只加一邊會讓兩個命名空間重疊。先前的鍵是
 * `caseInsensitive ? 'i' + NUL + glob : glob`，於是一個字面以 `i` 加 NUL 開頭的
 * 非折疊 pattern 會佔走它自己後綴在折疊模式下的那一格，而那條規則接下來整個
 * process 都答錯。
 *
 * 這不只是設定檔的問題。`patternsOverlap` 把使用者 `SCAN … MATCH` 的 pattern 當成
 * 第一個引數、以非折疊模式傳進來（`src/adapters/redis/blacklist-enforcer.ts`），
 * 所以那一格是請求方指定得到的。原本的註解說設定檔項目裡不會有 NUL，那是對的但
 * 不相干：ES 的 index 運算式與 Redis 的 key pattern 都不來自設定檔。
 */
function parseGlob(glob: string, caseInsensitive: boolean): ParsedGlob {
  const key = `${caseInsensitive ? 'i' : 'c'}\u0000${glob}`
  const memo = parsedGlobs.get(key)
  if (memo !== undefined) return memo
  const parsed = parseGlobUncached(glob, caseInsensitive)
  if (parsedGlobs.size >= PARSED_GLOB_LIMIT) parsedGlobs.clear()
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
      const escaped = String.fromCodePoint(glob.codePointAt(++i)!)
      i += escaped.length - 1
      current.push(...literalToken(escaped, caseInsensitive))
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
      current.push(...literalToken('[', caseInsensitive))
      continue
    }
    // 以碼點而不是碼元前進：`c` 是 `glob[i]`，對 astral 字元是半個代理對。
    const literal = String.fromCodePoint(glob.codePointAt(i)!)
    i += literal.length - 1
    current.push(...literalToken(literal, caseInsensitive))
  }
  endRun()

  return { runs, leadingStar, trailingStar, anchored: !sawStar }
}

/**
 * The literal tokens one pattern **code point** contributes, folded now rather
 * than at every comparison.
 *
 * The fold lives in the token, not in the pattern text: rewriting the text
 * would also rewrite a character class, and `[A-z]` lower-cased stands for a
 * smaller set than it did. ADR-0020.
 *
 * 兩件事在這裡交會，缺一個就是 fail-open。
 *
 * 進來的必須是**完整的碼點**：`foldCase` 對半個代理對是恆等函式，而
 * `globMatches` 比對的文字是整串折過的，那一側會把碼點真的映成小寫。兩側折的
 * 粒度不同時，規則 `𐐀` 比不上欄位 `𐐀`——它連自己都命不中。舊版兩側都沒折
 * 碼點，靠一起不折而碰巧相等。
 *
 * 出去的必須是**逐碼元**的 token：`runMatchesAt` 用 `text[at + i]` 取字，那是
 * 碼元。一個 astral 字元折出來是兩個碼元，塞進一個 token 就永遠不等於任何單一
 * 碼元。`foldCase` 保長（見 `case-fold.ts`）保證的是碼元數不變，不是「一個字元
 * 一個 token」。
 */
function literalToken(codePoint: string, caseInsensitive: boolean): GlobToken[] {
  const folded = caseInsensitive ? foldCase(codePoint) : codePoint
  return folded.split('').map((unit) => ({ kind: 'literal', char: unit }) as const)
}

/**
 * Whether `run` matches `text` starting at `at`.
 *
 * `text` is already folded when the caller asked for it — `globMatches` folds
 * the whole string once — so a literal token compares as it stands. Folding
 * here instead, one character at a time, was the divergence: `toLowerCase`'s
 * `Final_Sigma` rule reads the characters around the one it is folding, and a
 * single character never has any.
 */
function runMatchesAt(run: GlobRun, text: string, raw: string, at: number): boolean {
  if (at + run.length > text.length) return false
  for (let i = 0; i < run.length; i++) {
    const token = run[i]!
    if (token.kind === 'literal') {
      if (token.char !== text[at + i]!) return false
    } else if (token.kind === 'class') {
      // 字元類比對的是**未折疊**的文字，和折疊之前一樣。類別自己帶 `i` 旗標，
      // 所以折過再比對在 BMP 上不多做任何事，卻會把 astral 字元的低位代理換掉
      // ——`[𐐀]` 於是比不上 `𐐀`。大小寫由 `i` 回答是 ADR-0020 Decision 2 的
      // 立場：pattern 的文字一個字都不改寫。
      const rawChar = raw[at + i]
      // 折疊保長，所以這裡永遠取得到；取不到就是那個不變量壞了，而
      // `test.test(undefined)` 會去比對字串 `"undefined"`——`[a-z]` 命中它，於是
      // 一個壞掉的不變量會以「命中」的形式安靜地答錯。
      if (rawChar === undefined) {
        throw new Error('globMatches: folded and unfolded subject lengths disagree')
      }
      if (!token.test.test(rawChar)) return false
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
export function globMatches(glob: string, subject: string, options?: GlobMatchOptions): boolean {
  const caseInsensitive = options?.caseInsensitive === true
  const { runs, leadingStar, trailingStar, anchored } = parseGlob(glob, caseInsensitive)
  // 整串折一次，和 `foldFieldPath` 折的是同一件事。呼叫端多半已經折過，而
  // `foldCase` 是冪等的，所以重折不改變答案。
  // `foldCase` 保長，所以 `text` 與 `subject` 的碼元索引一一對應——字元類才能
  // 用同一個 `at + i` 去看未折疊的那一份。
  const text = caseInsensitive ? foldCase(subject) : subject

  if (anchored) {
    const run = runs[0] ?? []
    return text.length === run.length && runMatchesAt(run, text, subject, 0)
  }
  if (runs.length === 0) return true // the glob is nothing but wildcards

  let cursor = 0
  let first = 0
  let last = runs.length

  if (!leadingStar) {
    const head = runs[0]!
    if (!runMatchesAt(head, text, subject, 0)) return false
    cursor = head.length
    first = 1
  }
  if (!trailingStar) {
    const tail = runs[last - 1]!
    const at = text.length - tail.length
    if (at < cursor || !runMatchesAt(tail, text, subject, at)) return false
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
      if (runMatchesAt(run, text, subject, at)) {
        found = at
        break
      }
    }
    if (found === -1) return false
    cursor = found + run.length
  }
  return true
}

/** Whether the two Redis-style glob languages share at least one string. */
export function globsOverlap(left: string, right: string): boolean {
  type State = readonly [number, number]
  type Token = GlobToken | { kind: 'star' }

  const tokens = (glob: string): Token[] => {
    const parsed = parseGlob(glob, false)
    const out: Token[] = []
    if (parsed.leadingStar) out.push({ kind: 'star' })
    for (const [index, run] of parsed.runs.entries()) {
      if (index > 0) out.push({ kind: 'star' })
      out.push(...run)
    }
    if (parsed.trailingStar && out.at(-1)?.kind !== 'star') out.push({ kind: 'star' })
    return out
  }

  const a = tokens(left)
  const b = tokens(right)
  const queue: State[] = [[0, 0]]
  const seen = new Set<string>()

  const compatible = (x: Token, y: Token): boolean => {
    if (x.kind === 'star' || y.kind === 'star' || x.kind === 'any' || y.kind === 'any') return true
    if (x.kind === 'literal') {
      return y.kind === 'literal' ? x.char === y.char : y.test.test(x.char)
    }
    if (y.kind === 'literal') return x.test.test(y.char)
    for (let unit = 0; unit <= 0xffff; unit++) {
      const value = String.fromCharCode(unit)
      if (x.test.test(value) && y.test.test(value)) return true
    }
    return false
  }

  for (let cursor = 0; cursor < queue.length; cursor++) {
    const [i, j] = queue[cursor]!
    const key = `${i}:${j}`
    if (seen.has(key)) continue
    seen.add(key)
    if (i === a.length && j === b.length) return true

    const x = a[i]
    const y = b[j]
    if (x?.kind === 'star') queue.push([i + 1, j])
    if (y?.kind === 'star') queue.push([i, j + 1])
    if (x && y && compatible(x, y)) {
      queue.push([x.kind === 'star' ? i : i + 1, y.kind === 'star' ? j : j + 1])
    }
  }
  return false
}

/**
 * Escape a literal string so `globMatches` treats it as the name it is.
 *
 * Needed wherever a name that is *not* a pattern is spliced into one — a
 * `$lookup`'s `as`, for instance, which the request chooses. Without it `\`
 * silently disabled the rule built around it, since a backslash is the one
 * metacharacter that does not accidentally match itself.
 */
/**
 * Whether a string is a glob rather than a literal name.
 *
 * `]` is deliberately absent, and the asymmetry with `escapeGlob` — which does
 * escape it — is load-bearing rather than an oversight: a `]` with no `[` before
 * it is a literal to `parseGlob`, so a name containing one answers the same
 * either way, while treating it as a metacharacter would move such a name out
 * of the literal set and into the compiled one for no gain. Escaping is the
 * conservative side of the same fact and may cover more.
 *
 * One predicate, because the answer decides which of two matchers a rule is
 * given to: a rule read as a glob by one caller and a literal by another is the
 * split ADR-0019 and ADR-0020 exist to remove.
 */
export function isGlobPattern(value: string): boolean {
  return /[*?[\\]/.test(value)
}

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
