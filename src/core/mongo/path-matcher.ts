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

import { globMatches, globNeverMatches, isGlobPattern } from '@/utils/glob'
import { foldFieldPath } from '@/core/blacklist-fold'

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

/**
 * 規則集拆成比對需要的形狀：字面規則、編譯過的樣式，以及字面規則有幾種寬度。
 *
 * 寬度是這裡唯一的新資訊，也是整個改動的重點。一條字面規則的點分元件數是固定
 * 的，只有同寬度的區段可能等於它，所以列舉全部 O(n²) 個區段裡有 O(n²) 個從一
 * 開始就不可能命中。樣式同理：`MongoPathPattern` 的 `segments.length` 決定它
 * 只看得到那個寬度的窗口，而尾端 `*` 的樣式只取決於窗口的**起點**——最短的那個
 * 窗口命中，更長的也命中——所以同樣只需要試一次。
 */
export interface ContiguousRules {
  readonly literals: ReadonlySet<string>
  readonly globs: ReadonlyArray<MongoPathPattern>
  /** 字面規則出現過的點分元件數，去重後由小到大。 */
  readonly literalWidths: ReadonlyArray<number>
}

export function contiguousRules(
  literals: ReadonlySet<string>,
  globs: ReadonlyArray<MongoPathPattern>
): ContiguousRules {
  const widths = new Set<number>()
  for (const rule of literals) widths.add(rule.split('.').length)
  return { literals, globs, literalWidths: [...widths].sort((a, b) => a - b) }
}

/**
 * 這條點分路徑有沒有任何**連續區段**命中規則集。
 *
 * 比的是區段而不是整串相等、也不是單一元件：`user.password` 與
 * `password.keyword` 都構得到 `password`，`passwordless` 則否。子字串比對會誤
 * 拒 `passwordless`，整串比對會漏掉 `user.password`。
 *
 * 路徑以**已折疊的元件陣列**傳進來，不是字串：呼叫端本來就是一層一層往下走
 * 的，先 `join('.')` 再在這裡 `split('.')` 回去，是把已知的結構丟掉再猜一次。
 *
 * 舊版對每個起點列舉每個終點並組出字串，是 O(depth³)；量到深度 5→40 的成本
 * 差 175 倍（2026-09-01）。回應的巢狀深度由叢集決定，不由設定決定。
 */
export function reachesProtectedSegments(
  segments: ReadonlyArray<string>,
  rules: ContiguousRules
): boolean {
  const { literals, globs, literalWidths } = rules
  const depth = segments.length
  for (let start = 0; start < depth; start++) {
    for (const width of literalWidths) {
      const end = start + width
      if (end > depth) break // 寬度已排序，後面的只會更長
      const candidate = width === 1 ? segments[start]! : segments.slice(start, end).join('.')
      if (literals.has(candidate)) return true
    }
    for (const pattern of globs) {
      const width = pattern.segments.length
      if (start + width > depth) continue
      let matched = true
      for (let i = 0; i < width; i++) {
        if (!matchSegment(pattern.segments[i]!, segments[start + i]!)) {
          matched = false
          break
        }
      }
      if (matched) return true
    }
  }
  return false
}

/** 同一個問題，路徑還是字串時的入口。 */
export function reachesProtectedPath(path: string, rules: ContiguousRules): boolean {
  return reachesProtectedSegments(path.split('.'), rules)
}

/**
 * 一組黑名單規則編譯成比對用的形狀，依規則集記憶。
 *
 * 記憶是必要的而不是最佳化：`redactFields` 走過回應的每一個鍵、
 * `findProtectedFieldReference` 走過請求的每一個候選名稱，都會問同一個問題。
 * 後者原本每次呼叫都重折一次規則、重編一次樣式。
 *
 * 帶有 metacharacter 的項目**只**進樣式那一半。同時留在字面集合裡會讓相等比對
 * 回答一個 glob 語意答得不一樣的問題：`back\\slash` 靠字串相等命中自己——原始
 * 項目剛好已經是小寫——而 `Back\\Slash` 什麼都命不中，因為編譯後的樣式把 `\\S`
 * 讀成字面的 `S`，折疊後的名稱又永遠不等於原始項目。一條規則兩個答案，由它的
 * 大小寫決定。ADR-0020 的 falsification 段落點名這一條。
 *
 * 讀不懂的規則不會被默默丟掉——那會讓一個寫壞的項目在別處等於「沒有規則」，而
 * 這條路徑後面沒有第二層遮罩。ADR-0019 Decision 3。
 *
 * 傳進來的 Set 一旦被記憶就視為不可變。兩個生產呼叫端
 * （`collectProtectedFields`、`protectedFieldsForRequest`）都回傳全新且之後不再
 * 變動的 Set；一個會在遮罩開始後才加規則的呼叫端，加進去的那條不會生效。
 */
const compiledRuleSets = new WeakMap<ReadonlySet<string>, ContiguousRules>()

export function contiguousRulesFor(protectedFields: ReadonlySet<string>): ContiguousRules {
  const memo = compiledRuleSets.get(protectedFields)
  if (memo !== undefined) return memo
  const globbed: string[] = []
  const literals = new Set<string>()
  for (const rule of protectedFields) {
    if (isGlobPattern(rule)) globbed.push(rule)
    else literals.add(foldFieldPath(rule))
  }
  let globs: MongoPathPattern[] = []
  if (globbed.length > 0) {
    const compiled = compilePatterns(globbed)
    if (compiled.rejected.length > 0) {
      const detail = compiled.rejected.map((r) => `'${r.raw}' (${r.reason})`).join(', ')
      throw new Error(`BlacklistRejection: blacklist entries this matcher cannot read: ${detail}`)
    }
    globs = compiled.patterns
  }
  const rules = contiguousRules(literals, globs)
  compiledRuleSets.set(protectedFields, rules)
  return rules
}
