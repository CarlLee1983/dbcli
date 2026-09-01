import { matchSegment, type MongoPathPattern } from './mongo/path-matcher'

export type FieldSelection =
  | { mode: 'include'; paths: readonly string[] }
  | { mode: 'exclude'; paths: readonly string[] }

const UNSAFE_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor'])

export function parseFieldSelection(raw: string | undefined): FieldSelection | undefined {
  if (raw === undefined) return undefined

  const tokens = raw.split(',').map((token) => token.trim())
  if (tokens.length === 0 || tokens.some((token) => token === '')) {
    throw new Error('--fields must not contain empty fields')
  }

  let mode: FieldSelection['mode'] | undefined
  const paths: string[] = []
  const seen = new Set<string>()
  for (const token of tokens) {
    const tokenMode = token.startsWith('-') ? 'exclude' : 'include'
    const path = tokenMode === 'exclude' ? token.slice(1) : token
    if (path === '') throw new Error('--fields exclusion requires a field name after -')
    if (mode !== undefined && mode !== tokenMode) {
      throw new Error('--fields cannot mix included and excluded fields')
    }
    validatePath(path)
    if (seen.has(path)) throw new Error(`--fields contains duplicate field: ${path}`)
    mode = tokenMode
    seen.add(path)
    paths.push(path)
  }

  if (!mode || paths.length === 0) throw new Error('--fields must contain at least one field')
  return { mode, paths }
}

export function projectRows(
  rows: readonly Record<string, unknown>[],
  selection: FieldSelection
): { rows: Record<string, unknown>[]; columnNames: string[] } {
  if (selection.mode === 'include') {
    return {
      rows: rows.map((row) => {
        const projected: Record<string, unknown> = {}
        for (const path of selection.paths) {
          const result = readPath(row, path.split('.'))
          defineData(projected, path, result.found ? (result.value ?? null) : null)
        }
        return projected
      }),
      columnNames: [...selection.paths],
    }
  }

  const projectedRows = omitFieldPaths(rows, selection.paths)
  const columnNames = collectColumnNames(projectedRows)
  return { rows: normalizeRows(projectedRows, columnNames), columnNames }
}

// Takes pre-split segments rather than a dotted string so a caller probing many rows
// for the same path pays `split` once instead of once per row: the masker's fail-safe
// branch applies every rule in the config, so "many paths, almost no matches" is its
// normal shape, and the splitting alone measured a third of that branch's cost.
export function hasFieldPath(
  row: Record<string, unknown>,
  segments: readonly string[],
  options?: FieldPathOptions
): boolean {
  const caseInsensitive = options?.caseInsensitive === true
  // Folded once here rather than at every level of every row: the masker asks
  // this question once per dotted rule per row, so folding inside `readPath`
  // repeated the same `toLowerCase` tens of thousands of times.
  const folded =
    caseInsensitive && options?.alreadyFolded !== true
      ? segments.map((segment) => segment.toLowerCase())
      : segments
  return readPath(row, folded, caseInsensitive).found
}

/**
 * How a path is matched against a row's keys.
 *
 * `caseInsensitive` is what the blacklist masker passes and `--fields` does
 * not: a rule is compared to a name the request chose the case of, while a
 * `--fields` path is the operator naming keys of the document in front of them.
 * ADR-0020.
 */
export interface OmitFieldOptions extends FieldPathOptions {
  /**
   * Wildcard rules to remove as well, decided during one walk of each row.
   *
   * A dotted wildcard rule can match a different key in every row, so listing
   * the keys it hit and removing them by name meant one full record rebuild per
   * key per row: 200 rows of 20 row-specific keys measured 1.8s. The pattern
   * removes what it matches where the walk already is.
   *
   * These are rules that name something *below* a top-level key. A single-
   * segment pattern here would remove top-level keys, which `paths` already
   * covers by name.
   */
  readonly patterns?: ReadonlyArray<MongoPathPattern>
}

export interface FieldPathOptions {
  readonly caseInsensitive?: boolean
  /**
   * The segments passed in are already folded. Lets a caller asking the same
   * rule of many rows fold it once instead of once per row.
   */
  readonly alreadyFolded?: boolean
}

/**
 * A rule as the walk carries it: the segments still to match, and the rule it
 * came from so a match can be reported against the entry the operator wrote.
 */
interface LiveRule {
  readonly root: MongoPathPattern
  /** Which rule, and how much of it is consumed — the pair that names a state. */
  readonly rootIndex: number
  readonly offset: number
  readonly segments: ReadonlyArray<string>
  readonly wildcardTail: boolean
}

