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

/** Strip the `$` that marks a field reference in an aggregation expression. */
function asFieldPath(text: string): string {
  // `$$ROOT`, `$$NOW` and friends are system variables, not field paths, and
  // `$$x` is a `$let` binding. None of them names a document field directly —
  // but `$$ROOT.password` does, so the prefix is stripped rather than skipped.
  if (text.startsWith('$$')) return text.slice(2)
  if (text.startsWith('$')) return text.slice(1)
  return text
}

/**
 * Whether a path names a protected field.
 *
 * Matched by contiguous dotted components, not by substring or whole-string
 * equality: `user.password` and `password.keyword` both reach `password`, while
 * `passwordless` does not. A substring test would refuse `passwordless`; a
 * whole-string test would miss `user.password`.
 */
function reachesProtectedField(path: string, protectedFields: ReadonlySet<string>): boolean {
  if (protectedFields.has(path)) return true
  const parts = path.split('.')
  if (parts.length === 1) return false
  for (let start = 0; start < parts.length; start += 1) {
    for (let end = start + 1; end <= parts.length; end += 1) {
      if (protectedFields.has(parts.slice(start, end).join('.'))) return true
    }
  }
  return false
}

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

  const candidates: string[] = []
  const walk = (node: unknown): void => {
    if (typeof node === 'string') {
      candidates.push(asFieldPath(node))
      return
    }
    if (Array.isArray(node)) {
      for (const item of node) walk(item)
      return
    }
    if (node === null || typeof node !== 'object') return
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      // An operator (`$match`, `$gt`) is not a field name. Everything else in
      // key position is one — including a dotted path and, in `$project`, an
      // output name the operator chose, which costs one needless refusal when
      // someone names an output field after a protected one.
      if (!key.startsWith('$')) candidates.push(key)
      walk(value)
    }
  }
  walk(request)

  return candidates.find((path) => path.length > 0 && reachesProtectedField(path, protectedFields))
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

  const fields = new Set<string>()
  for (const [name, rules] of Object.entries(columns)) {
    const applies = name.toLowerCase() === collection.toLowerCase() || named.has(name)
    if (!applies) continue
    for (const rule of rules) {
      const trimmed = rule.trim()
      if (trimmed.length > 0) fields.add(trimmed)
    }
  }
  return fields
}
