/**
 * Find a protected field named anywhere in a MongoDB request.
 *
 * `blacklist.columns` was enforced only on the way back, by masking the keys a
 * document arrived under — and in MongoDB the request chooses those keys.
 * `$project: {leak: "$password"}` returns the value under `leak`;
 * `$group: {_id: "$password"}` returns it under `_id`, which the masker exempts
 * unconditionally so that document references survive. A response-side filter
 * cannot win against a request that decides the response's shape.
 *
 * This is the Elasticsearch shell's `namesProtectedField` in the other engine,
 * and it is deliberately the same shape, including the over-refusal: every
 * string and every key in the request is a candidate, so a *value* that happens
 * to equal a protected field name is refused too. That direction withholds
 * data; the other one discloses it.
 */

import { contiguousRulesFor, reachesProtectedPath } from './path-matcher'
import { foldFieldPath } from '@/core/blacklist-fold'

/** Strip the `$` that marks a field reference in an aggregation expression. */
function asFieldPath(text: string): string {
  // `$$ROOT`, `$$NOW` and friends are system variables, and `$$x` is a `$let`
  // binding. None of them names a document field directly — but
  // `$$ROOT.password` does, so the prefix is stripped rather than skipped.
  if (text.startsWith('$$')) return text.slice(2)
  if (text.startsWith('$')) return text.slice(1)
  return text
}

/**
 * The variables that *are* the document.
 *
 * `$$ROOT` with a path behind it (`$$ROOT.password`) is handled by stripping
 * the prefix. `$$ROOT` alone is not a path — it is every field at once, and
 * `{"$project": {"all": "$$ROOT"}}` returns the protected value under a key the
 * request chose. Neither end caught it: nothing in the request spells
 * `password`, and the mask compares the full path `all.password` against a rule
 * anchored as `password`.
 */
const WHOLE_DOCUMENT_VARIABLES = new Set(['ROOT', 'CURRENT'])

/**
 * Operators that hand back a document in a shape the response mask cannot read.
 *
 * `$objectToArray` is the clearest: it turns `{password: 'p1'}` into
 * `[{k: 'password', v: 'p1'}]`, where the protected name is a *value*. A
 * key-based mask has nothing to match on, and no amount of following values to
 * their sources fixes that. `$replaceRoot` / `$replaceWith` promote a subtree to
 * the top level, so a rule anchored at `user.password` no longer describes
 * where the field is.
 *
 * Refused only for a collection that has field rules, and only when the operand
 * could carry them — an over-refusal, in the direction that withholds.
 */
const RESHAPES_DOCUMENT = new Set(['$objectToArray', '$replaceRoot', '$replaceWith'])

/**
 * `$getField` names a field, and its `field` may be an expression.
 *
 * Whether a given server accepts a non-constant there varies by version. dbcli
 * cannot tell what name it resolves to, so it does not forward it — the same
 * rule the Elasticsearch path applies to a request body it cannot inspect.
 */
const NAMES_A_FIELD_DYNAMICALLY = '$getField'

/**
 * The first protected field this request names, or `undefined`.
 *
 * Returns the path rather than a boolean so the refusal can say which field it
 * was — a refusal that does not name its cause sends the operator to read the
 * config file and guess.
 */
export function findProtectedFieldReference(
  request: unknown,
  protectedFields: ReadonlySet<string>
): string | undefined {
  if (protectedFields.size === 0) return undefined
  // Both sides fold, by the one function every other matcher calls: the request
  // chooses the case it writes a field name in, so a check comparing it as
  // written is defeated by a rule that was written correctly. Literal rules
  // fold there; glob rules fold inside the matcher, where their text is not
  // rewritten. ADR-0020.
  //
  // 與 ES shell 共用同一個編譯：舊版在這裡自己折一次規則、自己編一次樣式，而
  // 那份拷貝把帶 metacharacter 的項目**也**放進字面集合——正是 ADR-0020 的
  // falsification 段落對 ES shell 點名、卻沒人檢查這一側的形狀。
  //
  // `contiguousRulesFor` 的記憶在這條路徑上不會命中：`protectedFieldsForRequest`
  // 每個請求都建一個新的 Set，所以每次都是新的 key。省下的是那份重複的編譯，
  // 不是跨呼叫的快取——舊版也已經是一次呼叫編譯一次。記憶對 ES shell 那側才
  // 有用，那裡 `collectProtectedFields` 的同一個 Set 實例會餵給每一個鍵。
  const rules = contiguousRulesFor(protectedFields)

  const candidates: string[] = []
  // A transfer that moves the whole document, or reshapes it out of the mask's
  // reach, names every protected field at once. Recorded rather than returned
  // immediately so the answer is stable: the first *named* field still wins,
  // which keeps the refusal message specific when the request has both.
  let movesWholeDocument = false

  const walk = (node: unknown): void => {
    if (typeof node === 'string') {
      const path = asFieldPath(node)
      if (node.startsWith('$$') && WHOLE_DOCUMENT_VARIABLES.has(path)) {
        movesWholeDocument = true
        return
      }
      candidates.push(path)
      return
    }
    if (Array.isArray(node)) {
      for (const item of node) walk(item)
      return
    }
    if (node === null || typeof node !== 'object') return
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (RESHAPES_DOCUMENT.has(key)) movesWholeDocument = true
      if (key === NAMES_A_FIELD_DYNAMICALLY) {
        const named = (value as { field?: unknown })?.field ?? value
        if (typeof named !== 'string') movesWholeDocument = true
      }
      // An operator (`$match`, `$gt`) is not a field name. Everything else in
      // key position is one — including a dotted path and, in `$project`, an
      // output name the operator chose, which costs one needless refusal when
      // someone names an output field after a protected one.
      if (!key.startsWith('$')) candidates.push(key)
      walk(value)
    }
  }
  walk(request)

  const named = candidates.find(
    (path) => path.length > 0 && reachesProtectedPath(foldFieldPath(path), rules)
  )
  if (named !== undefined) return named
  // Every protected field, so the message can say one — which one is arbitrary
  // and the message says why it is arbitrary.
  return movesWholeDocument ? [...protectedFields][0] : undefined
}

/**
 * The protected fields that apply to a request against `collection`.
 *
 * The queried collection's own rules, plus those of any other collection whose
 * name the request mentions — `$lookup: {from: 'secrets'}` pulls that
 * collection's documents into this pipeline, so its rules have to travel with
 * them.
 */
export function protectedFieldsForRequest(
  request: unknown,
  collection: string,
  columns: Record<string, string[]>
): Set<string> {
  const named = new Set<string>()
  const collectStrings = (node: unknown): void => {
    if (typeof node === 'string') {
      named.add(node)
      return
    }
    if (Array.isArray(node)) {
      for (const item of node) collectStrings(item)
      return
    }
    if (node === null || typeof node !== 'object') return
    for (const value of Object.values(node as Record<string, unknown>)) collectStrings(value)
  }
  collectStrings(request)

  // Lower-cased on both sides. `findCaseInsensitive` in `field-masker.ts` looks
  // rules up that way, so an exact-match test here would have made the same
  // configuration protect the response and not the request.
  const namedLower = new Set([...named].map((value) => value.toLowerCase()))
  const fields = new Set<string>()
  for (const [name, rules] of Object.entries(columns)) {
    const applies =
      name.toLowerCase() === collection.toLowerCase() || namedLower.has(name.toLowerCase())
    if (!applies) continue
    for (const rule of rules) {
      const trimmed = rule.trim()
      if (trimmed.length > 0) fields.add(trimmed)
    }
  }
  return fields
}