/**
 * The rules still live one level down from `key`, and whether `key` is itself
 * the path one of them names.
 *
 * A key consumes as many segments as it has dot-separated parts, not one: a
 * record's key may itself contain a dot — `flattenSource` produces exactly
 * that, and `readPath` and `omitPath` each carry a branch for it — so asking
 * `matchSegment('b', 'b.c')` would decide no rule can reach that branch and
 * copy it untouched. The rule was still reported as omitted, so the value came
 * back in full under a heading that said it had been removed.
 */
function narrow(rules: ReadonlyArray<LiveRule>, key: string): { drop: boolean; live: LiveRule[] } {
  const parts = key.includes('.') ? key.split('.') : [key]
  const live: LiveRule[] = []
  for (const rule of rules) {
    const remaining = rule.segments.length
    if (remaining < parts.length && !rule.wildcardTail) continue
    let matches = true
    for (let i = 0; i < Math.min(remaining, parts.length); i++) {
      if (!matchSegment(rule.segments[i]!, parts[i]!)) {
        matches = false
        break
      }
    }
    if (!matches) continue
    // The rule's segments are used up at this node, so this node is the path it
    // names — and for the tail form, everything beneath it as well.
    if (remaining <= parts.length) return { drop: true, live: [] }
    live.push({
      root: rule.root,
      rootIndex: rule.rootIndex,
      offset: rule.offset + parts.length,
      segments: rule.segments.slice(parts.length),
      wildcardTail: rule.wildcardTail,
    })
  }
  return { drop: false, live }
}

function liveRulesOf(patterns: ReadonlyArray<MongoPathPattern>): LiveRule[] {
  return patterns.map((pattern, index) => ({
    root: pattern,
    rootIndex: index,
    offset: 0,
    segments: pattern.segments,
    wildcardTail: pattern.wildcardTail,
  }))
}

/**
 * `narrow` memoised as state transitions, which is what makes a wide result set
 * cheap.
 *
 * `narrow` is a pure function of (rule set, key), and a result set repeats the
 * same key names row after row, so the same question is asked thousands of
 * times. Interning each rule set as a state turns the walk into a table lookup:
 * a rule set is identified by which rules are in it and how far each has been
 * consumed, so the answer for `(state, key)` is computed once for the whole
 * call. Without it, 1000 rows x 20 keys x 10 rules that all match the head
 * measured 43ms, and 50 such rules 190ms — the shape a real blacklist has, with
 * many rules hanging off one head.
 *
 * The cap is on the transition table, which is what grows with the data. The
 * interned states are bounded by the rule set itself — a state is a subset of
 * the rules with an offset each — and clearing the table only costs speed,
 * since the function behind it is pure and re-derives the same answers.
 */
const NARROW_STATE_LIMIT = 4096

/**
 * The answer for one `(state, key)` step. A discriminated union rather than a
 * `next` that is meaningless when `drop` is set: reading a sentinel state id by
 * mistake would return an empty rule set, which means "copy this untouched" to
 * the remover and "stop walking" to the detector — both fail open. The type
 * makes that unreachable instead of unlikely.
 */
type NarrowStep = { readonly drop: true } | { readonly drop: false; readonly next: number }

class NarrowStates {
  private readonly states: LiveRule[][] = []
  private readonly ids = new Map<string, number>()
  private transitions = new Map<string, NarrowStep>()

  constructor(rules: LiveRule[]) {
    this.intern(rules)
  }

  rules(state: number): ReadonlyArray<LiveRule> {
    const rules = this.states[state]
    // An unknown state is a bug in this file, not an input; answering it with
    // an empty rule set would silently stop masking.
    if (rules === undefined) throw new Error(`unknown nested-rule state ${state}`)
    return rules
  }

  step(state: number, key: string): NarrowStep {
    // `state` is a decimal number, so the first NUL is always the separator
    // even when the key contains one.
    const memoKey = `${state}\u0000${key}`
    const memo = this.transitions.get(memoKey)
    if (memo !== undefined) return memo
    const { drop, live } = narrow(this.rules(state), key)
    const step: NarrowStep = drop ? { drop: true } : { drop: false, next: this.intern(live) }
    if (this.transitions.size >= NARROW_STATE_LIMIT) this.transitions = new Map()
    this.transitions.set(memoKey, step)
    return step
  }

  private intern(rules: LiveRule[]): number {
    // `(rootIndex, offset)` names a live rule completely: its segments are
    // always `root.segments.slice(offset)`, and the rest is a property of the
    // rule it came from. The encoding is a canonical form only because `narrow`
    // filters and never reorders, so `live` is a subsequence of the initial
    // order — sorting or deduplicating there would give one rule set two ids,
    // which costs memo hits rather than correctness.
    const key = rules.map((rule) => `${rule.rootIndex}:${rule.offset}`).join(',')
    const existing = this.ids.get(key)
    if (existing !== undefined) return existing
    const id = this.states.length
    this.states.push(rules)
    this.ids.set(key, id)
    return id
  }
}

/**
 * Report which of `pending` reach something below `row`'s top-level keys.
 *
 * The masker compares wildcard rules against the names a result actually
 * carries. Top-level names it already has; a nested record's keys are not names
 * anywhere until something walks for them, which is why `profile.ss*` matched
 * nothing on a PostgreSQL `jsonb` column while `profile.SS_num` matched — the
 * literal form descends through `hasFieldPath` and the wildcard form had
 * nothing to compare against.
 *
 * Narrowed level by level, the same way `omitMatching` narrows, so a branch no
 * rule can still reach is never entered: building a dotted path string for
 * every node and testing it against every rule measured 145ms on 1000
 * documents of depth 4 where the literal form of the same rule measured 7ms.
 *
 * Arrays are transparent, as they are to `readPath`. `isPlainRecord`, not
 * `isRecord`: a `bytea` column arrives as a Buffer, whose own property names
 * are every byte index — enumerating those cost 1.3s for a single 1MB value —
 * and it is also the test `omitPath` and `omitMatching` use to decide what they
 * can descend into, so a path this reported and they could not remove would be
 * named in "columns omitted" with its value returned in full.
 */
export function collectNestedMatches(
  row: Record<string, unknown>,
  states: NestedRuleStates,
  pending: Set<MongoPathPattern>,
  onMatch: (pattern: MongoPathPattern) => void
): void {
  if (pending.size === 0) return
  const walk = (value: unknown, state: number, depth: number): void => {
    if (pending.size === 0 || states.rules(state).length === 0) return
    if (Array.isArray(value)) {
      for (const item of value) walk(item, state, depth)
      return
    }
    if (!isPlainRecord(value)) return
    for (const key of Object.getOwnPropertyNames(value)) {
      const step = states.step(state, key)
      if (step.drop) {
        // A top-level key is already answered by name — the caller compares
        // every rule against the names the result carries — so reporting it
        // here would add a second entry for one column, and only when the row
        // happened to hold a nested record elsewhere.
        if (depth > 0) {
          // `step` stops at the first rule whose segments are used up, so the
          // node is reported against every rule that could name it, not one.
          for (const rule of states.rules(state)) {
            if (!pending.has(rule.root)) continue
            if (!narrow([rule], key).drop) continue
            pending.delete(rule.root)
            onMatch(rule.root)
          }
        }
        continue
      }
      walk(value[key], step.next, depth + 1)
    }
  }
  walk(row, 0, 0)
}

/** The interned rule set a nested walk steps through. */
export type NestedRuleStates = NarrowStates

/** Prepare `patterns` for `collectNestedMatches`, once for the whole result. */
export function compileNestedRules(patterns: ReadonlyArray<MongoPathPattern>): NestedRuleStates {
  return new NarrowStates(liveRulesOf(patterns))
}

export function omitFieldPaths(
  rows: readonly Record<string, unknown>[],
  paths: readonly string[],
  options?: OmitFieldOptions
): Record<string, unknown>[] {
  const caseInsensitive = options?.caseInsensitive === true
  const nestedPatterns = options?.patterns ?? []
  const nestedStates = nestedPatterns.length > 0 ? compileNestedRules(nestedPatterns) : undefined
  // `omitPath` rebuilds the whole record, so running it once per path made this
  // O(rows × paths) full copies — 100 rows against a 50-column blacklist cost 5000
  // rebuilds and ~35ms, which is why the masking benchmark had never met its 5ms
  // budget. A path without a dot only ever deletes one top-level key, and a column
  // blacklist is overwhelmingly such names, so those are collected into one pass
  // and only genuinely nested paths still recurse. Same output, ~50x faster.
  //
  // A dotted path has two jobs: delete a literal key of that exact name, and walk
  // into a nested record of the same head. The first is what `omitPath`'s
  // `key === exactPath` branch does, and the skip-set does it just as well — so
  // every path joins the skip-set, and the expensive recursion is reserved for the
  // rows that actually hold an object at the head. That distinction matters because
  // the Elasticsearch adapter flattens `_source`: its rows are *all* dotted keys and
  // no nested records, so masking them used to pay a full rebuild per path for
  // traversal that could never match. Measured on 1000 flattened docs with 6
  // protected fields: 10.9ms with the recursion, 2.0ms without.
  //
  // The decision is per row, not per result set. A single document whose `profile`
  // is an array (Elasticsearch does not flatten arrays) would otherwise put all
  // thousand rows back on the slow path — measured at 8.4ms for one nested row in
  // a thousand, over the benchmark's budget, for traversal 999 rows cannot use.
  //
  // Ceiling: a genuinely nested row still costs one rebuild per path that reaches it.
  const fold = (value: string): string => (caseInsensitive ? value.toLowerCase() : value)
  const topLevel = new Set<string>(paths.map(fold))
  const dotted = paths
    .filter((path) => path.includes('.'))
    .map((path) => ({ head: fold(path.slice(0, path.indexOf('.'))), segments: path.split('.') }))

  const maskRecord = (row: Record<string, unknown>): Record<string, unknown> => {
    let projected: unknown = cloneRecord(row, topLevel, caseInsensitive)
    for (const { head, segments } of dotted) {
      const value = headValue(row, head, caseInsensitive)
      if (value !== null && typeof value === 'object') {
        projected = omitPath(projected, segments, caseInsensitive)
      }
    }
    // Per row, not per result set: the same reasoning the dotted branch above
    // records. A single nested row in a thousand would otherwise put every row
    // through this walk.
    if (nestedStates !== undefined && hasNestedRecord(row)) {
      projected = omitMatching(projected, nestedStates, 0)
    }
    return projected as Record<string, unknown>
  }

  return rows.map((row) => {
    // A null/non-record row carries no field to mask. Returning it untouched only
    // moved the throw downstream (`query-executor` indexes into every row), and the
    // declared return type says these are records — so it becomes an empty one. Row
    // count and ordering are preserved, which is what callers actually index by.
    if (row === null || typeof row !== 'object') return {}
    // An array row is not a record, but `cloneRecord` treated it as one: the indices
    // became keys and every protected field inside the elements survived, so a row
    // reported as masked was returned intact. `readPath` — which decides *whether* a
    // field is there — walks arrays transparently, so masking has to see through them
    // the same way or the two disagree in the fail-open direction. The record-of-
    // indices shape is the one this already produced; only the leak is fixed.
    if (Array.isArray(row)) return maskArrayRow(row, maskRecord)
    return maskRecord(row)
  })
}

function maskArrayRow(
  row: readonly unknown[],
  maskRecord: (record: Record<string, unknown>) => Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  row.forEach((item, index) => {
    const masked = Array.isArray(item)
      ? maskArrayRow(item, maskRecord)
      : item !== null && typeof item === 'object'
        ? maskRecord(item as Record<string, unknown>)
        : item
    defineData(out, String(index), masked)
  })
  return out
}

export function toMongoProjection(selection: FieldSelection): Record<string, 0 | 1> {
  const projection: Record<string, 0 | 1> = {}
  const value = selection.mode === 'include' ? 1 : 0
  for (const path of selection.paths) defineData(projection, path, value)
  if (selection.mode === 'include' && !selection.paths.includes('_id')) {
    defineData(projection, '_id', 0)
  }
  return projection
}

function validatePath(path: string): void {
  const segments = path.split('.')
  if (segments.some((segment) => segment === '')) {
    throw new Error(`--fields contains an invalid dotted path: ${path}`)
  }
  const unsafe = segments.find((segment) => UNSAFE_SEGMENTS.has(segment))
  if (unsafe) throw new Error(`--fields contains an unsafe field segment: ${unsafe}`)
}

/** The row's value at `head`, found case-insensitively when asked. */
function headValue(row: Record<string, unknown>, head: string, caseInsensitive: boolean): unknown {
  if (!caseInsensitive) return row[head]
  const key = foldedKeys(row).get(head)
  return key === undefined ? undefined : row[key]
}

/**
 * A record's own keys indexed by their folded form, built once per record.
 *
 * Scanning the keys per lookup made the masker's nested probe quadratic in a
 * row's width: it asks `readPath` once per dotted rule per row and `readPath`
 * asks twice per level, so 2000 rows x 81 columns x 40 missing rules measured
 * 45ms unfolded and 417ms folded. The index restores the constant-time lookup
 * `hasOwnProperty` gave.
 *
 * Keyed weakly on the record, which every caller here treats as immutable —
 * masking returns new objects rather than editing a row in place. A record
 * mutated after it was indexed would be matched against its former key names.
 */
const foldedKeyIndex = new WeakMap<object, Map<string, string>>()

function foldedKeys(value: Record<string, unknown>): Map<string, string> {
  const memo = foldedKeyIndex.get(value)
  if (memo !== undefined) return memo
  const index = new Map<string, string>()
  for (const key of Object.getOwnPropertyNames(value)) {
    const folded = key.toLowerCase()
    if (!index.has(folded)) index.set(folded, key)
  }
  foldedKeyIndex.set(value, index)
  return index
}

/** The record's own key equal to `name`, folded when asked, or `undefined`. */
function ownKey(
  value: Record<string, unknown>,
  name: string,
  caseInsensitive: boolean
): string | undefined {
  // The exact key first, in both modes: a rule whose case already matches the
  // data — the common shape — never builds an index. In the folded mode `name`
  // arrives lower-cased from `hasFieldPath`, so this compares folded to folded.
  if (Object.prototype.hasOwnProperty.call(value, name)) return name
  if (!caseInsensitive) return undefined
  return foldedKeys(value).get(name)
}

function readPath(
  value: unknown,
  segments: readonly string[],
  caseInsensitive = false
): { found: boolean; value?: unknown } {
  if (segments.length === 0) return { found: true, value }
  if (Array.isArray(value)) {
    const results = value.map((item) => readPath(item, segments, caseInsensitive))
    return {
      found: results.some((result) => result.found),
      value: results.map((result) => (result.found ? result.value : undefined)),
    }
  }
  if (!isRecord(value)) return { found: false }

  const exact = ownKey(value, segments.join('.'), caseInsensitive)
  if (exact !== undefined) return { found: true, value: value[exact] }
  const [head, ...tail] = segments
  const headKey = ownKey(value, head!, caseInsensitive)
  if (headKey === undefined) return { found: false }
  return readPath(value[headKey], tail, caseInsensitive)
}

/**
 * Rebuild `value` without the paths `patterns` match, in one walk.
 *
 * Narrowed level by level by the same `narrow` the detection walk uses, so a
 * branch no rule can still reach is copied without being entered and a key
 * carrying a dot consumes the segments it spells. Testing every node against
 * every rule instead measured 842ms on 1000 documents of depth 4 against 7ms
 * for the literal form of the same rule.
 */
function omitMatching(value: unknown, states: NarrowStates, state: number): unknown {
  if (states.rules(state).length === 0) return value
  if (Array.isArray(value)) return value.map((item) => omitMatching(item, states, state))
  if (!isPlainRecord(value)) return value
  const out: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value)) {
    const step = states.step(state, key)
    if (step.drop) continue
    defineData(out, key, omitMatching(child, states, step.next))
  }
  return out
}

/** Whether a row holds anything `omitMatching` could descend into. */
function hasNestedRecord(row: Record<string, unknown>): boolean {
  for (const key of Object.getOwnPropertyNames(row)) {
    const value = row[key]
    if (Array.isArray(value) || isPlainRecord(value)) return true
  }
  return false
}

function omitPath(value: unknown, segments: readonly string[], caseInsensitive: boolean): unknown {
  if (segments.length === 0) return value
  if (Array.isArray(value)) return value.map((item) => omitPath(item, segments, caseInsensitive))
  if (!isPlainRecord(value)) return value

  const fold = (name: string): string => (caseInsensitive ? name.toLowerCase() : name)
  const exactPath = fold(segments.join('.'))
  const head = fold(segments[0]!)
  const tail = segments.slice(1)
  const out: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value)) {
    const folded = fold(key)
    if (folded === exactPath) continue
    if (folded === head) {
      if (tail.length > 0) defineData(out, key, omitPath(child, tail, caseInsensitive))
      continue
    }
    defineData(out, key, child)
  }
  return out
}

// `omittedKeys` is required rather than optional: for a masking helper, the
// fail-open direction of a forgotten argument (keep every key) is the wrong default.
function cloneRecord(
  value: Record<string, unknown>,
  omittedKeys: ReadonlySet<string>,
  caseInsensitive = false
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value)) {
    if (!omittedKeys.has(caseInsensitive ? key.toLowerCase() : key)) defineData(out, key, child)
  }
  return out
}

function collectColumnNames(rows: readonly Record<string, unknown>[]): string[] {
  const names: string[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    for (const name of Object.keys(row)) {
      if (!seen.has(name)) {
        seen.add(name)
        names.push(name)
      }
    }
  }
  return names
}

function normalizeRows(
  rows: readonly Record<string, unknown>[],
  columnNames: readonly string[]
): Record<string, unknown>[] {
  return rows.map((row) => {
    const normalized: Record<string, unknown> = {}
    for (const column of columnNames) {
      const value = Object.prototype.hasOwnProperty.call(row, column) ? row[column] : null
      defineData(normalized, column, value ?? null)
    }
    return normalized
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function defineData(target: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  })
}
